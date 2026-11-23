/**
 * TranslationPipelineService
 * Dual-model subtitle translation & supervisor review pipeline coordinator.
 */

import {
    TranslateCueItem,
    ReviewCueItem,
    PrecedingContextItem,
    MergeAsrCueItem,
} from '@shared/types/Messages';
import { ContextDTO } from '@shared/domain/entities/Context';
import { TranslationProvider } from '@shared/domain/entities/PipelineTypes';
import { GlossaryService } from './GlossaryService';
import { LlmService } from './LlmService';
import { ITrackCacheRepository } from '@shared/domain/repositories/ITrackCacheRepository';
import { TrackCacheRepositoryFactory } from '../../infrastructure/cache/TrackCacheRepositoryFactory';
import { TranslatorRegistry } from '../../domain/translation/TranslatorRegistry';
import {
    MergeAsrBatchRequest,
    MergeAsrBatchResponse,
} from '../../domain/translation/ITranslatorService';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { NCW_STORAGE_KEYS } from '@shared/domain/constants/StorageKeys';
import { ExtensionSettings } from '@shared/domain/constants/SettingsDefaults';
import { Language, LanguageInfo } from '@shared/domain/value-objects/Language';
import { Logger } from '@shared/utils/logger';

interface QueueTask<T> {
    taskFn: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
}

class PipelineTaskQueue {
    private queue: QueueTask<unknown>[] = [];
    private activeCount = 0;
    private readonly concurrency: number;

    constructor(concurrency = 1) {
        this.concurrency = concurrency;
    }

    enqueue<T>(taskFn: () => Promise<T>, urgent = false): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const task: QueueTask<unknown> = {
                taskFn: taskFn as () => Promise<unknown>,
                resolve: resolve as (value: unknown) => void,
                reject,
            };
            if (urgent) {
                this.queue.unshift(task);
            } else {
                this.queue.push(task);
            }
            this.processNext();
        });
    }

    private async processNext(): Promise<void> {
        if (this.activeCount >= this.concurrency || this.queue.length === 0)
            return;
        const task = this.queue.shift();
        if (!task) return;

        this.activeCount++;
        try {
            const res = await task.taskFn();
            task.resolve(res);
        } catch (err) {
            task.reject(err);
        } finally {
            this.activeCount--;
            this.processNext();
        }
    }

    clear(): void {
        const pending = this.queue;
        this.queue = [];
        for (const item of pending) {
            item.reject(new Error('Pipeline task queue cleared'));
        }
    }
}

export class TranslationPipelineService {
    private static instance: TranslationPipelineService | null = null;
    private readonly translationQueue: PipelineTaskQueue;
    private readonly supervisorQueue: PipelineTaskQueue;
    private readonly glossaryService: GlossaryService;
    private readonly llmService: LlmService;
    private readonly cacheRepository: ITrackCacheRepository;

    private currentActiveAbortController: AbortController | null = null;
    private isCurrentTaskUrgent: boolean = false;
    private activeProvider: TranslationProvider = 'google';
    private targetLanguage: LanguageInfo = Language.DEFAULT;

    private logger: Logger = new Logger('TranslationPipelineService');

    private constructor() {
        this.translationQueue = new PipelineTaskQueue(1);
        this.supervisorQueue = new PipelineTaskQueue(1);
        this.glossaryService = GlossaryService.getInstance();
        this.llmService = LlmService.getInstance();
        this.cacheRepository = TrackCacheRepositoryFactory.getRepository();
    }

    async init(): Promise<void> {
        await this.llmService.init();

        const storage = BrowserStorageFactory.getStorage();
        storage
            .get<Partial<ExtensionSettings>>([NCW_STORAGE_KEYS.SETTINGS])
            .then((res) => {
                const s = res[NCW_STORAGE_KEYS.SETTINGS];
                if (s?.aiProvider) this.activeProvider = s.aiProvider;
                if (s?.targetLanguage) this.targetLanguage = s.targetLanguage;
            });

        storage.onChanged((changes) => {
            if (changes[NCW_STORAGE_KEYS.SETTINGS]?.newValue) {
                const s = changes[NCW_STORAGE_KEYS.SETTINGS]
                    .newValue as Partial<ExtensionSettings>;
                if (s.aiProvider && s.aiProvider !== this.activeProvider) {
                    this.logger.info(
                        'Translation',
                        `Active provider changed from ${this.activeProvider} to ${s.aiProvider}`,
                    );
                    this.activeProvider = s.aiProvider;
                    this.clearQueues();
                }
                if (
                    s.targetLanguage &&
                    s.targetLanguage !== this.targetLanguage
                ) {
                    this.logger.info(
                        'Translation',
                        `Target language changed from ${this.targetLanguage} to ${s.targetLanguage}`,
                    );
                    this.targetLanguage = s.targetLanguage;
                    this.clearQueues();
                }
            }
        });
    }

    static getInstance(): TranslationPipelineService {
        if (!TranslationPipelineService.instance) {
            TranslationPipelineService.instance =
                new TranslationPipelineService();
        }
        return TranslationPipelineService.instance;
    }

    getActiveProvider(): TranslationProvider {
        return this.activeProvider;
    }

    getTargetLanguage(): LanguageInfo {
        return this.targetLanguage;
    }

    clearQueues(): void {
        this.logger.info(
            'Translation',
            'Clearing pending translation and supervisor queues.',
        );
        this.translationQueue.clear();
        this.supervisorQueue.clear();
        if (this.currentActiveAbortController) {
            try {
                this.currentActiveAbortController.abort('Queues get cleaned');
            } catch {
                // Ignore
            }
            this.currentActiveAbortController = null;
        }
        this.isCurrentTaskUrgent = false;
    }

    /**
     * Warm up show context with Supervisor model
     */
    async warmupContext(params: {
        title: string;
        mainTitle: string;
        sampleDialogues: string;
        videoId: string;
        showId?: string;
        seasonId?: string;
        showSummary?: string;
        episodeNumber?: string;
        episodeSummary?: string;
    }): Promise<{
        success: boolean;
        context: ContextDTO | null;
        cached: boolean;
    }> {
        return this.supervisorQueue.enqueue(async () => {
            const {
                title,
                mainTitle,
                videoId,
                showId,
                seasonId,
                showSummary,
                episodeNumber,
                episodeSummary,
            } = params;

            if (!showId) {
                return {
                    success: false,
                    context: null,
                    cached: false,
                };
            }

            const episode = {
                seasonId: seasonId || 'unknown',
                videoId,
                episodeNumber,
                title,
                synopsis: episodeSummary || 'unknown',
            };

            const ctx = await this.glossaryService.getOrCreateContext({
                showId,
                targetLanguage: this.targetLanguage,
                title,
                mainTitle,
                showSynopsis: showSummary,
                episodeSynopsis: episodeSummary,
                episodeId: videoId,
                episodeNumber,
                seasonId,
            });

            // 1. If official metadata synopsis is present, update context directly without calling LLM
            if (showSummary || episodeSummary) {
                const updated = await this.glossaryService.updateWarmupContext({
                    showId,
                    targetLanguage: this.targetLanguage,
                    title,
                    mainTitle,
                    showSynopsis: showSummary,
                    episode,
                    known: true,
                });
                return {
                    success: true,
                    context: updated.toDTO(),
                    cached: false,
                };
            }

            // 2. For Google Translate, skip LLM warmup
            if (this.activeProvider === 'google') {
                const updated = await this.glossaryService.updateWarmupContext({
                    showId,
                    targetLanguage: this.targetLanguage,
                    title,
                    mainTitle,
                    showSynopsis: showSummary,
                    episode,
                    known: false,
                });
                return {
                    success: true,
                    context: updated.toDTO(),
                    cached: false,
                };
            }

            // 3. Check if context is already warmed up
            if (ctx.isWarmedUp) {
                return { success: true, context: ctx.toDTO(), cached: true };
            }

            // We don't want llm to help us warm up!
            // If we have platform which we cannot fetch accurate context, we might consider to enable this again!
            //
            //       // 4. Ask LLM supervisor to extract characters, terms, and scene synopsis
            //       const prompt = `Analyze this video title and sample dialogues to determine brief context and synopsis.
            // Title: ${title || mainTitle}
            // Sample dialogues:
            // ${sampleDialogues}
            //
            // Return strictly valid JSON:
            // {
            //   "known": true,
            //   "synopsis": "brief 1-2 sentence synopsis of the show or scene",
            //   "characters": {},
            //   "terms": {}
            // }`;
            //
            //       try {
            //         const rawContent = await this.llmService.callChat('supervisor', {
            //           messages: [{ role: 'user', content: prompt }],
            //           temperature: 0.1,
            //           jsonMode: true,
            //         });
            //
            //         let parsed: any = {};
            //         if (rawContent) {
            //           const clean = rawContent.replace(/```json\s*|\s*```/g, '').trim();
            //           parsed = JSON.parse(clean);
            //         }
            //
            //         const aiSynopsis = typeof parsed.synopsis === 'string' ? parsed.synopsis : '';
            //         const updated = await this.glossaryService.updateWarmupContext({
            //           showId,
            //           targetLanguage: this.targetLanguage,
            //           title,
            //           mainTitle,
            //           showSynopsis: showSummary || aiSynopsis,
            //           episode,
            //           known: Boolean(parsed.known),
            //           characters: parsed.characters || {},
            //           terms: parsed.terms || {},
            //         });
            //         return { success: true, context: updated.toDTO(), cached: false };
            //       } catch (err: any) {
            //         this.logger.error('Translation', 'LLM warmup failed', err);
            //         return { success: false, context: null, cached: false };
            //       }

            ctx.markWarmup();
            return { success: true, context: ctx.toDTO(), cached: false };
        });
    }

    /**
     * Intelligently merges fragmented ASR subtitle segments into complete sentences
     */
    async mergeAsrBatch(params: {
        items: MergeAsrCueItem[];
    }): Promise<MergeAsrBatchResponse> {
        const activeProvider = this.activeProvider;
        const translator =
            await TranslatorRegistry.getTranslator(activeProvider);
        const req: MergeAsrBatchRequest = {
            items: params.items,
        };

        if (activeProvider === 'google' || !translator.mergeAsrBatch) {
            if (typeof translator.mergeAsrBatch === 'function') {
                return translator.mergeAsrBatch(req);
            }
            return {
                success: false,
                error: 'Provider does not support ASR merging',
            };
        }

        // For LLM providers, enqueue on supervisorQueue
        return this.supervisorQueue.enqueue(async () => {
            if (translator.mergeAsrBatch) {
                return translator.mergeAsrBatch(req);
            }
            return {
                success: false,
                error: 'Provider does not support ASR merging',
            };
        });
    }

    /**
     * Batch translation with Google / Ollama / OpenRouter
     */
    async translateBatch(params: {
        items: TranslateCueItem[];
        contextItems?: PrecedingContextItem[];
        trackHash?: string;
        showId?: string;
        movieId?: string;
        mainTitle?: string;
        urgent?: boolean;
    }): Promise<{
        success: boolean;
        results?: Record<number, string>;
        merged?: Record<number, number[]>;
        error?: string;
    }> {
        const isUrgent = Boolean(params.urgent);

        if (
            isUrgent &&
            this.currentActiveAbortController &&
            !this.isCurrentTaskUrgent
        ) {
            this.logger.info(
                'Translation',
                'Aborting non-urgent prefetch for urgent Seek Burst...',
            );
            try {
                this.currentActiveAbortController.abort('Urgent tasks happen!');
            } catch {
                // Ignore
            }
            this.currentActiveAbortController = null;
        }

        return this.translationQueue.enqueue(async () => {
            this.isCurrentTaskUrgent = isUrgent;
            this.currentActiveAbortController = new AbortController();
            const signal = this.currentActiveAbortController.signal;

            try {
                const {
                    items,
                    contextItems = [],
                    trackHash,
                    showId,
                    movieId,
                    mainTitle,
                } = params;
                if (!items || items.length === 0)
                    return { success: true, results: {} };

                // If there is not a show id, which means we will not persist this context, which means even we give a temporaray one, it still has no meaning. So we don't give any context currently.
                // If we find some platform without a valid show id, we will consider to give some temporaray one.
                // But right now, we don't support it.
                const ctx = showId
                    ? await this.glossaryService.getContextForShow(
                          showId,
                          this.targetLanguage,
                      )
                    : null;

                const activeProvider: TranslationProvider = this.activeProvider;
                const translator =
                    await TranslatorRegistry.getTranslator(activeProvider);

                const response = await translator.translateBatch({
                    items,
                    contextItems,
                    targetLang: this.targetLanguage,
                    context: ctx,
                    signal,
                    mainTitle,
                });

                if (!response.success || !response.results) {
                    return {
                        success: false,
                        error: response.error || 'Translation failed',
                    };
                }

                const resultMap = response.results;

                // Cache translated cues
                if (trackHash && Object.keys(resultMap).length > 0) {
                    const activeTranslationModel =
                        activeProvider === 'google'
                            ? 'google'
                            : (await this.llmService.getClient('translator'))
                                  .model;

                    if (movieId) {
                        this.cacheRepository
                            .saveTranslatedCues({
                                trackHash,
                                movieId: movieId,
                                showTitle:
                                    ctx?.mainTitle ||
                                    ctx?.title ||
                                    mainTitle ||
                                    '',
                                targetLanguage: this.targetLanguage.promptName,
                                provider: activeProvider,
                                translationModel: activeTranslationModel,
                                supervisorModel: 'none',
                                items,
                                results: resultMap,
                            })
                            .catch((e) => this.logger.warn('Translation', e));
                    }
                }

                return {
                    success: true,
                    results: resultMap,
                    merged: response.merged,
                };
            } catch (err: unknown) {
                return {
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                };
            } finally {
                if (
                    this.currentActiveAbortController &&
                    this.currentActiveAbortController.signal === signal
                ) {
                    this.currentActiveAbortController = null;
                }
                this.isCurrentTaskUrgent = false;
            }
        }, isUrgent);
    }

    /**
     * Supervisor Review of translated cues
     */
    async reviewBatch(params: {
        items: ReviewCueItem[];
        contextItems?: PrecedingContextItem[];
        trackHash?: string;
        showId?: string;
        movieId?: string;
        mainTitle?: string;
        status?: 'reviewed' | 'pre_reviewed';
    }): Promise<{
        success: boolean;
        corrections?: Record<number, string>;
        usedTermsMap?: Record<number, Record<string, number>>;
        updatedContext?: ContextDTO;
        error?: string;
    }> {
        return this.supervisorQueue.enqueue(async () => {
            const {
                items,
                contextItems = [],
                trackHash,
                showId,
                movieId,
                mainTitle,
                status = 'reviewed',
            } = params;

            let ctx = showId
                ? await this.glossaryService.getContextForShow(
                      showId,
                      this.targetLanguage,
                  )
                : null;

            if (!items || items.length === 0) {
                return {
                    success: true,
                    corrections: {},
                    updatedContext: ctx?.toDTO(),
                };
            }

            const activeProvider: TranslationProvider = this.activeProvider;

            // For Google Translate (or providers with no supervisor), return raw translations immediately
            if (activeProvider === 'google') {
                return {
                    success: true,
                    corrections: {},
                    updatedContext: ctx?.toDTO(),
                };
            }

            const translator =
                await TranslatorRegistry.getTranslator(activeProvider);

            try {
                const reviewRes = await translator.reviewBatch({
                    items: items.map((i) => {
                        return {
                            id: i.id,
                            rawText: i.rawText,
                            transText: i.transText ?? '',
                            merged: i.merged,
                        };
                    }),
                    contextItems,
                    targetLang: this.targetLanguage,
                    context: ctx || null,
                    mainTitle,
                });

                if (!reviewRes.success) {
                    return { success: false, error: reviewRes.error };
                }

                const corrections = (reviewRes.corrections || {}) as Record<
                    number,
                    string
                >;

                if (
                    ctx &&
                    (reviewRes.newCharacters || reviewRes.newTerms) &&
                    ctx.showId
                ) {
                    ctx = await this.glossaryService.updateWarmupContext({
                        showId: ctx.showId,
                        targetLanguage: this.targetLanguage,
                        characters: reviewRes.newCharacters || {},
                        terms: (reviewRes.newTerms || {}) as Record<
                            string,
                            string
                        >,
                    });
                }

                // Compute used terms map using effective terms and characters
                const usedTermsMap: Record<number, Record<string, number>> = {};
                if (ctx) {
                    const effectiveTerms = ctx.getEffectiveTerms();
                    const effectiveChars = ctx.getEffectiveCharacters();

                    for (const item of items) {
                        const corrected = corrections[item.id];
                        const finalText =
                            corrected && corrected.trim().length > 0
                                ? corrected.trim()
                                : item.transText || '';
                        const used: Record<string, number> = {};

                        for (const [k, v] of Object.entries(effectiveTerms)) {
                            if (
                                (v && finalText.includes(v)) ||
                                (k && item.rawText && item.rawText.includes(k))
                            ) {
                                used[k] = ctx.getTermVersion(k);
                            }
                        }
                        for (const [k, v] of Object.entries(effectiveChars)) {
                            const val =
                                typeof v === 'string' ? v : v?.canonical || '';
                            if (
                                (val && finalText.includes(val)) ||
                                (k && item.rawText && item.rawText.includes(k))
                            ) {
                                used[k] = ctx.getTermVersion(k);
                            }
                        }

                        if (Object.keys(used).length > 0) {
                            usedTermsMap[item.id] = used;
                        }
                    }
                }

                // Save reviewed cues to cache
                if (trackHash && items.length > 0) {
                    const activeTranslationModel = (
                        await this.llmService.getClient('translator')
                    ).model;
                    const activeSupervisorModel = (
                        await this.llmService.getClient('supervisor')
                    ).model;

                    if (movieId) {
                        this.cacheRepository
                            .saveReviewedCues({
                                trackHash,
                                movieId: movieId,
                                showTitle:
                                    ctx?.mainTitle ||
                                    ctx?.title ||
                                    mainTitle ||
                                    '',
                                targetLanguage: this.targetLanguage.promptName,
                                provider: activeProvider,
                                translationModel: activeTranslationModel,
                                supervisorModel: activeSupervisorModel,
                                items,
                                corrections,
                                status,
                                usedTermsMap,
                            })
                            .catch(() => {});
                    }
                }

                return {
                    success: true,
                    corrections,
                    usedTermsMap,
                    updatedContext: ctx?.toDTO(),
                };
            } catch (err: unknown) {
                const errorMessage =
                    err instanceof Error ? err.message : String(err);
                return { success: false, error: errorMessage };
            }
        });
    }

    async extractTermsFromNativeBilingualCues(params: {
        showId: string;
        targetLanguage: LanguageInfo;
        pairs: Array<{ originalText: string; translatedText: string }>;
    }): Promise<{
        success: boolean;
        charactersAdded: number;
        termsAdded: number;
        error?: string;
    }> {
        const { showId, targetLanguage, pairs } = params;
        if (!pairs || pairs.length === 0) {
            return { success: true, charactersAdded: 0, termsAdded: 0 };
        }

        try {
            this.logger.info(
                'Translation',
                `Extracting terms from ${pairs.length} native bilingual dialogue pairs for show (${showId})`,
            );

            let sourceText = '';
            let targetText = '';
            for (const p of pairs) {
                if (!p.originalText || !p.translatedText) continue;
                sourceText += `${p.originalText}\n`;
                targetText += `${p.translatedText}\n`;
                if (sourceText.length >= 10000) break;
            }

            if (!sourceText.trim() || !targetText.trim()) {
                return { success: true, charactersAdded: 0, termsAdded: 0 };
            }

            const supervisorClient =
                await this.llmService.getClient('supervisor');
            const resolvedTargetLang =
                targetLanguage?.promptName || 'target language';

            const systemPrompt = `You are an expert bilingual subtitle translation supervisor and named-entity alignment assistant.
Task: Analyze the provided source-language dialogue and authoritative target-language translation reference texts.
Extract all key characters and specific recurring terms/proper nouns aligned between the two texts into a structured JSON glossary.

Target language for translations: "${resolvedTargetLang}".

Output Requirements:
1. "characters": Map each character's original source name (e.g. Japanese or English name) to an object with:
   - "canonical": The official standard translation/spelling in the target language (${resolvedTargetLang}).
   - "aliases": An array of alternate names, nicknames, honorific calls, or maiden names used in the reference text.
2. "terms": Map each recurring specialized term, organization name, fictional concept, or proper noun in the source text to its translated equivalent in ${resolvedTargetLang}.
3. Return ONLY valid JSON in the exact schema below, with no markdown code blocks, preamble, or comments:
{
  "characters": {
    "Original Name": { "canonical": "Target Name", "aliases": ["Nickname 1"] }
  },
  "terms": {
    "Source Term": "Target Term"
  }
}`;

            const userPrompt = `=== SOURCE DIALOGUE ===\n${sourceText.slice(0, 8000)}\n\n=== OFFICIAL TRANSLATION (${resolvedTargetLang}) ===\n${targetText.slice(0, 8000)}`;

            const response = await supervisorClient.chat({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                jsonMode: true,
            });

            const raw = (response || '').trim();
            const cleanJson = raw
                .replace(/^```json\s*/i, '')
                .replace(/```\s*$/i, '')
                .trim();
            const parsed = JSON.parse(cleanJson);

            const chars = parsed.characters || {};
            const terms = parsed.terms || {};
            const numChars = Object.keys(chars).length;
            const numTerms = Object.keys(terms).length;

            this.logger.info(
                'Translation',
                `Supervisor extracted ${numChars} characters and ${numTerms} terms from native subtitles.`,
            );

            if (numChars > 0 || numTerms > 0) {
                await this.glossaryService.updateWarmupContext({
                    showId,
                    targetLanguage,
                    characters: chars,
                    terms,
                });
            }

            return {
                success: true,
                charactersAdded: numChars,
                termsAdded: numTerms,
            };
        } catch (err: unknown) {
            this.logger.warn(
                'Translation',
                'Failed to extract terms from native subtitles:',
                err,
            );
            return {
                success: false,
                charactersAdded: 0,
                termsAdded: 0,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
}
