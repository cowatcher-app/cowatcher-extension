import {
    IStreamingAdapter,
    VideoMetadata,
} from '../../domain/adapters/IStreamingAdapter';
import { ContentMessageService } from '../services/ContentMessageService';
import { WatchSession } from '@shared/domain/entities/WatchHistory';
import { Logger } from '@shared/utils/logger';
import { startTriStatePoll, PollHandle } from '../utils/pollHelper';
import { PlaybackDatasetHelper } from '@shared/domain/entities/PlaybackDatasetPayload';

export class WatchHistoryTracker {
    private readonly adapter: IStreamingAdapter;
    private readonly messageService: ContentMessageService;
    private readonly isAdPlaying?: () => boolean;
    private readonly logger: Logger = new Logger('WatchHistoryTracker');

    // Tri-state metadata:
    // - VideoMetadata: Confirmed metadata loaded
    // - null: Confirmed standalone video without episodic show metadata
    // - undefined: Unknown / pending (in-flight or in transition, caller schedules retry)
    private currentMetadata: VideoMetadata | null | undefined = undefined;
    private currentMovieId: string | null = null;
    private metadataPollHandle: PollHandle<VideoMetadata> | null = null;
    private metadataAbortController: AbortController | null = null;

    private currentSessionId: string | null = null;
    private sessionStartedAt: number = 0;
    private fromContentTime: number = 0;
    private lastContentTime: number = 0;
    private effectiveWatchSeconds: number = 0;
    private lastWallClockTick: number = 0;
    private isPlaying: boolean = false;
    private hasPendingFlush: boolean = false;

    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private boundVideo: HTMLVideoElement | null = null;

    constructor(
        adapter: IStreamingAdapter,
        messageService: ContentMessageService,
        isAdPlaying?: () => boolean,
    ) {
        this.adapter = adapter;
        this.messageService = messageService;
        this.isAdPlaying = isAdPlaying;

        this.onPlay = this.onPlay.bind(this);
        this.onPause = this.onPause.bind(this);
        this.onTick = this.onTick.bind(this);
        this.onSeeking = this.onSeeking.bind(this);
        this.onSeeked = this.onSeeked.bind(this);
        this.onPageUnload = this.onPageUnload.bind(this);
        this.onVisibilityChange = this.onVisibilityChange.bind(this);

        // Listen for tab/window unload to safely flush final watch duration
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', this.onPageUnload);
            window.addEventListener('pagehide', this.onPageUnload);
        }
        if (typeof document !== 'undefined') {
            document.addEventListener(
                'visibilitychange',
                this.onVisibilityChange,
            );
        }

        // Periodic heartbeat (every 30s) to persist long sessions safely against crashes
        this.heartbeatInterval = setInterval(() => {
            if (this.isPlaying && this.effectiveWatchSeconds >= 5) {
                this.flushSession(true);
            }
        }, 30000);
    }

    private onVisibilityChange(): void {
        if (
            typeof document !== 'undefined' &&
            document.visibilityState === 'hidden' &&
            this.isPlaying
        ) {
            this.flushSession(true);
        }
    }

    attachVideo(video: HTMLVideoElement): void {
        if (this.boundVideo === video) return;
        this.detachVideo();

        this.boundVideo = video;
        video.addEventListener('play', this.onPlay);
        video.addEventListener('pause', this.onPause);
        video.addEventListener('ended', this.onPause);
        video.addEventListener('timeupdate', this.onTick);
        video.addEventListener('seeking', this.onSeeking);
        video.addEventListener('seeked', this.onSeeked);

        if (!video.paused && !video.ended) {
            this.onPlay();
        }
    }

    detachVideo(): void {
        if (!this.boundVideo) return;
        this.isPlaying = false;
        this.flushSession(false);

        this.boundVideo.removeEventListener('play', this.onPlay);
        this.boundVideo.removeEventListener('pause', this.onPause);
        this.boundVideo.removeEventListener('ended', this.onPause);
        this.boundVideo.removeEventListener('timeupdate', this.onTick);
        this.boundVideo.removeEventListener('seeking', this.onSeeking);
        this.boundVideo.removeEventListener('seeked', this.onSeeked);
        this.boundVideo = null;
    }

    onEpisodeChange(newMovieId: string | null): void {
        const newIdStr = newMovieId ? String(newMovieId) : null;
        this.logger.info(
            'Tracker',
            `Episode change detected (${newIdStr || 'new'}).`,
        );

        // Flush previous session if it exists
        if (this.currentSessionId) {
            this.flushSession(false);
        }
        this.currentMovieId = newIdStr;
        this.currentSessionId = null;
        this.effectiveWatchSeconds = 0;
        this.fromContentTime = 0;
        this.lastContentTime = 0;
        this.hasPendingFlush = false;
        this.currentMetadata = undefined; // reset to pending

        if (this.metadataPollHandle) {
            this.metadataPollHandle.stop();
            this.metadataPollHandle = null;
        }
        if (this.metadataAbortController) {
            this.metadataAbortController.abort();
            this.metadataAbortController = null;
        }

        if (newIdStr) {
            this.resolveMetadata(newIdStr);
        }
    }

    onMetadataLoaded(meta: VideoMetadata): void {
        if (!meta) return;

        // Input consistency check: If metadata has videoId, it MUST match currentMovieId
        if (
            this.currentMovieId &&
            meta.videoId &&
            meta.videoId !== this.currentMovieId
        ) {
            this.logger.warn(
                'Tracker',
                `Dropped metadata for ${meta.videoId} because currentMovieId is ${this.currentMovieId}. Inconsistency strictly prevented.`,
            );
            return;
        }

        if (!this.currentMovieId && meta.videoId) {
            this.currentMovieId = meta.videoId;
        }

        // If metadata does not contain videoId, bound to currentMovieId
        if (!meta.videoId && this.currentMovieId) {
            meta = { ...meta, videoId: this.currentMovieId };
        }

        // If switching to a different episode or show, flush previous session first
        if (
            this.currentMetadata &&
            (this.currentMetadata.videoId !== meta.videoId ||
                this.currentMetadata.showId !== meta.showId)
        ) {
            this.flushSession(false);
        }

        this.currentMetadata = meta;

        // Automatically resume any deferred flush once metadata has been confirmed
        if (this.hasPendingFlush || (this.currentSessionId && !this.isPlaying)) {
            this.hasPendingFlush = false;
            this.flushSession(false);
        }
    }

    async resolveMetadata(
        movieId?: string,
    ): Promise<VideoMetadata | null | undefined> {
        const targetMovieId = movieId || this.currentMovieId || undefined;
        if (!targetMovieId) return this.currentMetadata;
        if (
            this.currentMetadata !== undefined &&
            this.currentMovieId === targetMovieId
        ) {
            return this.currentMetadata;
        }

        if (this.metadataPollHandle) {
            this.metadataPollHandle.stop();
            this.metadataPollHandle = null;
        }
        if (this.metadataAbortController) {
            this.metadataAbortController.abort();
            this.metadataAbortController = null;
        }

        const abortController = new AbortController();
        this.metadataAbortController = abortController;

        const handle = await startTriStatePoll(
            () => this.adapter.queryMetadata(targetMovieId),
            {
                immediate: true,
                intervalMs: 1200,
                maxAttempts: 15,
                timeoutMs: 60 * 1000,
                backoffFactor: 1.2,
                maxIntervalMs: 3000,
                abortSignal: abortController.signal,
                onSuccess: (result) => {
                    if (this.currentMovieId !== targetMovieId) return;
                    this.currentMetadata = result;
                    this.logger.info(
                        'Tracker',
                        `Metadata resolved via poll: ${result ? result.fullTitle : 'null (standalone video)'}`,
                    );
                    if (
                        this.hasPendingFlush ||
                        (this.currentSessionId && !this.isPlaying)
                    ) {
                        this.hasPendingFlush = false;
                        this.flushSession(false);
                    }
                },
            },
        );

        this.metadataPollHandle = handle;
        if (handle.initialResult !== undefined) {
            if (this.currentMovieId === targetMovieId) {
                this.currentMetadata = handle.initialResult;
                if (
                    this.hasPendingFlush ||
                    (this.currentSessionId && !this.isPlaying)
                ) {
                    this.hasPendingFlush = false;
                    this.flushSession(false);
                }
            }
            return handle.initialResult;
        }

        return undefined;
    }

    private getAccurateContentTime(): number {
        if (typeof document !== 'undefined' && document.documentElement) {
            const payload = PlaybackDatasetHelper.read(
                this.currentMovieId,
                document.documentElement,
            );
            if (
                payload &&
                typeof payload.currentTime === 'number' &&
                !isNaN(payload.currentTime) &&
                payload.currentTime >= 0
            ) {
                return payload.currentTime;
            }
        }
        return this.boundVideo?.currentTime || 0;
    }

    private onPlay(): void {
        this.isPlaying = true;
        const now = Date.now();
        const accurateTime = this.getAccurateContentTime();

        if (!this.currentSessionId) {
            this.currentSessionId = `ws_${now}_${Math.random().toString(36).slice(2, 7)}`;
            this.sessionStartedAt = now;
            this.fromContentTime = accurateTime;
            this.lastContentTime = accurateTime;
            this.effectiveWatchSeconds = 0;
        }

        this.lastWallClockTick = now;

        const sessionId = this.currentSessionId;
        const movieId = this.currentMovieId;
        this.adapter
            .getContentTime()
            .then((ct) => {
                if (
                    this.currentSessionId === sessionId &&
                    this.currentMovieId === movieId &&
                    typeof ct === 'number' &&
                    !isNaN(ct) &&
                    ct >= 0
                ) {
                    this.fromContentTime = ct;
                    this.lastContentTime = ct;
                }
            })
            .catch(() => {});

        // If metadata is still undefined, kick off resolution
        if (this.currentMetadata === undefined) {
            this.resolveMetadata();
        }
    }

    private onPause(): void {
        this.isPlaying = false;
        this.flushSession(false);
    }

    private onSeeking(): void {
        // If user is scrubbing/seeking, flush current segment before jump
        if (this.currentSessionId) {
            this.flushSession(false);
        }
    }

    private onSeeked(): void {
        const accurateTime = this.getAccurateContentTime();
        this.fromContentTime = accurateTime;
        this.lastContentTime = accurateTime;
        this.effectiveWatchSeconds = 0;
        this.lastWallClockTick = Date.now();

        const sessionId = this.currentSessionId;
        const movieId = this.currentMovieId;
        this.adapter
            .getContentTime()
            .then((ct) => {
                if (
                    this.currentSessionId === sessionId &&
                    this.currentMovieId === movieId &&
                    typeof ct === 'number' &&
                    !isNaN(ct) &&
                    ct >= 0
                ) {
                    this.fromContentTime = ct;
                    this.lastContentTime = ct;
                }
            })
            .catch(() => {});

        if (this.boundVideo && !this.boundVideo.paused) {
            this.onPlay();
        }
    }

    private onTick(): void {
        if (!this.isPlaying) return;
        if (this.isAdPlaying && this.isAdPlaying()) return;

        const now = Date.now();
        const currentContentTime = this.getAccurateContentTime();
        const wallDelta = (now - this.lastWallClockTick) / 1000;
        this.lastWallClockTick = now;

        const contentDelta = Math.abs(
            currentContentTime - this.lastContentTime,
        );

        // If sudden unexpected jump occurred (> 15 seconds), treat as a jump/skip
        if (contentDelta > 15) {
            this.flushSession(false);
            this.currentSessionId = `ws_${now}_${Math.random().toString(36).slice(2, 7)}`;
            this.sessionStartedAt = now;
            this.fromContentTime = currentContentTime;
            this.lastContentTime = currentContentTime;
            this.effectiveWatchSeconds = 0;
            return;
        }

        // Normal continuous playback: accumulate effective watch time
        if (wallDelta > 0 && wallDelta < 5) {
            this.effectiveWatchSeconds += Math.min(wallDelta, 2);
            this.lastContentTime = currentContentTime;
        }
    }

    private flushSession(isOngoing: boolean): void {
        if (!this.currentSessionId) return;

        // Discard negligible blips under 3 seconds
        if (this.effectiveWatchSeconds < 3) {
            if (!isOngoing) {
                this.currentSessionId = null;
                this.effectiveWatchSeconds = 0;
                this.hasPendingFlush = false;
            }
            return;
        }

        // Tri-state check:
        // If undefined: metadata is unknown / pending.
        // Do NOT discard! Defer and retry query so we never drop the session or record garbage.
        if (this.currentMetadata === undefined) {
            this.logger.info(
                'Tracker',
                'Flush deferred: metadata is undefined (pending). Scheduling active query retry.',
            );
            this.hasPendingFlush = true;
            this.resolveMetadata();
            return;
        }

        // Verify entity consistency: if metadata videoId doesn't match currentMovieId, don't record wrong video!
        if (
            this.currentMetadata &&
            this.currentMovieId &&
            this.currentMetadata.videoId &&
            this.currentMetadata.videoId !== this.currentMovieId
        ) {
            this.logger.warn(
                'Tracker',
                `Consistency violation prevented on flush: metadata ${this.currentMetadata.videoId} !== ${this.currentMovieId}. Invalidation triggered.`,
            );
            this.currentMetadata = undefined;
            this.hasPendingFlush = true;
            return;
        }

        this.hasPendingFlush = false;
        const meta = this.currentMetadata;
        let showId: string;
        let showTitle: string;
        let videoId: string;

        if (meta === null) {
            // Confirmed standalone title
            videoId =
                this.currentMovieId ||
                this.adapter.extractVideoId() ||
                'standalone_video';
            showId = videoId;
            showTitle = 'Standalone Video';
        } else {
            showId = meta.showId || meta.videoId;
            showTitle = meta.fullTitle || meta.mainTitle || 'Unknown Show';
            videoId = meta.videoId || showId;
        }

        const rawDuration =
            this.boundVideo?.duration ||
            this.adapter.getVideoElement()?.duration ||
            0;
        const duration =
            typeof rawDuration === 'number' &&
            !isNaN(rawDuration) &&
            isFinite(rawDuration) &&
            rawDuration > 0
                ? Math.round(rawDuration)
                : 0;

        const session: WatchSession = {
            id: this.currentSessionId,
            platform: this.adapter.platformName,
            showId,
            showTitle,
            seasonNum: meta?.seasonNum,
            episodeNum: meta?.episodeNum,
            episodeTitle: meta?.episodeTitle,
            videoId,
            startedAt: this.sessionStartedAt,
            endedAt: Date.now(),
            fromContentTime: Number.isFinite(this.fromContentTime)
                ? Math.max(0, Math.round(this.fromContentTime))
                : 0,
            toContentTime: Number.isFinite(this.lastContentTime)
                ? Math.max(0, Math.round(this.lastContentTime))
                : 0,
            videoDuration: duration,
            effectiveWatchSeconds: Number.isFinite(this.effectiveWatchSeconds)
                ? Math.max(0, Math.round(this.effectiveWatchSeconds))
                : 0,
        };

        this.messageService.recordWatchSession(session).catch((err) => {
            this.logger.warn('Flush', 'Failed to record session:', err);
        });

        if (!isOngoing) {
            this.currentSessionId = null;
            this.effectiveWatchSeconds = 0;
        }
    }

    private onPageUnload(): void {
        if (this.currentSessionId && this.effectiveWatchSeconds >= 3) {
            this.flushSession(false);
        }
    }

    destroy(): void {
        if (this.metadataPollHandle) {
            this.metadataPollHandle.stop();
            this.metadataPollHandle = null;
        }
        if (this.metadataAbortController) {
            this.metadataAbortController.abort();
            this.metadataAbortController = null;
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (typeof window !== 'undefined') {
            window.removeEventListener('beforeunload', this.onPageUnload);
            window.removeEventListener('pagehide', this.onPageUnload);
        }
        if (typeof document !== 'undefined') {
            document.removeEventListener(
                'visibilitychange',
                this.onVisibilityChange,
            );
        }
        this.detachVideo();
        this.isPlaying = false;
        this.hasPendingFlush = false;
        this.logger.info('WatchHistoryTracker', 'WatchHistoryTracker destroyed.');
    }
}
