import {
    SubtitleCue,
    createSubtitleCue,
} from '@shared/domain/entities/Subtitle';
import { PrecedingContextItem } from '@shared/types/Messages';
import {
    ExtensionSettings,
    NCW_CONSTANTS,
    PipelineConfig,
} from '@shared/utils/constants';
import { Logger } from '@shared/utils/logger';
import { computeTrackHash } from '@shared/utils/hash';
import { Language, LanguageInfo } from '@shared/domain/value-objects/Language';
import { Context } from '@shared/domain/entities/Context';
import { ContentMessageService } from '../services/ContentMessageService';
import { IStreamingAdapter } from '../../domain/adapters/IStreamingAdapter';
import {
    SubtitleAlignmentService,
    AlignmentResult,
} from '../../domain/services/SubtitleAlignmentService';
import { SubtitleStore } from '../store/SubtitleStore';
import { TranslationStatus } from '@shared/domain/entities/Translation';
import { SubtitleCueCacheMap } from '@shared/domain/entities/PipelineTypes';

export interface SubtitlePipelineDelegate {
    isContextValid(): boolean;
    isAdPlaying(): boolean;
    isVideoPaused(): boolean;
    detachVideo(): void;
    getEffectiveTime(): number;
    findCueIndexAtTime(time: number): number;
    findActiveCues(time: number): SubtitleCue[];
    onTick(): void;
    invalidateCueSig?(): void;
    checkAsrMerge(currentTime: number): void;
    getCurrentMovieId(): string | null;
    getCurrentShowId(): string | null;
    getCurrentContext(): Context;
    onContextUpdated(context: Context): void;
    getCurrentRawLanguage(): string;
    isAsrTrack(): boolean;
    getRawAsrCuesCount(): number;
    getAsrMergeIndex(): number;
}

interface ReviewQueueItem {
    readonly id: number;
    readonly orig: string;
    readonly trans: string;
    readonly cueIndex: number;
    readonly start: number;
    readonly end: number;
    readonly merged?: number[];
}

export class SubtitlePipelineCoordinator {
    private readonly logger = new Logger('SubtitlePipelineCoordinator');

    isTranslating = false;
    isReviewing = false;
    isPreReviewing = false;
    private nativePollingTimer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly messageService: ContentMessageService,
        private readonly store: SubtitleStore,
        private readonly delegate: SubtitlePipelineDelegate,
        private readonly getSettings: () => Partial<ExtensionSettings>,
        private readonly adapter?: IStreamingAdapter,
    ) {}

    isLanguageMatchingTarget(
        rawLangStr: string,
        targetLangCode: string,
    ): boolean {
        return Language.matches(rawLangStr, targetLangCode);
    }

    getPrecedingContextItems(
        targetCueIndex: number,
        maxContext = 3,
    ): PrecedingContextItem[] {
        const cues = this.store.cues;
        if (cues.length === 0 || targetCueIndex <= 0) return [];
        const start = Math.max(0, targetCueIndex - maxContext);
        const contextCues = cues.slice(start, targetCueIndex);
        return contextCues.map((c) => {
            const transEntry = this.store.translationMap.get(c.id);
            return createSubtitleCue({
                ...c,
                transText: transEntry
                    ? transEntry.text
                    : c.transText || undefined,
            });
        });
    }

    checkPipeline(currentTime: number): void {
        if (!this.delegate.isContextValid()) {
            this.delegate.detachVideo();
            return;
        }
        if (this.delegate.isAsrTrack()) {
            this.delegate.checkAsrMerge(currentTime);
        }
        if (
            this.delegate.isAdPlaying() ||
            !this.getSettings().enabled ||
            this.store.cues.length === 0
        )
            return;

        const currentIdx = this.delegate.findCueIndexAtTime(currentTime);
        if (currentIdx < 0 || currentIdx >= this.store.cues.length) return;

        const config = NCW_CONSTANTS.getPipelineConfig(this.getSettings());
        if (this.checkSeekBurst(currentIdx, config)) return;
        this.checkEmergencyPreReview(currentIdx);

        const translatedAhead = this.countTranslatedAhead(
            currentIdx,
            config.refillThreshold || 12,
        );
        if (
            translatedAhead < (config.refillThreshold || 8) &&
            !this.isTranslating
        ) {
            this.fetchNextTranslationBatch(currentIdx, config);
        }

        if (
            !this.isReviewing &&
            this.getSettings().enableSupervisor !== false
        ) {
            const isPaused = this.delegate.isVideoPaused();
            const isNearEnd =
                currentIdx + translatedAhead >= this.store.cues.length - 1;
            if (translatedAhead >= 4 || isPaused || isNearEnd) {
                this.processSupervisorReviewQueue(config);
            }
        }
    }

    private checkSeekBurst(
        currentIdx: number,
        config: PipelineConfig,
    ): boolean {
        const currentCue = this.store.cues[currentIdx];
        const isCurrentTranslated = currentCue
            ? this.store.isCueTranslated(currentCue.id)
            : true;
        if (!isCurrentTranslated && !this.isTranslating) {
            const burstSize = Math.max(config.minTranslateCues || 1, 6);
            this.fetchSeekBurstBatch(currentIdx, burstSize);
            return true;
        }
        return false;
    }

    private checkEmergencyPreReview(currentIdx: number): void {
        if (
            this.getSettings().enableSupervisor === false ||
            this.isPreReviewing
        )
            return;
        if (currentIdx - this.store.canonicalReviewIndex <= 4) return;

        const preReviewCues = this.store.cues
            .slice(currentIdx, Math.min(this.store.cues.length, currentIdx + 6))
            .filter(
                (c) =>
                    this.store.getCueStatus(c.id) === 'raw' &&
                    this.store.translationMap.has(c.id),
            );

        if (preReviewCues.length > 0) {
            this.fetchEmergencyPreReview(preReviewCues, currentIdx);
        }
    }

    private countTranslatedAhead(
        currentIdx: number,
        threshold: number,
    ): number {
        let translatedAhead = 0;
        const limit = Math.min(this.store.cues.length, currentIdx + threshold);
        for (let i = currentIdx + 1; i < limit; i++) {
            if (this.store.isCueTranslated(this.store.cues[i].id)) {
                translatedAhead++;
            } else {
                break;
            }
        }
        return translatedAhead;
    }

    async fetchSeekBurstBatch(
        currentIdx: number,
        burstSize: number,
    ): Promise<void> {
        if (this.isTranslating) return;
        this.isTranslating = true;

        try {
            const endIdx = Math.min(
                this.store.cues.length,
                currentIdx + burstSize,
            );
            const burstCues = this.store.cues.slice(currentIdx, endIdx);
            const missing = burstCues.filter(
                (c) => c && !this.store.isCueTranslated(c.id),
            );

            if (missing.length > 0) {
                this.logger.info(
                    'SubtitlePipelineCoordinator',
                    `Seek Burst (size=${burstSize}): translating ${missing.length} cues around index ${currentIdx}...`,
                );
                missing.forEach((c) =>
                    this.store.setCueStatus(c.id, 'translating'),
                );
                const firstMissingIdx = this.store.cues.findIndex(
                    (c) => c && c.id === missing[0].id,
                );
                const contextItems = this.getPrecedingContextItems(
                    firstMissingIdx >= 0 ? firstMissingIdx : currentIdx,
                    3,
                );
                await this.dispatchTranslationSubBatch(
                    missing,
                    contextItems,
                    true,
                );
            }
        } catch (err) {
            this.logger.error(
                'SubtitlePipelineCoordinator',
                'Error in fetchSeekBurstBatch:',
                err,
            );
        } finally {
            this.isTranslating = false;
        }
    }

    async fetchEmergencyPreReview(
        cuesToPreReview: SubtitleCue[],
        currentIdx: number,
    ): Promise<void> {
        if (this.isPreReviewing || cuesToPreReview.length === 0) return;
        this.isPreReviewing = true;
        const epoch = this.store.sessionEpoch;
        cuesToPreReview.forEach((c) =>
            this.store.setCueStatus(c.id, 'pre_reviewing'),
        );

        try {
            const firstIdx = this.store.cues.findIndex(
                (c) => c.id === cuesToPreReview[0].id,
            );
            const contextItems = this.getPrecedingContextItems(
                firstIdx >= 0 ? firstIdx : currentIdx,
                3,
            );
            const reviewItems = cuesToPreReview.map((c) =>
                createSubtitleCue({
                    ...c,
                    merged: c.merged ?? this.store.translationMap.get(c.id)?.merged,
                    transText:
                        this.store.translationMap.get(c.id)?.text ||
                        c.transText ||
                        '',
                }),
            );

            const res = await this.messageService.reviewBatch({
                items: reviewItems,
                contextItems,
                trackHash: this.store.currentTrackHash,
                showId: this.delegate.getCurrentShowId() || undefined,
                movieId: this.delegate.getCurrentMovieId() || undefined,
                status: 'pre_reviewed',
            });

            if (this.store.sessionEpoch !== epoch) return;
            if (res?.success) {
                this.applyPreReviewResults(
                    cuesToPreReview,
                    res.corrections || {},
                    res.usedTermsMap || {},
                );
                if (res.updatedContext)
                    this.delegate.onContextUpdated(
                        Context.fromDTO(res.updatedContext),
                    );
            } else {
                this.resetPreReviewCues(cuesToPreReview);
            }
        } catch (err) {
            this.logger.warn(
                'SubtitlePipelineCoordinator',
                'Emergency Pre-Review error:',
                err,
            );
            this.resetPreReviewCues(cuesToPreReview);
        } finally {
            this.isPreReviewing = false;
        }
    }

    private applyPreReviewResults(
        cues: SubtitleCue[],
        corrections: Record<number, string>,
        usedTermsMap: Record<number, Record<string, number>>,
    ): void {
        cues.forEach((c) => {
            const correctedText = corrections[c.id];
            const existing = this.store.translationMap.get(c.id);
            const finalText =
                correctedText && correctedText.trim().length > 0
                    ? correctedText.trim()
                    : existing?.text || '';
            const usedTerms = usedTermsMap[c.id] || existing?.usedTerms;
            this.store.setTranslation(
                c.id,
                finalText,
                'pre_reviewed',
                usedTerms,
            );
        });

        const activeCues = this.delegate.findActiveCues(
            this.delegate.getEffectiveTime(),
        );
        if (activeCues.some((c) => cues.some((pr) => pr.id === c.id))) {
            this.invalidateCueCacheAndTick();
        }
    }

    private invalidateCueCacheAndTick(): void {
        this.store.lastCueSig = '';
        this.delegate.invalidateCueSig?.();
        this.delegate.onTick();
    }

    private resetPreReviewCues(cues: SubtitleCue[]): void {
        cues.forEach((c) => {
            if (this.store.getCueStatus(c.id) === 'pre_reviewing') {
                this.store.setCueStatus(c.id, 'raw');
            }
        });
    }

    private findTranslationStartGap(currentIdx: number): number {
        for (let i = currentIdx + 1; i < this.store.cues.length; i++) {
            if (!this.store.isCueTranslated(this.store.cues[i].id)) return i;
        }
        for (let i = this.store.canonicalReviewIndex; i <= currentIdx; i++) {
            if (!this.store.isCueTranslated(this.store.cues[i].id)) return i;
        }
        return -1;
    }

    private isEndOfTrack(
        startGapIdx: number,
        missing: SubtitleCue[],
        minCues: number,
        endIdx: number,
    ): boolean {
        const isAsr = this.delegate.isAsrTrack();
        const asrFinished =
            !isAsr ||
            this.delegate.getAsrMergeIndex() >=
                this.delegate.getRawAsrCuesCount();
        const lastMissingCue = missing[missing.length - 1];
        const lastMissingIdx = this.store.cues.findIndex(
            (c) => c && c.id === lastMissingCue.id,
        );
        const searchBeyondIdx =
            lastMissingIdx >= 0 ? lastMissingIdx + 1 : endIdx;

        let hasMoreBeyond = false;
        for (let i = searchBeyondIdx; i < this.store.cues.length; i++) {
            if (!this.store.isCueTranslated(this.store.cues[i].id)) {
                hasMoreBeyond = true;
                break;
            }
        }

        let remainingUntranslated = 0;
        for (let i = startGapIdx; i < this.store.cues.length; i++) {
            if (!this.store.isCueTranslated(this.store.cues[i].id)) {
                remainingUntranslated++;
                if (remainingUntranslated >= minCues) break;
            }
        }

        return (
            asrFinished &&
            (!hasMoreBeyond ||
                endIdx >= this.store.cues.length ||
                (lastMissingIdx >= 0 &&
                    lastMissingIdx >= this.store.cues.length - 1) ||
                remainingUntranslated < minCues)
        );
    }

    async fetchNextTranslationBatch(
        currentIdx: number,
        config: PipelineConfig,
    ): Promise<void> {
        if (this.isTranslating) return;
        this.isTranslating = true;

        try {
            const maxCues = Math.max(1, config?.maxTranslateCues || 30);
            const minCues = Math.max(1, config?.minTranslateCues || 1);
            const startGapIdx = this.findTranslationStartGap(currentIdx);
            if (startGapIdx === -1 || startGapIdx >= this.store.cues.length)
                return;

            const endIdx = Math.min(
                this.store.cues.length,
                startGapIdx + maxCues,
            );
            const missing = this.store.cues
                .slice(startGapIdx, endIdx)
                .filter((c) => c && !this.store.isCueTranslated(c.id));
            if (missing.length === 0) return;

            const effectiveTime = this.delegate.getEffectiveTime();
            const isUrgent = missing[0].startTime - effectiveTime <= 5;
            const isEndOfRaw = this.isEndOfTrack(
                startGapIdx,
                missing,
                minCues,
                endIdx,
            );

            if (missing.length >= minCues || isUrgent || isEndOfRaw) {
                const payload = missing.slice(0, maxCues);
                this.logger.info(
                    'SubtitlePipelineCoordinator',
                    `Dynamic Prefetch: translating ${payload.length} cues [${startGapIdx}..${startGapIdx + payload.length - 1}]...`,
                );
                payload.forEach((c) =>
                    this.store.setCueStatus(c.id, 'translating'),
                );
                const firstMissingIdx = this.store.cues.findIndex(
                    (c) => c && c.id === payload[0].id,
                );
                const contextItems = this.getPrecedingContextItems(
                    firstMissingIdx >= 0 ? firstMissingIdx : startGapIdx,
                    3,
                );
                await this.dispatchTranslationSubBatch(payload, contextItems);
            }
        } catch (err) {
            this.logger.error(
                'SubtitlePipelineCoordinator',
                'Error in fetchNextTranslationBatch:',
                err,
            );
        } finally {
            this.isTranslating = false;
        }
    }

    dispatchTranslationSubBatch(
        batch: SubtitleCue[],
        contextItems: PrecedingContextItem[] = [],
        isUrgent = false,
    ): Promise<void> {
        const epoch = this.store.sessionEpoch;
        return new Promise<void>((resolve) => {
            if (!this.delegate.isContextValid()) {
                this.delegate.detachVideo();
                return resolve();
            }

            this.messageService
                .translateBatch({
                    items: batch,
                    contextItems,
                    trackHash: this.store.currentTrackHash,
                    movieId: this.delegate.getCurrentMovieId() || undefined,
                    showId: this.delegate.getCurrentShowId() || undefined,
                    urgent: Boolean(isUrgent),
                })
                .then((response) => {
                    if (epoch !== this.store.sessionEpoch) return resolve();
                    if (!response?.success || !response.results) {
                        this.resetBatchToUntranslated(batch);
                        return resolve();
                    }
                    this.applyTranslationResults(
                        batch,
                        response.results,
                        response.merged,
                    );
                    resolve();
                })
                .catch((e) => {
                    this.logger.error('SubtitlePipelineCoordinator', e);
                    this.resetBatchToUntranslated(batch);
                    resolve();
                });
        });
    }

    private resetBatchToUntranslated(batch: SubtitleCue[]): void {
        batch.forEach((c) => {
            if (this.store.getCueStatus(c.id) === 'translating') {
                this.store.setCueStatus(c.id, 'untranslated');
            }
        });
    }

    private applyTranslationResults(
        batch: SubtitleCue[],
        results: Record<number, string>,
        merged?: Record<number, number[]>,
    ): void {
        const resEntries = Object.entries(results);
        this.logger.info(
            'SubtitlePipelineCoordinator',
            `Received translation for ${resEntries.length} cues.`,
        );

        const batchCueMap = new Map(batch.map((c) => [c.id, c]));
        for (const [idStr, translatedText] of resEntries) {
            const id = parseInt(idStr, 10);
            const cueMerged = merged?.[id];
            const cueObj = batchCueMap.get(id);
            if (cueObj && cueMerged) {
                cueObj.merged = cueMerged;
            }
            if (!this.store.translationMap.has(id)) {
                this.store.setTranslation(
                    id,
                    String(translatedText),
                    'raw',
                    undefined,
                    cueMerged,
                );
            } else {
                this.store.setCueStatus(id, 'raw');
            }
        }
        this.resetBatchToUntranslated(batch);

        const nowCues = this.delegate.findActiveCues(
            this.delegate.getEffectiveTime(),
        );
        const hasActiveNewlyTranslated = nowCues.some((c) => {
            const newTrans = results[c.id];
            return typeof newTrans === 'string' && newTrans.trim().length > 0;
        });

        if (hasActiveNewlyTranslated) {
            this.invalidateCueCacheAndTick();
        }
    }

    private collectCuesToReview(batchSize: number): ReviewQueueItem[] {
        const toReview: ReviewQueueItem[] = [];
        const requiredMergedIds = new Set<number>();

        for (
            let i = this.store.canonicalReviewIndex;
            i < this.store.cues.length;
            i++
        ) {
            const cue = this.store.cues[i];
            if (
                toReview.length >= batchSize &&
                !requiredMergedIds.has(cue.id)
            ) {
                break;
            }

            const state = this.store.getCueStatus(cue.id);
            const entry = this.store.translationMap.get(cue.id);
            const cueMerged = cue.merged ?? entry?.merged;

            if (state === 'reviewed') {
                this.store.canonicalReviewIndex = i + 1;
                continue;
            }
            if (state === 'raw' || state === 'pre_reviewed') {
                if (
                    entry &&
                    (entry.text || (cueMerged && cueMerged.length > 1))
                ) {
                    toReview.push({
                        id: cue.id,
                        orig: cue.rawText,
                        trans: entry.text,
                        cueIndex: i,
                        start: cue.startTime,
                        end: cue.endTime,
                        merged: cueMerged,
                    });
                    if (cueMerged) {
                        for (const mid of cueMerged) {
                            if (mid > cue.id) {
                                requiredMergedIds.add(mid);
                            }
                        }
                    }
                } else {
                    break;
                }
            } else if (
                state === 'untranslated' ||
                state === 'stale' ||
                state === 'translating'
            ) {
                break;
            }
        }
        return toReview;
    }

    processSupervisorReviewQueue(pipelineConfig?: PipelineConfig): void {
        if (
            this.isReviewing ||
            !this.getSettings().enabled ||
            this.getSettings().enableSupervisor === false
        )
            return;
        if (!this.delegate.isContextValid()) {
            this.delegate.detachVideo();
            return;
        }

        const config =
            pipelineConfig ||
            NCW_CONSTANTS.getPipelineConfig(this.getSettings());
        const epoch = this.store.sessionEpoch;
        const toReview = this.collectCuesToReview(
            Math.max(1, config.reviewBatchSize || 8),
        );
        if (toReview.length === 0) return;

        this.isReviewing = true;
        toReview.forEach((r) => this.store.setCueStatus(r.id, 'reviewing'));
        const firstReviewIdx =
            toReview[0]?.cueIndex ?? this.store.canonicalReviewIndex;
        const contextItems = this.getPrecedingContextItems(firstReviewIdx, 3);

        this.dispatchSupervisorReview(toReview, contextItems, epoch, config);
    }

    private dispatchSupervisorReview(
        toReview: ReviewQueueItem[],
        contextItems: PrecedingContextItem[],
        epoch: number,
        config: PipelineConfig,
    ): void {
        this.messageService
            .reviewBatch({
                items: toReview.map((r) =>
                    createSubtitleCue({
                        id: r.id,
                        rawText: r.orig,
                        transText: r.trans,
                        startTime: r.start,
                        endTime: r.end,
                        status: 'reviewing',
                        merged: r.merged,
                    }),
                ),
                contextItems,
                trackHash: this.store.currentTrackHash,
                showId: this.delegate.getCurrentShowId() || undefined,
                movieId: this.delegate.getCurrentMovieId() || undefined,
                status: 'reviewed',
            })
            .then((res) => {
                this.isReviewing = false;
                if (epoch !== this.store.sessionEpoch) return;
                if (res?.success) {
                    this.applySupervisorCorrections(
                        toReview,
                        res.corrections || {},
                        res.usedTermsMap || {},
                    );
                    if (res.updatedContext)
                        this.delegate.onContextUpdated(
                            Context.fromDTO(res.updatedContext),
                        );
                    this.processSupervisorReviewQueue(config);
                } else {
                    this.resetReviewingQueue(toReview);
                }
            })
            .catch(() => {
                this.isReviewing = false;
                this.resetReviewingQueue(toReview);
            });
    }

    private resetReviewingQueue(toReview: ReviewQueueItem[]): void {
        toReview.forEach((r) => {
            if (this.store.getCueStatus(r.id) === 'reviewing') {
                const entry = this.store.translationMap.get(r.id);
                this.store.setCueStatus(r.id, entry?.status || 'raw');
            }
        });
    }

    private applySupervisorCorrections(
        toReview: ReviewQueueItem[],
        corrections: Record<number, string>,
        usedTermsMap: Record<number, Record<string, number>>,
    ): void {
        toReview.forEach((r) => {
            const correctedText = corrections[r.id];
            const finalText =
                correctedText && correctedText.trim().length > 0
                    ? correctedText.trim()
                    : r.trans;
            const usedTerms =
                usedTermsMap[r.id] ||
                this.store.translationMap.get(r.id)?.usedTerms;
            this.store.setTranslation(r.id, finalText, 'reviewed', usedTerms);
            this.store.canonicalReviewIndex = Math.max(
                this.store.canonicalReviewIndex,
                r.cueIndex + 1,
            );
        });

        const activeCues = this.delegate.findActiveCues(
            this.delegate.getEffectiveTime(),
        );
        const hasRealChange = activeCues.some((c) => {
            const corr = corrections[c.id];
            const existing = this.store.translationMap.get(c.id)?.text;
            return corr && corr.trim() !== (existing || '').trim();
        });

        if (hasRealChange) {
            this.invalidateCueCacheAndTick();
        }
    }

    async requestSubtitleCache(
        trackHash: string,
        cues: SubtitleCue[],
    ): Promise<boolean> {
        if (!this.delegate.isContextValid() || !trackHash) return false;
        const epoch = this.store.sessionEpoch;

        try {
            const targetLangCode =
                this.getSettings().targetLanguage?.code || 'en';
            const res = await this.messageService.getSubtitleCache({
                trackHash,
                movieId: this.delegate.getCurrentMovieId() || undefined,
                targetLanguage: targetLangCode,
            });

            if (!this.delegate.isContextValid()) return false;
            if (
                this.store.sessionEpoch !== epoch ||
                this.store.currentTrackHash !== trackHash
            )
                return false;

            if (res?.hit && res.cachedCues) {
                return this.populateCachedCues(res.cachedCues, cues);
            }
            return false;
        } catch (e) {
            this.logger.warn(
                'SubtitlePipelineCoordinator',
                'Request cache error:',
                e,
            );
            return false;
        }
    }

    private populateCachedCues(
        cached: SubtitleCueCacheMap,
        cues: SubtitleCue[],
    ): boolean {
        let hitCount = 0;
        const liveContext = this.delegate.getCurrentContext();

        for (const [idStr, entry] of Object.entries(cached)) {
            const id = parseInt(idStr, 10);
            if (isNaN(id) || !entry?.transText) continue;

            const entryStatus: TranslationStatus =
                (entry.status as TranslationStatus) || 'raw';
            if (entryStatus === 'stale') continue;
            if (
                entry.usedTerms &&
                liveContext.checkTermStaleness(entry.usedTerms)
            ) {
                this.store.setCueStatus(id, 'stale');
                continue;
            }

            const existing = this.store.translationMap.get(id);
            if (
                !existing ||
                (existing.status !== 'reviewed' && entryStatus === 'reviewed')
            ) {
                this.store.setTranslation(
                    id,
                    entry.transText,
                    entryStatus,
                    entry.usedTerms,
                );
                hitCount++;
            }
        }

        const activeCues = this.delegate.findActiveCues(
            this.delegate.getEffectiveTime(),
        );
        if (activeCues.some((c) => this.store.translationMap.has(c.id))) {
            this.invalidateCueCacheAndTick();
        }
        return hitCount >= cues.length * 0.7;
    }

    async tryLoadNativeBilingualSubtitles(
        cues: SubtitleCue[],
        epoch: number,
        trackHash?: string,
    ): Promise<'found' | 'not_found' | 'not_ready'> {
        if (
            this.getSettings().preferNativeSubtitles === false ||
            !this.adapter?.fetchNativeTargetTrack
        ) {
            return 'not_found';
        }
        const targetLang: LanguageInfo = Language.resolve(
            this.getSettings().targetLanguage,
        );

        try {
            const nativeCues = await this.adapter.fetchNativeTargetTrack(
                targetLang,
                this.delegate.getCurrentMovieId() || undefined,
            );
            if (this.store.sessionEpoch !== epoch || this.store.cues !== cues)
                return 'not_found';

            if (nativeCues === undefined) {
                return 'not_ready';
            }
            if (nativeCues === null || nativeCues.length === 0) {
                return 'not_found';
            }

            if (this.isIdenticalNativeTrack(cues, nativeCues, targetLang)) {
                return 'found';
            }

            const alignResult = SubtitleAlignmentService.align(
                cues,
                nativeCues,
            );
            if (alignResult.matchCoverage >= 0.7) {
                this.applyAlignedNativeSubtitles(
                    cues,
                    alignResult,
                    targetLang,
                    trackHash,
                );
                return 'found';
            }
            return 'not_found';
        } catch (err) {
            this.logger.warn(
                'SubtitlePipelineCoordinator',
                'Error during native subtitle loading:',
                err,
            );
            return 'not_found';
        }
    }

    startNativePollingInterval(
        cues: SubtitleCue[],
        epoch: number,
        trackHash?: string,
    ): void {
        this.stopNativePollingInterval();
        let attempts = 0;
        const maxAttempts = 12;

        this.nativePollingTimer = setInterval(async () => {
            attempts++;
            if (
                this.store.sessionEpoch !== epoch ||
                this.store.cues !== cues ||
                attempts >= maxAttempts
            ) {
                this.stopNativePollingInterval();
                return;
            }

            const res = await this.tryLoadNativeBilingualSubtitles(
                cues,
                epoch,
                trackHash,
            );
            if (this.store.sessionEpoch !== epoch || this.store.cues !== cues) {
                this.stopNativePollingInterval();
                return;
            }

            if (res === 'found') {
                this.stopNativePollingInterval();
                if (this.delegate.isContextValid()) {
                    this.messageService.clearQueues().catch(() => {});
                }
                this.isTranslating = false;
                this.isReviewing = false;
                this.logger.info(
                    'SubtitlePipelineCoordinator',
                    'Native track acquired via polling! Preempted LLM.',
                );
            } else if (res === 'not_found') {
                this.stopNativePollingInterval();
            }
        }, 1000);
    }

    stopNativePollingInterval(): void {
        if (this.nativePollingTimer) {
            clearInterval(this.nativePollingTimer);
            this.nativePollingTimer = null;
        }
    }

    private isIdenticalNativeTrack(
        cues: SubtitleCue[],
        nativeCues: { text?: string }[],
        targetLang: LanguageInfo,
    ): boolean {
        if (cues.length === 0 || nativeCues.length === 0) return false;
        const checkCount = Math.min(cues.length, nativeCues.length, 10);
        let identicalCount = 0;
        for (let i = 0; i < checkCount; i++) {
            if (
                (cues[i].rawText || '').trim() ===
                (nativeCues[i].text || '').trim()
            ) {
                identicalCount++;
            }
        }
        if (identicalCount >= checkCount * 0.7) {
            return this.isLanguageMatchingTarget(
                this.delegate.getCurrentRawLanguage(),
                targetLang.code,
            );
        }
        return false;
    }

    private applyAlignedNativeSubtitles(
        cues: SubtitleCue[],
        alignResult: AlignmentResult,
        targetLang: LanguageInfo,
        trackHash?: string,
    ): void {
        const resultsMap: Record<number, string> = {};
        const pairs: Array<{ originalText: string; translatedText: string }> =
            [];

        alignResult.alignedMap.forEach((matchedText: string, cueId: number) => {
            this.store.setTranslation(cueId, matchedText, 'reviewed');
            resultsMap[cueId] = matchedText;
            const srcCue = cues.find((c) => c.id === cueId);
            if (srcCue)
                pairs.push({
                    originalText: srcCue.rawText,
                    translatedText: matchedText,
                });
        });

        this.invalidateCueCacheAndTick();
        this.persistNativeSubtitles(resultsMap, targetLang, trackHash, pairs);
    }

    private persistNativeSubtitles(
        resultsMap: Record<number, string>,
        targetLang: LanguageInfo,
        trackHash: string | undefined,
        pairs: Array<{ originalText: string; translatedText: string }>,
    ): void {
        const effectiveHash = trackHash || this.store.currentTrackHash;
        const currentContext = this.delegate.getCurrentContext();
        if (effectiveHash) {
            const showTitle = currentContext?.mainTitle || currentContext?.title || '';
            this.messageService
                .saveSubtitleCache({
                    trackHash: effectiveHash,
                    movieId: this.delegate.getCurrentMovieId() || '',
                    showTitle,
                    targetLanguage: targetLang.code || 'en',
                    provider: 'netflix_native',
                    translationModel: 'official',
                    supervisorModel: 'official',
                    results: resultsMap,
                })
                .catch(() => {});
        }

        if (
            this.getSettings().extractTermsFromNativeSubtitles &&
            pairs.length > 0
        ) {
            const showId =
                this.delegate.getCurrentShowId() ||
                currentContext?.showId ||
                this.delegate.getCurrentMovieId() ||
                '';
            this.messageService
                .extractTermsFromNativeBilingualCues({
                    showId,
                    targetLanguage: targetLang,
                    pairs,
                })
                .catch((e) =>
                    this.logger.warn('SubtitlePipelineCoordinator', e),
                );
        }
    }

    async loadSubtitlesForCurrentTrack(
        cues: SubtitleCue[],
        epoch: number,
        trackHash?: string,
    ): Promise<void> {
        if (!cues || cues.length === 0) return;
        try {
            const hash = trackHash || (await computeTrackHash(cues));
            if (this.store.sessionEpoch !== epoch || this.store.cues !== cues)
                return;

            this.store.currentTrackHash = hash;
            this.logger.info(
                'SubtitlePipelineCoordinator',
                `Subtitle Track Hash: ${hash}`,
            );

            const cacheHit = await this.requestSubtitleCache(hash, cues);
            if (this.store.sessionEpoch !== epoch || this.store.cues !== cues)
                return;

            if (
                !cacheHit &&
                this.getSettings().preferNativeSubtitles !== false
            ) {
                const nativeResult = await this.tryLoadNativeBilingualSubtitles(
                    cues,
                    epoch,
                    hash,
                );
                if (nativeResult === 'found') {
                    this.stopNativePollingInterval();
                    return;
                }
                if (nativeResult === 'not_ready') {
                    this.startNativePollingInterval(cues, epoch, hash);
                } else {
                    this.stopNativePollingInterval();
                }
            }

            if (this.store.sessionEpoch !== epoch || this.store.cues !== cues)
                return;
            if (this.getSettings().enabled !== false) {
                this.delegate.onTick();
                this.checkPipeline(this.delegate.getEffectiveTime());
            }
        } catch (e) {
            this.logger.warn(
                'SubtitlePipelineCoordinator',
                'Track subtitle load error:',
                e,
            );
            if (
                this.getSettings().enabled !== false &&
                this.store.sessionEpoch === epoch
            ) {
                this.delegate.onTick();
                this.checkPipeline(this.delegate.getEffectiveTime());
            }
        }
    }
}
