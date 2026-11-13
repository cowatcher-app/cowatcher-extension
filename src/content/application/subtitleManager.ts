import { SubtitleOverlay } from '../presentation/SubtitleOverlay';
import { IAdDetector } from '../domain/adapters/IAdDetector';
import { ExtensionSettings } from '@shared/utils/constants';
import {
    IStreamingAdapter,
    VideoMetadata,
} from '../domain/adapters/IStreamingAdapter';
import { ContentMessageService } from './services/ContentMessageService';
import { BrowserPlatformFactory } from '@shared/infrastructure/platform/BrowserPlatformFactory';
import { IBrowserPlatform } from '@shared/infrastructure/platform/IBrowserPlatform';
import { Context } from '@shared/domain/entities/Context';
import { Language } from '@shared/domain/value-objects/Language';
import { SubtitleCue } from '@shared/domain/entities/Subtitle';
import { Logger } from '@shared/utils/logger';
import { SubtitleLearningManager } from './learning/SubtitleLearningManager';
import { WatchHistoryTracker } from './history/WatchHistoryTracker';
import { ViewingFrictionManager } from './friction/ViewingFrictionManager';

import { SubtitleStore } from './store/SubtitleStore';
import { AsrStreamMerger } from './pipeline/AsrStreamMerger';
import { SubtitlePlaybackSyncer } from './playback/SubtitlePlaybackSyncer';
import { EpisodeContextManager } from './context/EpisodeContextManager';
import { SubtitlePipelineCoordinator } from './pipeline/SubtitlePipelineCoordinator';

export type CueItem = SubtitleCue;

interface CuesStalePayload {
    readonly movieId?: string;
    readonly movieIds?: string[];
    readonly trackHash?: string;
    readonly showTitle?: string;
    readonly showId?: string;
    readonly invalidatedCount?: number;
}

export class SubtitleManager {
    readonly overlay: SubtitleOverlay;
    readonly adDetector: IAdDetector;
    readonly adapter?: IStreamingAdapter;
    settings: Partial<ExtensionSettings>;
    readonly platform: IBrowserPlatform;
    readonly learningManager?: SubtitleLearningManager;
    readonly historyTracker?: WatchHistoryTracker;
    readonly frictionManager?: ViewingFrictionManager;

    readonly store: SubtitleStore;
    readonly asrMerger: AsrStreamMerger;
    readonly syncer: SubtitlePlaybackSyncer;
    readonly contextManager: EpisodeContextManager;
    readonly pipeline: SubtitlePipelineCoordinator;

    currentRawLanguage = '';
    private isLiveStream = false;
    private warmupTimer: ReturnType<typeof setTimeout> | null = null;
    private unsubscribeGlossary?: () => void;
    private unsubscribeCuesStale?: () => void;

    private readonly messageService: ContentMessageService;
    private readonly logger = new Logger('SubtitleManager');

    constructor(
        overlay: SubtitleOverlay,
        adDetector: IAdDetector,
        settings: Partial<ExtensionSettings> = {},
        adapter?: IStreamingAdapter,
    ) {
        this.overlay = overlay;
        this.adDetector = adDetector;
        this.settings = settings;
        this.adapter = adapter;
        this.messageService = ContentMessageService.getInstance();
        this.platform = BrowserPlatformFactory.getPlatform();

        if (this.adapter) {
            this.overlay.bindContainerResolver(
                () => this.adapter?.getPlayerContainer?.() || null,
            );
            this.learningManager = new SubtitleLearningManager(
                this.adapter,
                this.messageService,
                this.settings as ExtensionSettings,
            );
            this.overlay.setLearningManager(this.learningManager);
            this.historyTracker = new WatchHistoryTracker(
                this.adapter,
                this.messageService,
                () => Boolean(this.adDetector?.isAdPlaying),
            );
            this.frictionManager = new ViewingFrictionManager(
                this.adapter,
                this.messageService,
                this.settings as ExtensionSettings,
                {
                    isAdPlaying: () => Boolean(this.adDetector?.isAdPlaying),
                    getShowTitle: () =>
                        this.contextManager?.currentContext?.title ||
                        this.contextManager?.videoInfo?.fullTitle ||
                        this.contextManager?.videoInfo?.mainTitle,
                },
            );
        }

        this.store = new SubtitleStore();
        this.asrMerger = this.createAsrMerger();
        this.syncer = this.createPlaybackSyncer();
        this.contextManager = this.createContextManager();
        this.pipeline = this.createPipelineCoordinator();

        this.subscribeMessageService();
    }

    get video(): HTMLVideoElement | null {
        return this.syncer.video;
    }

    get cues(): SubtitleCue[] {
        return this.store.cues;
    }

    get currentMovieId(): string | null {
        return this.contextManager.currentMovieId;
    }

    get currentShowId(): string | null {
        return this.contextManager.currentShowId;
    }

    get currentTrackHash(): string {
        return this.store.currentTrackHash;
    }

    get videoInfo(): VideoMetadata | null {
        return this.contextManager.videoInfo;
    }

    private createAsrMerger(): AsrStreamMerger {
        return new AsrStreamMerger(
            this.messageService,
            {
                isContextValid: () => this.isContextValid(),
                addMergedCues: (c) => this.addMergedAsrCues(c),
                onMergedCuesAdded: (epoch) => this.onMergedAsrCuesAdded(epoch),
            },
            () => this.settings,
        );
    }

    private createPlaybackSyncer(): SubtitlePlaybackSyncer {
        return new SubtitlePlaybackSyncer(
            this.overlay,
            {
                isContextValid: () => this.isContextValid(),
                isAdPlaying: () => Boolean(this.adDetector?.isAdPlaying),
                getCues: () => this.store.cues,
                getRawAsrCues: () => this.asrMerger.rawAsrCues,
                isAsrTrack: () => this.asrMerger.isAsrTrack,
                getTranslation: (id) => this.store.translationMap.get(id),
                checkCueStaleness: (id) =>
                    this.store.checkCueStaleness(
                        id,
                        this.contextManager.currentContext,
                    ),
                onPipelineTick: (t) => this.checkPipeline(t),
                onSeeked: (t) => this.handleSeeked(t),
                getCurrentMovieId: () => this.contextManager.currentMovieId,
                isLive: () =>
                    Boolean(
                        this.contextManager.videoInfo?.isLive ||
                        this.isLiveStream,
                    ),
                onVideoAttached: (v) => {
                    this.historyTracker?.attachVideo(v);
                    this.frictionManager?.attachVideo(v);
                },
                onVideoDetached: () => {
                    this.historyTracker?.detachVideo();
                    this.frictionManager?.detachVideo();
                },
            },
            () => this.settings,
        );
    }

    private createContextManager(): EpisodeContextManager {
        return new EpisodeContextManager(
            this.messageService,
            {
                isContextValid: () => this.isContextValid(),
                getCues: () => this.store.cues,
                getCurrentRawLanguage: () => this.currentRawLanguage,
                onGlossaryUpdated: () => this.checkStaleCues(),
                onEpisodeReset: () => {
                    this.store.clearCues();
                },
                onEpisodeRetained: () => {},
            },
            () => this.settings,
            this.adapter,
            this.learningManager,
            this.historyTracker,
        );
    }

    private createPipelineCoordinator(): SubtitlePipelineCoordinator {
        return new SubtitlePipelineCoordinator(
            this.messageService,
            this.store,
            {
                isContextValid: () => this.isContextValid(),
                isAdPlaying: () => Boolean(this.adDetector?.isAdPlaying),
                isVideoPaused: () => Boolean(this.syncer.video?.paused),
                detachVideo: () => this.detachVideo(),
                getEffectiveTime: () => this.getEffectiveTime(),
                findCueIndexAtTime: (t) => this.syncer.findCueIndexAtTime(t),
                findActiveCues: (t) => this.syncer.findActiveCues(t),
                onTick: () => this.onTick(),
                invalidateCueSig: () => this.syncer.invalidateCueSig(),
                checkAsrMerge: (t) => this.checkAsrMergePipeline(t),
                getCurrentMovieId: () => this.contextManager.currentMovieId,
                getCurrentShowId: () => this.contextManager.currentShowId,
                getCurrentContext: () => this.contextManager.currentContext,
                onContextUpdated: (ctx) => {
                    this.contextManager.currentContext = ctx;
                    this.checkStaleCues();
                },
                getCurrentRawLanguage: () => this.currentRawLanguage,
                isAsrTrack: () => this.asrMerger.isAsrTrack,
                getRawAsrCuesCount: () => this.asrMerger.rawAsrCues.length,
                getAsrMergeIndex: () => this.asrMerger.asrMergeIndex,
            },
            () => this.settings,
            this.adapter,
        );
    }

    private subscribeMessageService(): void {
        this.unsubscribeGlossary = this.messageService.onGlossaryChanged((context) => {
            if (!context) return;
            this.contextManager.currentContext = Context.fromDTO(context);
            this.checkStaleCues();
            if (!context.isWarmedUp) {
                this.contextManager.hasWarmedUpForEpisode = false;
                if (this.contextManager.latestMetadata || this.adapter) {
                    this.contextManager.warmupShowContext(true);
                }
            }
        });

        this.unsubscribeCuesStale = this.messageService.onCuesStale((payload) =>
            this.handleCuesStale(payload),
        );
    }

    private handleCuesStale(payload?: CuesStalePayload): void {
        if (!payload) return;
        const currentMid = this.contextManager.currentMovieId;
        const matchesMid = Boolean(
            payload.movieId && currentMid && String(payload.movieId) === String(currentMid),
        );
        const matchesMidList = Boolean(
            currentMid &&
            Array.isArray(payload.movieIds) &&
            payload.movieIds.some((id) => String(id) === String(currentMid)),
        );
        const matchesTrack = Boolean(
            payload.trackHash &&
            this.store.currentTrackHash &&
            payload.trackHash === this.store.currentTrackHash,
        );
        const matchesShowId = Boolean(
            payload.showId &&
            ((this.contextManager.currentShowId &&
                String(payload.showId) === String(this.contextManager.currentShowId)) ||
                (this.contextManager.currentContext?.showId &&
                    String(payload.showId) === String(this.contextManager.currentContext.showId))),
        );

        if (matchesMid || matchesMidList || matchesTrack || matchesShowId) {
            this.logger.info(
                'SubtitleManager',
                `Cues invalidated (${payload.invalidatedCount || 0}). Resetting translations.`,
            );
            this.store.clearTranslations();
            this.syncer.invalidateCueSig();
            this.onTick();
            if (this.syncer.video) {
                this.pipeline.checkPipeline(this.getEffectiveTime());
            }
        }
    }

    isContextValid(): boolean {
        return this.platform.isContextValid();
    }

    isSameSubtitle(
        newCues: CueItem[],
        isAsr = false,
        movieId?: string | number | null,
    ): boolean {
        // Entity consistency check: if movieId is provided and does not match current, it cannot be identical
        if (
            movieId &&
            this.contextManager.currentMovieId &&
            String(movieId) !== String(this.contextManager.currentMovieId)
        ) {
            return false;
        }

        const targetCues =
            isAsr &&
            this.asrMerger.isAsrTrack &&
            this.asrMerger.rawAsrCues.length > 0
                ? this.asrMerger.rawAsrCues
                : this.store.cues;
        if (
            !targetCues ||
            targetCues.length === 0 ||
            !newCues ||
            newCues.length === 0
        )
            return false;
        if (targetCues.length !== newCues.length) return false;

        const mid = Math.floor(newCues.length / 2);
        const last = newCues.length - 1;
        return (
            targetCues[0]?.rawText === newCues[0]?.rawText &&
            targetCues[0]?.startTime === newCues[0]?.startTime &&
            targetCues[mid]?.rawText === newCues[mid]?.rawText &&
            targetCues[last]?.rawText === newCues[last]?.rawText
        );
    }

    checkStaleCues(): void {
        const hasInvalidated = this.store.checkStaleCues(
            this.getEffectiveTime(),
            this.contextManager.currentContext,
            (t) => this.syncer.findCueIndexAtTime(t),
        );
        if (hasInvalidated) {
            this.syncer.invalidateCueSig();
            this.onTick();
            if (this.syncer.video) {
                this.checkPipeline(this.getEffectiveTime());
            }
        }
    }

    loadCues(
        cues: CueItem[],
        movieId: string | number | null = null,
        isAsr = false,
        language?: string,
    ): void {
        if (!cues || cues.length === 0) return;
        if (language) {
            this.currentRawLanguage = language;
            this.learningManager?.setSourceLanguage(language);
        }

        const incomingMovieId = movieId ? String(movieId) : null;
        const currentMovieId = this.contextManager.currentMovieId;

        // If a new valid movieId arrives that differs from current, trigger episode change first
        if (
            incomingMovieId &&
            currentMovieId &&
            incomingMovieId !== currentMovieId
        ) {
            this.onEpisodeChange(incomingMovieId);
        } else if (incomingMovieId && !currentMovieId) {
            this.contextManager.currentMovieId = incomingMovieId;
            this.learningManager?.onShowContext(
                incomingMovieId,
                this.contextManager.latestMetadata?.fullTitle ||
                    this.contextManager.latestMetadata?.mainTitle ||
                    this.contextManager.currentContext?.mainTitle,
                this.currentRawLanguage,
                Language.resolve(this.settings.targetLanguage).code,
            );
        }

        // Entity-guarded subtitle comparison
        if (this.isSameSubtitle(cues, isAsr, incomingMovieId)) return;

        if (this.isContextValid()) {
            this.messageService.clearQueues().catch(() => {});
        }

        if (this.warmupTimer) {
            clearTimeout(this.warmupTimer);
            this.warmupTimer = null;
        }

        const epoch = Date.now();
        this.syncer.hasLoggedEndOfCues = false;

        const shouldMergeAsr =
            isAsr && this.settings.enableAutomaticAsrMerging !== false;
        if (shouldMergeAsr) {
            this.asrMerger.loadRawAsrCues(cues);
            this.store.loadCues([], epoch);
        } else {
            this.asrMerger.reset();
            this.store.loadCues(cues, epoch);
            this.pipeline.loadSubtitlesForCurrentTrack(cues, epoch);
        }
        this.postLoadCues(epoch, shouldMergeAsr);
    }

    updateCues(
        cues: CueItem[],
        movieId: string | number | null = null,
        language?: string,
        isLive?: boolean,
    ): void {
        if (!cues || cues.length === 0) return;
        if (language && !this.currentRawLanguage) {
            this.currentRawLanguage = language;
            this.learningManager?.setSourceLanguage(language);
        }

        if (isLive !== undefined) {
            this.isLiveStream = Boolean(isLive);
            this.syncer.setIsLive(this.isLiveStream);
        } else if (this.contextManager.latestMetadata?.isLive !== undefined) {
            this.isLiveStream = Boolean(this.contextManager.latestMetadata.isLive);
            this.syncer.setIsLive(this.isLiveStream);
        }

        const incomingMovieId = movieId ? String(movieId) : null;
        if (incomingMovieId && !this.contextManager.currentMovieId) {
            this.contextManager.currentMovieId = incomingMovieId;
        }

        // If store has no cues yet, fall back to initial loadCues
        if (this.store.cues.length === 0) {
            this.loadCues(cues, movieId, false, language);
            return;
        }

        const added = this.store.updateCues(cues);
        if (added.length === 0) return;

        this.logger.info(
            'SubtitleManager',
            `Appended ${added.length} incremental cues (total: ${this.store.cues.length}, isLive: ${this.isLiveStream})`,
        );

        this.syncer.hasLoggedEndOfCues = false;
        this.onTick();
        const effectiveTime = this.getEffectiveTime();
        this.pipeline.checkPipeline(effectiveTime);
    }

    private postLoadCues(epoch: number, shouldMergeAsr: boolean): void {
        if (this.settings.enabled === false) {
            this.overlay.hide(true);
            return;
        }
        if (
            typeof document !== 'undefined' &&
            (!this.syncer.video ||
                (document.body && !document.body.contains(this.syncer.video)))
        ) {
            const v = document.querySelector('video');
            if (v) this.attachVideo(v);
        }
        this.overlay.mountToPlayer(this.adapter?.getPlayerContainer?.());
        if (this.syncer.video) {
            this.onTick();
            const effectiveTime = this.getEffectiveTime();
            if (shouldMergeAsr) {
                this.checkAsrMergePipeline(effectiveTime);
            } else if (this.settings.preferNativeSubtitles === false) {
                this.pipeline.checkPipeline(effectiveTime);
            }
            if (!this.syncer.video.paused) {
                this.syncer.startRafLoop();
            }
        }
        if (this.warmupTimer) {
            clearTimeout(this.warmupTimer);
        }
        this.warmupTimer = setTimeout(() => {
            this.warmupTimer = null;
            if (this.isContextValid() && this.store.sessionEpoch === epoch) {
                this.contextManager.warmupShowContext();
            }
        }, 2500);
    }

    clearCues(): void {
        if (this.warmupTimer) {
            clearTimeout(this.warmupTimer);
            this.warmupTimer = null;
        }
        this.pipeline.stopNativePollingInterval();
        if (this.isContextValid()) {
            this.messageService.clearQueues().catch(() => {});
        }
        this.store.clearCues();
        this.asrMerger.reset();
        this.pipeline.isTranslating = false;
        this.pipeline.isReviewing = false;
        this.pipeline.isPreReviewing = false;
        this.syncer.stopRafLoop();
        this.syncer.reset();
        this.currentRawLanguage = '';
        this.logger.info(
            'SubtitleManager',
            'Cleared subtitle cues and reset syncer.',
        );
    }

    onEpisodeChange(newMovieId: string | number | null): void {
        const newIdStr = newMovieId ? String(newMovieId) : null;
        if (this.warmupTimer) {
            clearTimeout(this.warmupTimer);
            this.warmupTimer = null;
        }
        if (this.historyTracker) {
            this.historyTracker.onEpisodeChange(newIdStr);
        }
        this.pipeline.stopNativePollingInterval();
        this.contextManager.onEpisodeChange(newMovieId);
        this.store.clearCues();
        this.asrMerger.reset();
        this.pipeline.isTranslating = false;
        this.pipeline.isReviewing = false;
        this.pipeline.isPreReviewing = false;
        this.syncer.stopRafLoop();
        this.syncer.reset();
        this.adDetector?.reset?.();
        if (!newIdStr) {
            this.currentRawLanguage = '';
        }

        const isKnown = this.contextManager.isEpisodeOfCurrentShow(newIdStr);
        if (
            this.settings.enabled !== false &&
            this.store.cues.length > 0 &&
            isKnown
        ) {
            this.contextManager.warmupShowContext();
            if (this.syncer.video) {
                this.onTick();
                this.pipeline.checkPipeline(this.getEffectiveTime());
                if (!this.syncer.video.paused) {
                    this.syncer.startRafLoop();
                }
            }
        }
    }

    onMetadataLoaded(meta: VideoMetadata): void {
        this.contextManager.onMetadataLoaded(meta);
        if (meta.isLive !== undefined) {
            this.isLiveStream = Boolean(meta.isLive);
            this.syncer.setIsLive(this.isLiveStream);
        }
        if (this.historyTracker) {
            this.historyTracker.onMetadataLoaded(meta);
        }
    }

    warmupShowContext(force = false, metadataOverride?: VideoMetadata): void {
        this.contextManager.warmupShowContext(force, metadataOverride);
    }

    attachVideo(videoEl: HTMLVideoElement): void {
        this.syncer.attachVideo(videoEl);
    }

    detachVideo(): void {
        this.syncer.detachVideo();
    }

    getContentTime(): number {
        return this.syncer.getContentTime();
    }

    getEffectiveTime(): number {
        return this.syncer.getEffectiveTime();
    }

    setPlaybackOffset(offset: number): void {
        this.syncer.setCadmiumOffset(offset);
    }

    setCadmiumOffset(offset: number): void {
        this.syncer.setCadmiumOffset(offset);
    }

    onSeeked(): void {
        this.syncer.onSeeked();
    }

    repeatCurrentCue(): boolean {
        return this.syncer.repeatCurrentCue();
    }

    seekPreviousCue(): boolean {
        return this.syncer.seekPreviousCue();
    }

    seekNextCue(): boolean {
        return this.syncer.seekNextCue();
    }

    private handleSeeked(effectiveTime: number): void {
        if (this.asrMerger.isAsrTrack) {
            this.checkAsrMergePipeline(effectiveTime);
        }
        this.checkPipeline(effectiveTime);
    }

    onTick(): void {
        this.syncer.onTick();
    }

    private addMergedAsrCues(newCues: SubtitleCue[]): void {
        this.store.addMergedCues(newCues);
    }

    private onMergedAsrCuesAdded(epoch: number): void {
        if (this.store.cues.length > 0 && !this.store.currentTrackHash) {
            this.pipeline.loadSubtitlesForCurrentTrack(this.store.cues, epoch);
        }
        this.onTick();
        const effectiveTime = this.getEffectiveTime();
        this.pipeline.checkPipeline(effectiveTime);
    }

    async checkAsrMergePipeline(currentTime: number): Promise<void> {
        const lastMergedTime =
            this.store.cues.length > 0
                ? this.store.cues[this.store.cues.length - 1].endTime
                : 0;
        await this.asrMerger.checkAsrMergePipeline(
            currentTime,
            lastMergedTime,
            this.store.sessionEpoch,
        );
    }

    checkPipeline(currentTime: number): void {
        this.pipeline.checkPipeline(currentTime);
    }

    updateSettings(newSettings: Partial<ExtensionSettings>): void {
        const wasEnabled = this.settings.enabled !== false;
        const oldTargetLanguage = this.settings.targetLanguage;
        const oldAiProvider = this.settings.aiProvider;
        const oldPreferNative = this.settings.preferNativeSubtitles !== false;

        this.settings = { ...this.settings, ...newSettings };
        this.learningManager?.updateSettings(
            this.settings as ExtensionSettings,
        );
        this.frictionManager?.updateSettings(
            this.settings as ExtensionSettings,
        );
        this.overlay.updateSettings(this.settings);
        this.applySettingsOffsetChanges(newSettings);

        const oldLang = Language.resolve(oldTargetLanguage).code;
        const newLang = newSettings.targetLanguage
            ? Language.resolve(newSettings.targetLanguage).code
            : oldLang;
        const langChanged = Boolean(oldLang && newLang && oldLang !== newLang);
        const providerChanged = Boolean(
            newSettings.aiProvider &&
            oldAiProvider &&
            newSettings.aiProvider !== oldAiProvider,
        );
        const preferChanged = Boolean(
            newSettings.preferNativeSubtitles !== undefined &&
            (newSettings.preferNativeSubtitles !== false) !== oldPreferNative,
        );

        if (this.settings.enabled === false) {
            this.handleSettingsDisabled();
        } else {
            const becameEnabled = !wasEnabled;
            if (becameEnabled) {
                this.handleSettingsEnabled();
            }
            if (providerChanged || langChanged || preferChanged) {
                this.handleTranslationSettingsChanged();
            }
        }
    }

    private applySettingsOffsetChanges(
        newSettings: Partial<ExtensionSettings>,
    ): void {
        if (newSettings.subSyncOffset !== undefined) {
            this.syncer.manualOffset = newSettings.subSyncOffset;
            if (this.syncer.video && this.store.cues.length > 0) this.onTick();
        }
        if (
            newSettings.enableDomSubtitleSync !== undefined &&
            !newSettings.enableDomSubtitleSync
        ) {
            this.syncer.domOffset = 0;
        }
    }

    private handleSettingsDisabled(): void {
        if (this.warmupTimer) {
            clearTimeout(this.warmupTimer);
            this.warmupTimer = null;
        }
        this.pipeline.stopNativePollingInterval();
        this.syncer.stopRafLoop();
        this.overlay.hide(true);
        this.syncer.activeCueId = null;
        this.syncer.invalidateCueSig();
        this.pipeline.isTranslating = false;
        this.pipeline.isReviewing = false;
        this.pipeline.isPreReviewing = false;
    }

    private handleTranslationSettingsChanged(): void {
        this.pipeline.stopNativePollingInterval();
        if (this.isContextValid())
            this.messageService.clearQueues().catch(() => {});
        const epoch = Date.now();
        this.store.sessionEpoch = epoch;
        this.store.clearTranslations();
        this.overlay.hide(true);
        this.syncer.activeCueId = null;
        this.syncer.invalidateCueSig();
        this.pipeline.isTranslating = false;
        this.pipeline.isReviewing = false;
        this.pipeline.isPreReviewing = false;

        if (this.store.cues.length > 0) {
            this.contextManager.warmupShowContext(true);
            this.pipeline.loadSubtitlesForCurrentTrack(
                this.store.cues,
                epoch,
                this.store.currentTrackHash,
            );
        }
    }

    private handleSettingsEnabled(): void {
        this.contextManager.warmupShowContext();
        if (
            !this.syncer.video ||
            (document.body && !document.body.contains(this.syncer.video))
        ) {
            const v = document.querySelector('video');
            if (v) this.attachVideo(v);
        }
        this.overlay.mountToPlayer(this.adapter?.getPlayerContainer?.());

        if (this.store.cues.length > 0 && this.syncer.video) {
            const epoch = Date.now();
            this.store.sessionEpoch = epoch;
            this.pipeline.loadSubtitlesForCurrentTrack(
                this.store.cues,
                epoch,
                this.store.currentTrackHash,
            );
            if (!this.syncer.video.paused) this.syncer.startRafLoop();
        } else if (this.store.cues.length === 0 && this.adapter) {
            // Subtitle loading is managed by fetchSubtitle and content polling orchestrator
        }
    }

    destroy(): void {
        if (this.warmupTimer) {
            clearTimeout(this.warmupTimer);
            this.warmupTimer = null;
        }
        this.unsubscribeGlossary?.();
        this.unsubscribeCuesStale?.();
        this.syncer.detachVideo();
        this.historyTracker?.destroy();
        this.frictionManager?.dispose();
        this.pipeline.stopNativePollingInterval();
        this.clearCues();
        this.logger.info(
            'SubtitleManager',
            'SubtitleManager successfully destroyed.',
        );
    }
}

export default SubtitleManager;
