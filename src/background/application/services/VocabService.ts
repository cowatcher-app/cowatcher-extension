/**
 * VocabService
 * Extracts challenging vocabulary, terms, and expressions asynchronously from subtitle streams.
 * Maintains extractor configuration (target language, difficulty, model, provider) as internal state.
 */

import {
    TranslateCueItem,
    EpisodeVocabData,
    VocabWordItem,
    WordLookupRequest,
    WordLookupResult,
} from '@shared/types/Messages';
import { ITrackCacheRepository } from '@shared/domain/repositories/ITrackCacheRepository';
import { TrackCacheRepositoryFactory } from '../../infrastructure/cache/TrackCacheRepositoryFactory';
import { LlmService } from './LlmService';
import { LlmRole } from '../../domain/llm/LlmRole';
import { ExtensionSettings, NCW_CONSTANTS } from '@shared/utils/constants';
import { IBrowserStorage } from '@shared/infrastructure/storage/IBrowserStorage';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { ContentBackgroundBus } from '@shared/infrastructure/bus/ContentBackgroundBus';
import { NCW_STORAGE_KEYS } from '@shared/domain/constants/StorageKeys';
import { Language, LanguageInfo } from '@shared/domain/value-objects/Language';
import { Logger } from '@shared/utils/logger';
import { LLMProvider } from '@shared/domain/entities/PipelineTypes';
import { PhoneticAdapterFactory } from '@shared/infrastructure/phonetic/PhoneticAdapterFactory';

interface VocabTaskItem {
    taskFn: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
}

class VocabTaskQueue {
    private queue: VocabTaskItem[] = [];
    private activeCount = 0;
    private readonly concurrency: number;

    constructor(concurrency = 1) {
        this.concurrency = concurrency;
    }

    enqueue<T>(taskFn: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push({
                taskFn: taskFn as () => Promise<unknown>,
                resolve: resolve as (val: unknown) => void,
                reject,
            });
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
            item.reject(new Error('Vocab queue cleared'));
        }
    }
}

export interface VocabServiceConfig {
    enabled: boolean;
    sourceLanguage: LanguageInfo | 'auto';
    targetLanguage: LanguageInfo;
    difficulty: string; // This should have a domain entity/vo
    customPrompt: string;
    provider: LLMProvider;
    model: string;
    recordVocabAsLemma?: boolean;
}

export class VocabService {
    private static instance: VocabService | null = null;
    private readonly queue: VocabTaskQueue;
    private readonly llmService: LlmService;
    private processedVocabChunksByMovie: Map<string, Set<string>> = new Map();
    private readonly storage: IBrowserStorage;
    private readonly cacheRepository: ITrackCacheRepository;
    private config: VocabServiceConfig;

    private logger: Logger = new Logger('VocabService');

    private constructor(
        storage: IBrowserStorage = BrowserStorageFactory.getStorage(),
    ) {
        this.storage = storage;
        this.cacheRepository = TrackCacheRepositoryFactory.getRepository();
        this.queue = new VocabTaskQueue(1);
        this.llmService = LlmService.getInstance();
        this.config = {
            enabled: Boolean(
                NCW_CONSTANTS.DEFAULT_SETTINGS.vocabExtractorEnabled,
            ),
            sourceLanguage:
                NCW_CONSTANTS.DEFAULT_SETTINGS.vocabSourceLanguage || 'auto',
            targetLanguage:
                NCW_CONSTANTS.DEFAULT_SETTINGS.targetLanguage ||
                Language.DEFAULT,
            difficulty:
                NCW_CONSTANTS.DEFAULT_SETTINGS.vocabExtractorDifficulty ||
                'medium',
            customPrompt:
                NCW_CONSTANTS.DEFAULT_SETTINGS.vocabExtractorCustomPrompt || '',
            provider:
                NCW_CONSTANTS.DEFAULT_SETTINGS.vocabExtractorProvider ||
                'openrouter',
            model:
                NCW_CONSTANTS.DEFAULT_SETTINGS.vocabExtractorModel ||
                'deepseek/deepseek-chat',
        };
    }

    async init(): Promise<void> {
        await this.llmService.init();
        await this.initFromStorage();

        this.storage.onChanged((changes) => {
            if (changes[NCW_STORAGE_KEYS.SETTINGS]?.newValue) {
                this.updateConfigFromSettings(
                    changes[NCW_STORAGE_KEYS.SETTINGS]
                        .newValue as Partial<ExtensionSettings>,
                );
            }
        });
    }

    static getInstance(storage?: IBrowserStorage): VocabService {
        if (!VocabService.instance) {
            VocabService.instance = new VocabService(storage);
        }
        return VocabService.instance;
    }

    async initFromStorage(): Promise<void> {
        const res = await this.storage.get<Partial<ExtensionSettings>>([
            NCW_STORAGE_KEYS.SETTINGS,
        ]);
        if (res && res[NCW_STORAGE_KEYS.SETTINGS]) {
            this.updateConfigFromSettings(res[NCW_STORAGE_KEYS.SETTINGS]);
        }
    }

    updateConfigFromSettings(settings: Partial<ExtensionSettings>): void {
        if (!settings) return;
        const rawProvider =
            settings.vocabExtractorProvider ||
            this.config.provider;
        const provider: LLMProvider =
            rawProvider === 'ollama' ? 'ollama' : 'openrouter';
        const model =
            provider === 'openrouter'
                ? settings.vocabExtractorModel || 'deepseek/deepseek-chat'
                : settings.vocabExtractorOllamaModel || 'qwen2.5:7b';

        this.config = {
            enabled:
                settings.vocabExtractorEnabled !== undefined
                    ? Boolean(settings.vocabExtractorEnabled)
                    : this.config.enabled,
            sourceLanguage:
                settings.vocabSourceLanguage || this.config.sourceLanguage,
            targetLanguage: settings.targetLanguage
                ? Language.resolve(settings.targetLanguage)
                : this.config.targetLanguage,
            difficulty:
                settings.vocabExtractorDifficulty || this.config.difficulty,
            customPrompt:
                settings.vocabExtractorCustomPrompt !== undefined
                    ? settings.vocabExtractorCustomPrompt
                    : this.config.customPrompt,
            provider,
            model,
            recordVocabAsLemma:
                settings.recordVocabAsLemma !== undefined
                    ? Boolean(settings.recordVocabAsLemma)
                    : this.config.recordVocabAsLemma !== false,
        };
    }

    getConfig(): VocabServiceConfig {
        return { ...this.config };
    }

    clearQueues(): void {
        this.queue.clear();
    }

    async getVocabData(movieId?: string): Promise<EpisodeVocabData | null> {
        // TODO: Show id
        if (!movieId) return null;
        try {
            const storageKey = `${NCW_STORAGE_KEYS.VOCAB_PREFIX}${movieId}`;
            const res = await this.storage.get<EpisodeVocabData>([storageKey]);
            return (res[storageKey] || null) as EpisodeVocabData | null;
        } catch {
            return null;
        }
    }

    async resetVocabData(movieId: string): Promise<void> {
        if (!movieId) return;
        this.processedVocabChunksByMovie.delete(movieId);
        try {
            await this.storage.remove([
                `${NCW_STORAGE_KEYS.VOCAB_PREFIX}${movieId}`,
            ]);
        } catch {
            // Ignore
        }
    }

    async saveUserMarkedWord(params: {
        movieId: string;
        showTitle?: string;
        wordItem: VocabWordItem;
    }): Promise<{ success: boolean; data?: VocabWordItem }> {
        const { movieId, showTitle = '', wordItem } = params;
        if (!movieId || !wordItem || !wordItem.word) {
            return { success: false };
        }

        const rawWord = wordItem.word.trim();
        const srcLangStr =
            wordItem.sourceLang ||
            (typeof this.config.sourceLanguage === 'object' &&
            this.config.sourceLanguage !== null
                ? this.config.sourceLanguage.code
                : this.config.sourceLanguage || 'auto');

        const adapter = PhoneticAdapterFactory.getAdapter(srcLangStr);
        let resolvedLemma = (wordItem.lemma || '').trim();
        if (!resolvedLemma && adapter) {
            try {
                resolvedLemma = await adapter.getLemma(rawWord);
            } catch {
                // ignore
            }
        }
        if (!resolvedLemma) {
            resolvedLemma = rawWord;
        }

        const recordAsLemma = this.config.recordVocabAsLemma !== false;
        const targetHeadword = recordAsLemma ? (resolvedLemma || rawWord) : rawWord;

        let phonetic = wordItem.phonetic;
        if (!phonetic && adapter) {
            try {
                phonetic = await adapter.getWordReading(resolvedLemma || targetHeadword);
            } catch {
                // ignore
            }
        }

        const item: VocabWordItem = {
            ...wordItem,
            word: targetHeadword,
            lemma: resolvedLemma,
            dictMeaning: wordItem.dictMeaning || undefined,
            phonetic: phonetic || wordItem.phonetic || '',
            source: 'user',
            createdAt: wordItem.createdAt || Date.now(),
            timestamp: wordItem.timestamp || Date.now(),
            frequency: wordItem.frequency || 1,
        };

        await this.mergeVocabData(
            movieId,
            showTitle,
            this.config.sourceLanguage,
            this.config.targetLanguage,
            this.config.difficulty,
            this.config.customPrompt,
            this.config.model,
            [item],
        );

        return { success: true, data: item };
    }

    async deleteUserMarkedWord(params: {
        movieId: string;
        word: string;
    }): Promise<{ success: boolean }> {
        const { movieId, word } = params;
        if (!movieId || !word) return { success: false };

        const storageKey = `${NCW_STORAGE_KEYS.VOCAB_PREFIX}${movieId}`;
        const res = await this.storage.get<EpisodeVocabData>([storageKey]);
        const existing = res[storageKey] as EpisodeVocabData | undefined;
        if (!existing || !Array.isArray(existing.words))
            return { success: true };

        const filtered = existing.words.filter(
            (w) => w.word.toLowerCase() !== word.toLowerCase(),
        );

        const updatedData: EpisodeVocabData = {
            ...existing,
            updatedAt: Date.now(),
            totalWords: filtered.length,
            words: filtered,
        };

        await this.storage.set({ [storageKey]: updatedData });
        ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.PUSH_VOCAB_CHANGED,
            {
                data: updatedData,
            },
        ).catch(() => {});

        return { success: true };
    }

    async lookupWordDefinition(
        req: WordLookupRequest,
    ): Promise<{ success: boolean; data?: WordLookupResult; error?: string }> {
        const {
            word,
            contextSentence,
            contextTranslation,
            sourceLang,
            targetLang,
            customPrompt,
            preferredRole,
        } = req;
        if (!word) return { success: false, error: 'Word is required' };

        const adapter = PhoneticAdapterFactory.getAdapter(sourceLang);
        let detectedLemma = word;
        if (adapter) {
            try {
                detectedLemma = await adapter.getLemma(word);
            } catch {
                // ignore
            }
        }
        const primaryLemma =
            detectedLemma &&
            detectedLemma.toLowerCase() !== word.toLowerCase()
                ? detectedLemma
                : '';

        // 1. Check if corresponding language dict adapter provides getMeaning
        let dictMeaning: string | null = null;
        if (adapter && typeof adapter.getMeaning === 'function') {
            try {
                dictMeaning = await adapter.getMeaning(
                    primaryLemma || word,
                    targetLang,
                    { sourceLang },
                );
                if (!dictMeaning && primaryLemma) {
                    dictMeaning = await adapter.getMeaning(
                        word,
                        targetLang,
                        { sourceLang },
                    );
                }
            } catch {
                dictMeaning = null;
            }
        }

        // 2. Check if LLM is active/available for Vocabulary lookup
        // Priority:
        // 1) Dedicated 'vocab' role if active (default and preferred for all vocabulary lookups)
        // 2) 'supervisor' if explicitly preferred or as fallback if supervisor is active
        // 3) 'translator' as fallback if active
        let role: LlmRole | null = null;
        if (await this.llmService.isVocabActive()) {
            role = 'vocab';
        } else if (
            preferredRole === 'supervisor' &&
            (await this.llmService.isSupervisorActive())
        ) {
            role = 'supervisor';
        } else if (await this.llmService.isSupervisorActive()) {
            role = 'supervisor';
        } else if (await this.llmService.isTranslatorActive()) {
            role = 'translator';
        }

        if (role) {
            try {

                const customInstruction = customPrompt?.trim()
                    ? `\nCustom Instructions from User:\n${customPrompt.trim()}\n`
                    : '';

                const lemmaInstruction = primaryLemma
                    ? `\nNote on Morphology: The contextual word "${word}" has root dictionary lemma "${primaryLemma}". In your explanation, please explain the meaning and grammatical role of "${word}" in the context sentence, and also provide the base dictionary definition for the root lemma "${primaryLemma}".`
                    : '';

                const prompt = `You are an expert bilingual dictionary and language tutor.
Given the word or phrase "${word}" used in the context sentence:
"${contextSentence}"${contextTranslation ? ` (Translation: "${contextTranslation}")` : ''}

Language: ${sourceLang} -> ${targetLang}
${lemmaInstruction}
${customInstruction}
Provide a concise, accurate JSON response with the following schema:
{
  "word": "${word}",
  "lemma": "${primaryLemma || 'dictionary / base lemma form'}",
  "reading": "phonetic transcription / furigana / pinyin / IPA",
  "pos": "part of speech (noun, verb, phrase, etc.)",
  "meaning": "clear definition in ${targetLang} suited for this context",
  "grammarNotes": "brief 1-sentence note on conjugation, tense, nuance, inflection from root lemma, or custom requested info if applicable",
  "exampleSentence": "a simple, natural example sentence using this word",
  "exampleTranslation": "translation of the example sentence in ${targetLang}"
}
Only output the valid JSON object, no other commentary.`;

                const raw = await this.llmService.callChat(role, {
                    messages: [{ role: 'user', content: prompt }],
                    jsonMode: true,
                    temperature: 0.2,
                });

                const clean = (raw || '')
                    .replace(/<think[\s\S]*?<\/think>/gi, '')
                    .replace(/<thought[\s\S]*?<\/thought>/gi, '')
                    .trim();
                const parsed = JSON.parse(clean);

                const resolvedLemma = parsed.lemma || primaryLemma || word;
                let reading = parsed.reading || '';
                if (adapter) {
                    try {
                        // Query phonetic reading via lemma first to maximize dictionary accuracy
                        const deterministic = await adapter.getWordReading(
                            primaryLemma || resolvedLemma || word,
                        );
                        if (deterministic) {
                            reading = deterministic;
                        }
                    } catch {
                        // Fall back to parsed.reading
                    }
                }

                return {
                    success: true,
                    data: {
                        word: parsed.word || word,
                        lemma: resolvedLemma,
                        reading,
                        pos: parsed.pos || '',
                        dictMeaning: dictMeaning || undefined,
                        meaning: parsed.meaning || '',
                        grammarNotes: parsed.grammarNotes || '',
                        exampleSentence:
                            parsed.exampleSentence || contextSentence,
                        exampleTranslation:
                            parsed.exampleTranslation || contextTranslation,
                    },
                };
            } catch (llmErr) {
                this.logger.warn(
                    'Lookup',
                    'LLM lookup failed, falling back to general adapter:',
                    llmErr,
                );
            }
        }

        // Fallback / Google mode (No LLM active or LLM failed):
        // Use GeneralDictionaryAdapter only if specialized dictionary meaning was not found
        let generalMeaning: string | null = null;
        if (!dictMeaning) {
            try {
                const generalAdapter =
                    PhoneticAdapterFactory.getAdapter('general');
                if (
                    generalAdapter &&
                    typeof generalAdapter.getMeaning === 'function'
                ) {
                    generalMeaning = await generalAdapter.getMeaning(
                        primaryLemma || word,
                        targetLang,
                        { sourceLang },
                    );
                    // If lookup using primaryLemma yielded nothing, try raw word
                    if (!generalMeaning && primaryLemma) {
                        generalMeaning = await generalAdapter.getMeaning(
                            word,
                            targetLang,
                            { sourceLang },
                        );
                    }
                }
            } catch {
                generalMeaning = null;
            }
        }

        let reading = '';
        if (adapter) {
            try {
                reading = await adapter.getWordReading(
                    primaryLemma || detectedLemma || word,
                );
            } catch {
                // ignore
            }
        }

        const fallbackMeaning =
            dictMeaning ||
            generalMeaning ||
            (primaryLemma
                ? `Base form: ${primaryLemma}`
                : 'Tap to lookup or right-click to save');

        return {
            success: true,
            data: {
                word,
                lemma: primaryLemma || detectedLemma || word,
                reading,
                pos: '',
                dictMeaning: dictMeaning || undefined,
                meaning: fallbackMeaning,
                exampleSentence: contextSentence,
                exampleTranslation: contextTranslation,
            },
        };
    }

    async feedVocabCues(params: {
        movieId: string; // TODO: Show id?
        cues: TranslateCueItem[];
        showTitle: string;
        sourceLanguage?: LanguageInfo | 'auto';
        trackHash?: string;
    }): Promise<void> {
        const {
            movieId,
            cues,
            showTitle,
            sourceLanguage,
            trackHash = '',
        } = params;

        if (!this.config.enabled) return;
        if (!movieId || !cues || cues.length === 0) return;

        const midStr = String(movieId);
        if (!this.processedVocabChunksByMovie.has(midStr)) {
            this.processedVocabChunksByMovie.set(midStr, new Set());
        }
        const processedSet = this.processedVocabChunksByMovie.get(midStr)!;

        const {
            customPrompt,
            difficulty,
            sourceLanguage: cfgSrcLang,
            targetLanguage: tgtLang,
            provider,
            model,
        } = this.config;
        const resolvedInputSrc =
            sourceLanguage && sourceLanguage !== 'auto'
                ? Language.resolve(sourceLanguage)
                : undefined;
        const srcLang: LanguageInfo | 'auto' =
            cfgSrcLang && cfgSrcLang !== 'auto'
                ? cfgSrcLang
                : resolvedInputSrc || 'auto';

        const CHUNK_SIZE = 30;
        const srcLangKey = typeof srcLang === 'object' ? srcLang.code : srcLang;
        for (let i = 0; i < cues.length; i += CHUNK_SIZE) {
            const chunk = cues.slice(i, i + CHUNK_SIZE);
            const chunkSig = `${chunk[0]?.id || i}_${chunk[chunk.length - 1]?.id || i}_${chunk.length}_${difficulty}_${srcLangKey}_${customPrompt.slice(0, 30)}`;

            if (processedSet.has(chunkSig)) continue;

            if (trackHash) {
                try {
                    const isScanned = await this.cacheRepository.isVocabScanned(
                        {
                            trackHash,
                            targetLanguage: tgtLang.code,
                            provider,
                            translationModel: model,
                            chunkSig,
                        },
                    );
                    if (isScanned) {
                        processedSet.add(chunkSig);
                        continue;
                    }
                } catch {
                    // Ignore
                }
            }

            processedSet.add(chunkSig);

            this.queue
                .enqueue(async () => {
                    const result = await this.processVocabBatch(chunk, {
                        movieId: midStr,
                        showTitle,
                        sourceLanguage: srcLang,
                        targetLanguage: tgtLang,
                        difficulty,
                        customPrompt,
                        vocabExtractorProvider: provider,
                        model,
                    });

                    if (trackHash) {
                        this.cacheRepository
                            .markVocabScanned({
                                trackHash,
                                targetLanguage: tgtLang.code,
                                provider,
                                translationModel: model,
                                chunkSig,
                                cueIds: chunk.map((c) => c.id),
                            })
                            .catch(() => {});
                    }

                    return result;
                })
                .catch((e) => {
                    this.logger.warn(
                        'Vocabulary',
                        'Vocab queue task error:',
                        e,
                    );
                });
        }
    }

    private async processVocabBatch(
        cuesBatch: TranslateCueItem[],
        options: {
            movieId: string;
            showTitle: string;
            sourceLanguage: LanguageInfo | 'auto';
            targetLanguage: LanguageInfo;
            difficulty: string;
            customPrompt: string;
            vocabExtractorProvider: LLMProvider;
            model: string;
        },
    ): Promise<{ vocab: VocabWordItem[] }> {
        const {
            movieId,
            showTitle,
            sourceLanguage,
            targetLanguage,
            difficulty,
            customPrompt,
            model,
        } = options;

        if (!cuesBatch || cuesBatch.length === 0) return { vocab: [] };

        const isVocabActive = await this.llmService.isVocabActive();
        if (!isVocabActive) {
            this.logger.warn(
                'Vocabulary',
                'Vocab LLM is not active or reachable, skipping extraction batch.',
            );
            return { vocab: [] };
        }

        const resolvedTargetLang = Language.resolve(targetLanguage).promptName;
        const resolvedSourceLang =
            sourceLanguage && sourceLanguage !== 'auto'
                ? Language.resolve(sourceLanguage).promptName
                : 'the original dialogue language (auto-detected)';
        const dialoguesText = cuesBatch
            .map((c) => `[ID:${c.id}]: ${c.rawText.replace(/\s+/g, ' ')}`)
            .join('\n');

        const prompt = `You are an expert language vocabulary extractor.
Extract meaningful, difficult, idiomatic, or important vocabulary, phrasal verbs, slang, or key terms from these subtitle lines for a learner.
Show Title: "${showTitle}"
Source Language: ${resolvedSourceLang}
Target Language: ${resolvedTargetLang}
Difficulty Level: ${difficulty}
${customPrompt ? `Special instructions: ${customPrompt}\n` : ''}

Output strictly JSON:
{
  "vocab": [
    {
      "word": "lemma/headword",
      "pos": "part of speech (n./v./adj./idiom...)",
      "phonetic": "IPA or phonetic transcription",
      "meaning": "Definition/translation in ${resolvedTargetLang}",
      "sentence": "Original context sentence excerpt from dialogues",
      "sentenceTranslation": "Translation of the excerpt in ${resolvedTargetLang}"
    }
  ]
}

Dialogue excerpt:
${dialoguesText}`;

        try {
            const raw = await this.llmService.callChat('vocab', {
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                jsonMode: true,
            });

            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return { vocab: [] };

            const parsed = JSON.parse(jsonMatch[0]);
            const rawList = Array.isArray(parsed.vocab) ? parsed.vocab : [];

            const validList: VocabWordItem[] = [];
            const now = Date.now();
            const resolvedSrcStr =
                typeof sourceLanguage === 'object' && sourceLanguage !== null
                    ? sourceLanguage.code
                    : sourceLanguage || 'auto';
            const resolvedTgtStr =
                typeof targetLanguage === 'object' && targetLanguage !== null
                    ? targetLanguage.code
                    : String(targetLanguage || 'en');

            const adapter = PhoneticAdapterFactory.getAdapter(resolvedSrcStr);
            const recordAsLemma = this.config.recordVocabAsLemma !== false;
            for (const item of rawList) {
                if (
                    item &&
                    typeof item.word === 'string' &&
                    item.word.trim().length > 0
                ) {
                    const rawWord = item.word.trim();
                    let lemma =
                        typeof item.lemma === 'string' && item.lemma.trim()
                            ? item.lemma.trim()
                            : '';
                    if (!lemma && adapter) {
                        try {
                            lemma = await adapter.getLemma(rawWord);
                        } catch {
                            // ignore
                        }
                    }
                    if (!lemma) lemma = rawWord;

                    const headword = recordAsLemma ? lemma : rawWord;
                    let phonetic = String(item.phonetic || '');
                    if (adapter) {
                        try {
                            const deterministic = await adapter.getWordReading(
                                lemma || headword,
                            );
                            if (deterministic) {
                                phonetic = deterministic;
                            }
                        } catch {
                            // Fallback to item.phonetic
                        }
                    }

                    validList.push({
                        word: headword,
                        lemma,
                        pos: String(item.pos || ''),
                        phonetic,
                        meaning: String(item.meaning || ''),
                        sentence: String(item.sentence || ''),
                        sentenceTranslation: String(
                            item.sentenceTranslation || '',
                        ),
                        timestamp: now,
                        frequency: 1,
                        sourceLang: resolvedSrcStr,
                        targetLang: resolvedTgtStr,
                    });
                }
            }

            if (validList.length > 0) {
                await this.mergeVocabData(
                    movieId,
                    showTitle,
                    sourceLanguage,
                    targetLanguage,
                    difficulty,
                    customPrompt,
                    model,
                    validList,
                );
            }

            return { vocab: validList };
        } catch (err: unknown) {
            this.logger.warn(
                'Vocabulary',
                'Vocab extraction batch failed:',
                err,
            );
            return { vocab: [] };
        }
    }

    private async mergeVocabData(
        movieId: string, // TODO: Show id.
        showTitle: string,
        sourceLanguage: LanguageInfo | 'auto',
        targetLanguage: LanguageInfo,
        difficulty: string,
        customPrompt: string,
        model: string,
        newWords: VocabWordItem[],
    ): Promise<void> {
        const storageKey = `${NCW_STORAGE_KEYS.VOCAB_PREFIX}${movieId}`;
        const res = await this.storage.get<EpisodeVocabData>([storageKey]);
        const existing = res[storageKey] as EpisodeVocabData | undefined;

        const wordsMap = new Map<string, VocabWordItem>();
        if (existing && Array.isArray(existing.words)) {
            for (const w of existing.words) {
                wordsMap.set(w.word.toLowerCase(), w);
            }
        }

        const srcCode =
            typeof sourceLanguage === 'object' && sourceLanguage !== null
                ? sourceLanguage.code
                : sourceLanguage || 'auto';
        const tgtCode =
            typeof targetLanguage === 'object' && targetLanguage !== null
                ? targetLanguage.code
                : String(targetLanguage || 'en');

        for (const w of newWords) {
            const key = w.word.toLowerCase();
            if (wordsMap.has(key)) {
                const old = wordsMap.get(key)!;
                const isUserSource =
                    w.source === 'user' || old.source === 'user';
                wordsMap.set(key, {
                    ...old,
                    lemma: w.lemma || old.lemma,
                    dictMeaning: w.dictMeaning || old.dictMeaning,
                    meaning: w.meaning || old.meaning,
                    sentence: w.sentence || old.sentence,
                    sentenceTranslation:
                        w.sentenceTranslation || old.sentenceTranslation,
                    pos: w.pos || old.pos,
                    phonetic: w.phonetic || old.phonetic,
                    sourceLang:
                        old.sourceLang || w.sourceLang || srcCode,
                    targetLang:
                        old.targetLang || w.targetLang || tgtCode,
                    source: isUserSource
                        ? 'user'
                        : w.source || old.source || 'ai',
                    createdAt: old.createdAt || w.createdAt || Date.now(),
                    frequency: (old.frequency || 1) + 1,
                    timestamp: Date.now(),
                });
            } else {
                wordsMap.set(key, {
                    ...w,
                    sourceLang: w.sourceLang || srcCode,
                    targetLang: w.targetLang || tgtCode,
                    source: w.source || 'ai',
                    createdAt: w.createdAt || Date.now(),
                });
            }
        }

        const mergedWords = Array.from(wordsMap.values());
        mergedWords.sort((a, b) => b.timestamp - a.timestamp);

        const srcLangStr =
            typeof sourceLanguage === 'object' && sourceLanguage !== null
                ? sourceLanguage.code
                : sourceLanguage || 'auto';
        const tgtLangStr =
            typeof targetLanguage === 'object' && targetLanguage !== null
                ? targetLanguage.code
                : String(targetLanguage || 'en');

        const updatedData: EpisodeVocabData = {
            movieId,
            showTitle: showTitle || existing?.showTitle || '',
            sourceLanguage: srcLangStr || existing?.sourceLanguage || 'auto',
            targetLanguage: tgtLangStr || existing?.targetLanguage || 'en',
            difficulty: difficulty || existing?.difficulty || 'medium',
            customPrompt: customPrompt || existing?.customPrompt || '',
            model: model || existing?.model || '',
            updatedAt: Date.now(),
            totalWords: mergedWords.length,
            words: mergedWords,
        };

        await this.storage.set({ [storageKey]: updatedData });
        ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.PUSH_VOCAB_CHANGED,
            {
                data: updatedData,
            },
        ).catch(() => {});
    }
}
