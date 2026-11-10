import {
    IStreamingAdapter,
    SubtitleCueData,
    VideoMetadata,
    IAdDetector,
    AdDetectorOptions,
} from '../../../domain/adapters/IStreamingAdapter';
import { SubtitleParser } from '../../../application/utils/parser';
import { Channel4AdDetector } from './Channel4AdDetector';
import { STREAMING_PLATFORMS } from '@shared/domain/constants/StreamingPlatforms';
import { NCW_MESSAGE_TYPES } from '@shared/domain/constants/MessageTypes';
import { Logger } from '@shared/utils/logger';
import { PlaybackDatasetHelper } from '@shared/domain/entities/PlaybackDatasetPayload';

export class Channel4ContentAdapter implements IStreamingAdapter {
    readonly platformName = STREAMING_PLATFORMS.CHANNEL4;
    private adDetector: Channel4AdDetector;
    private messageListeners: Array<(event: MessageEvent) => void> = [];
    private cachedMetadata?: VideoMetadata;
    private readonly logger: Logger = new Logger('Channel4ContentAdapter');

    constructor() {
        this.adDetector = new Channel4AdDetector();
    }

    createAdDetector(options?: AdDetectorOptions): IAdDetector {
        if (this.adDetector) {
            this.adDetector.stopMonitoring();
        }
        this.adDetector = new Channel4AdDetector(options);
        return this.adDetector;
    }

    matches(url: string): boolean {
        return /channel4\.com/i.test(url);
    }

    extractVideoId(url: string = window.location.href): string | null {
        if (!url) return null;
        try {
            const urlObj = new URL(url, window.location.origin);
            const pathname = urlObj.pathname;

            // Pattern: /programmes/:brand/on-demand/:programmeId (e.g. 77381-001)
            const match = pathname.match(/\/on-demand\/([a-zA-Z0-9_-]+)/i);
            if (match) {
                return match[1];
            }
        } catch {}

        if (this.cachedMetadata?.videoId) return this.cachedMetadata.videoId;
        return null;
    }

    extractShowId(videoId?: string | null): string | null {
        if (videoId) {
            // e.g. 77381-001 -> 77381
            const hyphenIdx = videoId.indexOf('-');
            if (hyphenIdx > 0) {
                return videoId.slice(0, hyphenIdx);
            }
        }

        try {
            const url = window.location.href;
            const match = url.match(/\/programmes\/([^/?#]+)/i);
            if (match) return match[1];
        } catch {}

        return videoId || null;
    }

    isPlaybackPage(url: string = window.location.href): boolean {
        return /\/on-demand\//i.test(url) || Boolean(this.extractVideoId(url));
    }

    getVideoInfo(): VideoMetadata {
        if (this.cachedMetadata) {
            return this.cachedMetadata;
        }

        const videoId = this.extractVideoId() || '';
        const fallbackShowId = this.extractShowId(videoId) || videoId;

        const ds =
            typeof document !== 'undefined' && document.documentElement
                ? document.documentElement.dataset
                : undefined;

        if (ds && (ds.ncwMainTitle || ds.ncwShowId)) {
            const mainTitle = ds.ncwMainTitle || '';
            const episodeTitle = ds.ncwEpisodeTitle || '';
            const fullTitle = episodeTitle
                ? mainTitle
                    ? `${mainTitle} - ${episodeTitle}`
                    : episodeTitle
                : mainTitle;

            return {
                mainTitle,
                episodeTitle,
                fullTitle,
                videoId,
                showId: ds.ncwShowId || fallbackShowId,
                showSummary: ds.ncwShowSummary,
            };
        }

        // Fallback: parse from DOM elements
        const titleEl = document.querySelector(
            '.player__brand-title, .brand-title, [data-testid="brand-title"], .all4-brandhubs-header-v2__title',
        );
        const title =
            titleEl?.textContent?.trim() ||
            document.title.replace(/\s*-\s*Channel 4$/i, '').trim();

        return {
            mainTitle: title || videoId,
            episodeTitle: '',
            fullTitle: title || videoId,
            videoId,
            showId: fallbackShowId,
        };
    }

    getVideoElement(): HTMLVideoElement | null {
        return (
            (document.querySelector(
                'video.vod-player',
            ) as HTMLVideoElement | null) ||
            (document.querySelector(
                '#html5-player video:not(#freewheelPlayer)',
            ) as HTMLVideoElement | null) ||
            (document.querySelector(
                'video:not(#freewheelPlayer)',
            ) as HTMLVideoElement | null) ||
            document.querySelector('video')
        );
    }

    getPlayerContainer(): HTMLElement | null {
        const candidate =
            (document.querySelector('#html5-player') as HTMLElement | null) ||
            (document.querySelector(
                '.player__video__container',
            ) as HTMLElement | null) ||
            (document.querySelector(
                '.player__video__app',
            ) as HTMLElement | null) ||
            (document.querySelector(
                '#html5-player-wrapper',
            ) as HTMLElement | null) ||
            (document.querySelector(
                '.all4-brandhubs-header-v2__player',
            ) as HTMLElement | null) ||
            null;

        if (candidate && candidate !== document.body) {
            if (typeof window !== 'undefined') {
                const computed = window.getComputedStyle(candidate);
                if (!computed.position || computed.position === 'static') {
                    candidate.style.position = 'relative';
                }
            }
            return candidate;
        }

        return null;
    }

    setNativeSubtitleVisibility(visible: boolean): void {
        const subEls = document.querySelectorAll('.subtitles-container');
        subEls.forEach((el) => {
            (el as HTMLElement).style.display = visible ? '' : 'none';
        });
    }

    async getContentTime(): Promise<number | null | undefined> {
        const currentVideoId = this.extractVideoId();

        // 1. Authoritative dataset sync
        const payload = PlaybackDatasetHelper.read(currentVideoId);
        if (payload) {
            if (payload.isPaused) return payload.currentTime;
            const now = performance.now();
            const elapsed = Math.max(0, now - payload.syncAt);
            if (elapsed < 5000) {
                return (
                    payload.currentTime +
                    (elapsed / 1000) * (payload.playbackRate || 1.0)
                );
            }
            return payload.currentTime;
        }

        // 2. Direct HTMLVideoElement fallback
        const video = this.getVideoElement();
        if (video) {
            return video.currentTime || 0;
        }

        return undefined;
    }

    isAdActive(): boolean {
        return this.adDetector.isAdPlaying;
    }

    pausePlayback(): void {
        const video = this.getVideoElement();
        if (video && !video.paused) {
            video.pause();
        }
    }

    resumePlayback(): void {
        const video = this.getVideoElement();
        if (video && video.paused) {
            video.play().catch(() => {});
        }
    }

    isPlaybackPaused(): boolean {
        const video = this.getVideoElement();
        return video ? video.paused : true;
    }

    onEpisodeChange(callback: (newEpisodeId: string) => void): () => void {
        const listener = (event: MessageEvent) => {
            if (event.source !== window || !event.data) return;
            if (event.data.type === NCW_MESSAGE_TYPES.EPISODE_CHANGED) {
                const movieId = String(event.data.movieId || '');
                if (movieId) {
                    this.logger.info(
                        'Channel4ContentAdapter',
                        `Episode change event received: ${movieId}`,
                    );
                    callback(movieId);
                }
            }
        };
        window.addEventListener('message', listener);
        this.messageListeners.push(listener);
        return () => window.removeEventListener('message', listener);
    }

    onUrlChange(callback: (url: string) => void): () => void {
        const listener = (event: MessageEvent) => {
            if (event.source !== window || !event.data) return;
            if (
                event.data.type === NCW_MESSAGE_TYPES.URL_CHANGED &&
                event.data.url
            ) {
                callback(event.data.url);
            }
        };
        window.addEventListener('message', listener);
        this.messageListeners.push(listener);
        return () => window.removeEventListener('message', listener);
    }

    onTimeSync(
        callback: (offsets: {
            movieId: string;
            cadmiumOffset?: number;
            adOffset?: number;
        }) => void,
    ): () => void {
        const listener = (event: MessageEvent) => {
            if (event.source !== window || !event.data) return;
            if (event.data.type === NCW_MESSAGE_TYPES.TIME_SYNC) {
                const movieId = event.data.movieId
                    ? String(event.data.movieId)
                    : this.extractVideoId() || '';
                callback({
                    movieId,
                    cadmiumOffset: event.data.cadmiumOffset || 0,
                    adOffset: event.data.adOffset || 0,
                });
            }
        };
        window.addEventListener('message', listener);
        this.messageListeners.push(listener);
        return () => window.removeEventListener('message', listener);
    }

    onMetadataLoaded(callback: (metadata: VideoMetadata) => void): () => void {
        const listener = (event: MessageEvent) => {
            if (event.source !== window || !event.data) return;
            if (event.data.type === NCW_MESSAGE_TYPES.METADATA_LOADED) {
                const payload = event.data;
                const mainTitle = payload.showTitle || '';
                const episodeTitle = payload.currentEpisode?.episodeTitle || '';
                const fullTitle = episodeTitle
                    ? mainTitle
                        ? `${mainTitle} - ${episodeTitle}`
                        : episodeTitle
                    : mainTitle;

                const meta: VideoMetadata = {
                    mainTitle,
                    episodeTitle,
                    fullTitle,
                    videoId:
                        payload.currentEpisode?.episodeId ||
                        this.extractVideoId() ||
                        '',
                    showId: payload.showId,
                    showSummary: payload.showSynopsis,
                    episodeSummary: payload.currentEpisode?.episodeSynopsis,
                    episodeNum: payload.currentEpisode?.episodeSeq,
                };

                this.cachedMetadata = meta;
                this.logger.info(
                    'Channel4ContentAdapter',
                    `Parsed VideoMetadata: "${fullTitle}" (showId: ${meta.showId})`,
                );
                callback(meta);
            }
        };
        window.addEventListener('message', listener);
        this.messageListeners.push(listener);
        return () => window.removeEventListener('message', listener);
    }

    onSubtitlePreload(
        callback: (data: {
            movieId?: string;
            rawText: string;
            bcp47?: string | null;
            timestamp?: number;
        }) => void,
    ): () => void {
        const listener = (event: MessageEvent) => {
            if (event.source !== window || !event.data) return;
            if (event.data.type === NCW_MESSAGE_TYPES.SUBTITLE_PRELOAD_STAGED) {
                callback({
                    movieId: event.data.movieId,
                    rawText: event.data.rawText,
                    bcp47: event.data.bcp47,
                    timestamp: event.data.timestamp,
                });
            }
        };
        window.addEventListener('message', listener);
        this.messageListeners.push(listener);
        return () => window.removeEventListener('message', listener);
    }

    parseSubtitle(rawText: string): SubtitleCueData[] {
        return SubtitleParser.parse(rawText);
    }

    onSubtitleData(
        callback: (data: {
            cues: SubtitleCueData[];
            language: string;
            movieId?: string;
            isAsr?: boolean;
        }) => void,
    ): () => void {
        const listener = (event: MessageEvent) => {
            if (event.source !== window || !event.data) return;
            if (event.data.type === NCW_MESSAGE_TYPES.SUBTITLE_RAW_DATA) {
                const rawText = event.data.rawText;
                if (!rawText || typeof rawText !== 'string') return;

                try {
                    const cues = this.parseSubtitle(rawText);
                    if (cues && cues.length > 0) {
                        const language = event.data.bcp47 || 'en';

                        this.logger.info(
                            'Channel4ContentAdapter',
                            `Processed ${cues.length} subtitle cues (lang: ${language}, movieId: ${event.data.movieId})`,
                        );

                        callback({
                            cues,
                            language,
                            movieId: event.data.movieId,
                            isAsr: false,
                        });
                    }
                } catch (err) {
                    this.logger.error(
                        'Channel4ContentAdapter',
                        'Failed parsing raw subtitle text:',
                        err,
                    );
                }
            }
        };
        window.addEventListener('message', listener);
        this.messageListeners.push(listener);
        return () => window.removeEventListener('message', listener);
    }

    onSubtitleOff(callback: (movieId: string) => void): () => void {
        const listener = (event: MessageEvent) => {
            if (event.source !== window || !event.data) return;
            if (event.data.type === NCW_MESSAGE_TYPES.SUBTITLE_OFF) {
                const movieId = event.data.movieId
                    ? String(event.data.movieId)
                    : this.extractVideoId() || '';
                callback(movieId);
            }
        };
        window.addEventListener('message', listener);
        this.messageListeners.push(listener);
        return () => window.removeEventListener('message', listener);
    }

    requestSubtitleRetry(): void {
        this.logger.info(
            'Channel4ContentAdapter',
            'Posting REQUEST_SUBTITLE_RETRY to Channel 4 injected adapter.',
        );
        window.postMessage(
            { type: NCW_MESSAGE_TYPES.REQUEST_SUBTITLE_RETRY },
            '*',
        );
    }

    requestMetadata(movieId?: string): void {
        this.logger.info(
            'Channel4ContentAdapter',
            `Posting REQUEST_METADATA (${movieId || 'active'}) to Channel 4 injected adapter.`,
        );
        window.postMessage(
            {
                type: NCW_MESSAGE_TYPES.REQUEST_METADATA,
                movieId: movieId ? String(movieId) : undefined,
            },
            '*',
        );
    }

    private isGenuineMetadata(
        meta?: VideoMetadata | null,
        targetVid?: string,
    ): boolean {
        if (!meta || !meta.mainTitle) return false;
        const title = meta.mainTitle.trim();
        if (!title) return false;
        if (targetVid && title === targetVid) return false;
        if (/^\d{4,}-\d+$/.test(title)) return false;
        if (title.endsWith('Channel 4')) return false;
        return true;
    }

    async queryMetadata(
        movieId?: string,
    ): Promise<VideoMetadata | null | undefined> {
        const targetVid = movieId || this.extractVideoId() || '';

        // 1. Check cached metadata
        if (
            this.cachedMetadata &&
            this.cachedMetadata.videoId === targetVid &&
            this.isGenuineMetadata(this.cachedMetadata, targetVid)
        ) {
            return this.cachedMetadata;
        }

        // 2. Check DOM dataset populated by injected script
        const ds =
            typeof document !== 'undefined' && document.documentElement
                ? document.documentElement.dataset
                : undefined;
        if (
            ds &&
            ds.ncwMainTitle &&
            ds.ncwMainTitle !== targetVid &&
            !/^\d{4,}-\d+$/.test(ds.ncwMainTitle)
        ) {
            const meta = this.getVideoInfo();
            if (this.isGenuineMetadata(meta, targetVid)) {
                this.cachedMetadata = meta;
                return meta;
            }
        }

        // 3. Query injected adapter via tri-state message
        const queryId = `qm_c4_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const effectiveMid = movieId ? String(movieId) : undefined;

        return new Promise<VideoMetadata | null | undefined>((resolve) => {
            let resolved = false;
            let timer: ReturnType<typeof setTimeout> | null = null;

            const finish = (result: VideoMetadata | null | undefined) => {
                if (resolved) return;
                resolved = true;
                if (timer) clearTimeout(timer);
                window.removeEventListener('message', handler);

                if (result && this.isGenuineMetadata(result, targetVid)) {
                    this.cachedMetadata = result;
                    resolve(result);
                    return;
                }

                const domMeta = this.getVideoInfo();
                if (this.isGenuineMetadata(domMeta, targetVid)) {
                    this.cachedMetadata = domMeta;
                    resolve(domMeta);
                    return;
                }

                if (result === null) {
                    resolve(null);
                } else {
                    resolve(undefined);
                }
            };

            const handler = (event: MessageEvent) => {
                if (event.source !== window || !event.data) return;
                if (
                    event.data.type ===
                        NCW_MESSAGE_TYPES.QUERY_METADATA_RESULT &&
                    event.data.queryId === queryId
                ) {
                    const { status, metadata } = event.data;
                    if (status === 'resolved' && metadata) {
                        finish(metadata);
                    } else if (status === 'null') {
                        finish(null);
                    } else {
                        finish(undefined);
                    }
                }
            };

            window.addEventListener('message', handler);

            window.postMessage(
                {
                    type: NCW_MESSAGE_TYPES.QUERY_METADATA,
                    queryId,
                    movieId: effectiveMid,
                },
                '*',
            );

            timer = setTimeout(() => {
                finish(undefined);
            }, 800);
        });
    }

    async fetchSubttile(
        movieId: string,
    ): Promise<{ rawText: string; bcp: string } | null | undefined> {
        const queryId = `qs_c4_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const effectiveMid = movieId ? String(movieId) : undefined;

        return new Promise<{ rawText: string; bcp: string } | null | undefined>(
            (resolve) => {
                let resolved = false;
                let timer: ReturnType<typeof setTimeout> | null = null;

                const handler = (event: MessageEvent) => {
                    if (event.source !== window || !event.data) return;
                    if (
                        event.data.type ===
                            NCW_MESSAGE_TYPES.QUERY_SUBTITLE_RESULT &&
                        event.data.queryId === queryId
                    ) {
                        resolved = true;
                        if (timer) clearTimeout(timer);
                        window.removeEventListener('message', handler);

                        const { status, rawText, bcp } = event.data;
                        if (status === 'resolved' && rawText) {
                            resolve({ rawText, bcp: bcp || 'en' });
                        } else if (status === 'null') {
                            resolve(null);
                        } else {
                            resolve(undefined);
                        }
                    }
                };

                window.addEventListener('message', handler);

                window.postMessage(
                    {
                        type: NCW_MESSAGE_TYPES.QUERY_SUBTITLE,
                        queryId,
                        movieId: effectiveMid,
                    },
                    '*',
                );

                timer = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        window.removeEventListener('message', handler);
                        resolve(undefined);
                    }
                }, 800);
            },
        );
    }

    dispose(): void {
        this.adDetector.stopMonitoring();
        this.messageListeners.forEach((l) =>
            window.removeEventListener('message', l),
        );
        this.messageListeners = [];
    }
}
