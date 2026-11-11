import {
    IStreamingAdapter,
    SubtitleCueData,
    VideoMetadata,
    IAdDetector,
    AdDetectorOptions,
} from '../../../domain/adapters/IStreamingAdapter';
import { SubtitleParser } from '../../../application/utils/parser';
import { TVerSubtitleParser } from './TVerSubtitleParser';
import { TVerAdDetector } from './TVerAdDetector';
import { STREAMING_PLATFORMS } from '@shared/domain/constants/StreamingPlatforms';
import { NCW_MESSAGE_TYPES } from '@shared/domain/constants/MessageTypes';
import { Logger } from '@shared/utils/logger';
import { PlaybackDatasetHelper } from '@shared/domain/entities/PlaybackDatasetPayload';

export class TVerContentAdapter implements IStreamingAdapter {
    readonly platformName = STREAMING_PLATFORMS.TVER;
    private adDetector: TVerAdDetector;
    private messageListeners: Array<(event: MessageEvent) => void> = [];
    private cachedMetadata?: VideoMetadata;
    private readonly logger: Logger = new Logger('TVerContentAdapter');

    constructor() {
        this.adDetector = new TVerAdDetector();
    }

    createAdDetector(options?: AdDetectorOptions): IAdDetector {
        if (this.adDetector) {
            this.adDetector.stopMonitoring();
        }
        this.adDetector = new TVerAdDetector(options);
        return this.adDetector;
    }

    matches(url: string): boolean {
        return /tver\.jp/i.test(url);
    }

    extractVideoId(url: string = window.location.href): string | null {
        const match = (url || '').match(/\/episodes\/([a-zA-Z0-9_-]+)/);
        if (match) return match[1];
        if (this.cachedMetadata?.videoId) return this.cachedMetadata.videoId;
        return null;
    }

    isPlaybackPage(url: string = window.location.href): boolean {
        return (
            /\/episodes\/([a-zA-Z0-9_-]+)/.test(url) ||
            Boolean(this.extractVideoId(url))
        );
    }

    getVideoInfo(): VideoMetadata {
        if (this.cachedMetadata) {
            return this.cachedMetadata;
        }

        const ds =
            typeof document !== 'undefined' && document.documentElement
                ? document.documentElement.dataset
                : undefined;

        const isLive =
            ds?.ncwIsLive === 'true' ||
            (typeof window !== 'undefined' &&
                (window.location.href.includes('/live/') ||
                    window.location.href.includes('simul')));

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
                videoId: this.extractVideoId() || '',
                showId: ds.ncwShowId,
                seasonId: ds.ncwSeasonId,
                showSummary: ds.ncwShowSummary,
                episodeSummary: ds.ncwEpisodeSummary,
                isLive,
            };
        }

        // Fallback: parse from page document title (e.g. "VIVANT 第二十話 ... | TVer")
        let rawTitle =
            typeof document !== 'undefined' ? document.title || '' : '';
        rawTitle = rawTitle.replace(/\s*\|\s*TVer.*$/i, '').trim();

        return {
            mainTitle: rawTitle,
            episodeTitle: '',
            fullTitle: rawTitle,
            videoId: this.extractVideoId() || '',
            isLive,
        };
    }

    getVideoElement(): HTMLVideoElement | null {
        return (
            (document.getElementById(
                'video-player',
            ) as HTMLVideoElement | null) || document.querySelector('video')
        );
    }

    getPlayerContainer(): HTMLElement | null {
        const video = this.getVideoElement();
        const candidate =
            (document.querySelector(
                '[class*="EpisodePlayer_container"]',
            ) as HTMLElement | null) ||
            (video?.closest('.video-js') as HTMLElement | null) ||
            (document.querySelector('.video-js') as HTMLElement | null) ||
            (document.querySelector(
                '[class*="EpisodePlayer_videoContainer"]',
            ) as HTMLElement | null) ||
            (document.querySelector(
                '[class*="EpisodePlayer_video"]',
            ) as HTMLElement | null) ||
            (video?.parentElement as HTMLElement | null) ||
            (document.querySelector(
                '[js-fullscreen-target]',
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

    async getContentTime(): Promise<number | null | undefined> {
        const currentVideoId = this.extractVideoId();

        // 1. Authoritative high-frequency dataset sync (Type 4)
        const payload = PlaybackDatasetHelper.read(currentVideoId);
        if (payload) {
            if (payload.isPaused) return payload.currentTime;
            const now = performance.now();
            const elapsed = Math.max(0, now - payload.syncAt);
            if (elapsed < 5000) {
                return payload.currentTime + (elapsed / 1000) * (payload.playbackRate || 1.0);
            }
            return payload.currentTime;
        }

        // 2. Legacy dataset fallback (for backwards compatibility during transition)
        if (document.documentElement && document.documentElement.dataset) {
            const atomicStr = document.documentElement.dataset.ncwSegmentAtomic;
            if (atomicStr) {
                const parts = atomicStr.split('|');
                if (parts.length >= 4) {
                    const baseTime = parseFloat(parts[0]);
                    const syncAt = parseFloat(parts[1]);
                    const isPaused = parts[2] === '1';
                    const rate = parseFloat(parts[3]) || 1.0;

                    if (!isNaN(baseTime) && baseTime >= 0) {
                        const now = performance.now();
                        const elapsed = Math.max(0, now - syncAt);
                        if (elapsed < 3000) {
                            return isPaused
                                ? baseTime
                                : baseTime + (elapsed / 1000) * rate;
                        }
                        return baseTime;
                    }
                }
            }
        }

        // 3. Fallback to HTMLVideoElement currentTime
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
                        'TVer-AI-Sub',
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
                    seasonId: payload.seasonId,
                    showSummary: payload.showSynopsis,
                    episodeSummary: payload.currentEpisode?.episodeSynopsis,
                    seasonNum: payload.seasonSeq,
                    episodeNum: payload.currentEpisode?.episodeSeq,
                    isLive: payload.isLive,
                };

                this.cachedMetadata = meta;
                this.logger.info(
                    'TVer-AI-Sub',
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
        return TVerSubtitleParser.parse(rawText);
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
                        const language =
                            event.data.bcp47 ||
                            SubtitleParser.detectLanguage(rawText, cues) ||
                            'ja';

                        this.logger.info(
                            'TVer-AI-Sub',
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
                        'TVer-AI-Sub',
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

    onSubtitleUpdated(callback: (movieId?: string) => void): () => void {
        const listener = (event: MessageEvent) => {
            if (event.source !== window || !event.data) return;
            if (event.data.type === NCW_MESSAGE_TYPES.SUBTITLE_UPDATED) {
                callback(event.data.movieId);
            }
        };
        window.addEventListener('message', listener);
        this.messageListeners.push(listener);
        return () => window.removeEventListener('message', listener);
    }

    requestSubtitleRetry(): void {
        this.logger.info(
            'TVer-AI-Sub',
            'Posting REQUEST_SUBTITLE_RETRY to TVer injected adapter.',
        );
        window.postMessage(
            { type: NCW_MESSAGE_TYPES.REQUEST_SUBTITLE_RETRY },
            '*',
        );
    }

    requestMetadata(movieId?: string): void {
        this.logger.info(
            'TVer-AI-Sub',
            `Posting REQUEST_METADATA (${movieId || 'active'}) to TVer injected adapter.`,
        );
        window.postMessage(
            {
                type: NCW_MESSAGE_TYPES.REQUEST_METADATA,
                movieId: movieId ? String(movieId) : undefined,
            },
            '*',
        );
    }

    async queryMetadata(
        movieId?: string,
    ): Promise<VideoMetadata | null | undefined> {
        const queryId = `qm_tv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const effectiveMid = movieId ? String(movieId) : undefined;

        return new Promise<VideoMetadata | null | undefined>((resolve) => {
            let resolved = false;
            let timer: ReturnType<typeof setTimeout> | null = null;

            const handler = (event: MessageEvent) => {
                if (event.source !== window || !event.data) return;
                if (
                    event.data.type ===
                        NCW_MESSAGE_TYPES.QUERY_METADATA_RESULT &&
                    event.data.queryId === queryId
                ) {
                    resolved = true;
                    if (timer) clearTimeout(timer);
                    window.removeEventListener('message', handler);

                    const { status, metadata } = event.data;
                    if (status === 'resolved' && metadata) {
                        this.cachedMetadata = metadata;
                        resolve(metadata);
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
                    type: NCW_MESSAGE_TYPES.QUERY_METADATA,
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
            }, 1500);
        });
    }

    async fetchSubttile(
        movieId: string,
    ): Promise<{ rawText: string; bcp: string } | null | undefined> {
        const queryId = `qstv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
                        if (status === 'resolved' && rawText && bcp) {
                            resolve({ rawText, bcp });
                        } else if (status === 'null') {
                            resolve(null);
                        } else {
                            resolve(undefined);
                        }
                    }
                };

                window.addEventListener('message', handler);
                this.messageListeners.push(handler);

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
                }, 2000);
            },
        );
    }

    clearMetadata(): void {
        this.cachedMetadata = undefined;
        if (
            typeof document !== 'undefined' &&
            document.documentElement?.dataset
        ) {
            delete document.documentElement.dataset.ncwShowId;
            delete document.documentElement.dataset.ncwMainTitle;
            delete document.documentElement.dataset.ncwEpisodeTitle;
        }
    }

    dispose(): void {
        this.adDetector.stopMonitoring();
        this.messageListeners.forEach((l) =>
            window.removeEventListener('message', l),
        );
        this.messageListeners = [];
    }
}
