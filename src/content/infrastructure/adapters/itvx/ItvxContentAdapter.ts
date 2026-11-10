import {
    IStreamingAdapter,
    SubtitleCueData,
    VideoMetadata,
    IAdDetector,
    AdDetectorOptions,
} from '../../../domain/adapters/IStreamingAdapter';
import { SubtitleParser } from '../../../application/utils/parser';
import { ItvxAdDetector } from './ItvxAdDetector';
import { STREAMING_PLATFORMS } from '@shared/domain/constants/StreamingPlatforms';
import { NCW_MESSAGE_TYPES } from '@shared/domain/constants/MessageTypes';
import { Logger } from '@shared/utils/logger';
import { PlaybackDatasetHelper } from '@shared/domain/entities/PlaybackDatasetPayload';

export class ItvxContentAdapter implements IStreamingAdapter {
    readonly platformName = STREAMING_PLATFORMS.ITVX;
    private adDetector: ItvxAdDetector;
    private messageListeners: Array<(event: MessageEvent) => void> = [];
    private cachedMetadata?: VideoMetadata;
    private readonly logger: Logger = new Logger('ItvxContentAdapter');

    constructor() {
        this.adDetector = new ItvxAdDetector();
    }

    createAdDetector(options?: AdDetectorOptions): IAdDetector {
        if (this.adDetector) {
            this.adDetector.stopMonitoring();
        }
        this.adDetector = new ItvxAdDetector(options);
        return this.adDetector;
    }

    matches(url: string): boolean {
        return /itv\.com/i.test(url);
    }

    extractVideoId(url: string = window.location.href): string | null {
        if (!url) return null;
        try {
            const urlObj = new URL(url, window.location.origin);
            const pathname = urlObj.pathname;

            // Pattern 1: /watch/:seriesSlug/:programmeId/:episodeId
            // e.g. /watch/scandal/10a6587/10a6587a0002
            const epMatch = pathname.match(
                /\/watch\/[^/]+\/[^/]+\/([a-zA-Z0-9]+)/i,
            );
            if (epMatch) {
                return epMatch[1];
            }

            // Pattern 2: /watch/:seriesSlug/:programmeId (defaults to first episode)
            // e.g. /watch/scandal/10a6587
            const showMatch = pathname.match(/\/watch\/[^/]+\/([a-zA-Z0-9]+)/i);
            if (showMatch) {
                return `${showMatch[1]}a0001`;
            }
        } catch {}

        if (this.cachedMetadata?.videoId) return this.cachedMetadata.videoId;
        return null;
    }

    extractShowId(videoId?: string | null): string | null {
        if (videoId) {
            // e.g. 10a6587a0002 -> 10a6587
            const match = videoId.match(/^([a-zA-Z0-9]+)a\d{4}$/i);
            if (match) return match[1];
        }

        try {
            const url = window.location.href;
            const match = url.match(/\/watch\/[^/]+\/([a-zA-Z0-9]+)/i);
            if (match) return match[1];
        } catch {}

        return videoId || null;
    }

    isPlaybackPage(url: string = window.location.href): boolean {
        return /\/watch\//i.test(url) || Boolean(this.extractVideoId(url));
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

        // Fallback: parse __NEXT_DATA__ directly from DOM if accessible
        try {
            const el = document.getElementById('__NEXT_DATA__');
            if (el?.textContent) {
                const json = JSON.parse(el.textContent);
                const programme = json.props?.pageProps?.programme;
                if (programme?.title) {
                    const mainTitle = programme.title;
                    const showSynopsis =
                        programme.longDescription || programme.description;
                    let epTitle = '';
                    let epSynopsis: string | undefined;
                    let epNum: number | undefined;
                    let seasonNum: number | undefined;

                    const seriesList = json.props?.pageProps?.seriesList;
                    if (Array.isArray(seriesList)) {
                        for (const s of seriesList) {
                            if (Array.isArray(s.titles)) {
                                const found = s.titles.find(
                                    (t: {
                                        encodedEpisodeId?: { letterA?: string };
                                    }) =>
                                        t.encodedEpisodeId?.letterA === videoId,
                                );
                                if (found) {
                                    epTitle = found.episodeTitle || '';
                                    epSynopsis =
                                        found.longDescription ||
                                        found.description;
                                    epNum = found.episode;
                                    seasonNum = found.series;
                                    break;
                                }
                            }
                        }
                    }

                    const fullTitle = epTitle
                        ? `${mainTitle} - ${epTitle}`
                        : mainTitle;
                    return {
                        mainTitle,
                        episodeTitle: epTitle,
                        fullTitle,
                        videoId,
                        showId:
                            programme.encodedProgrammeId?.letterA ||
                            fallbackShowId,
                        showSummary: showSynopsis,
                        episodeSummary: epSynopsis,
                        episodeNum: epNum,
                        seasonNum,
                    };
                }
            }
        } catch {}

        // Fallback: parse from DOM elements
        const titleEl = document.querySelector(
            '.fe-mrphs__programme__title, [data-testid="programme-title"]',
        );
        const title =
            titleEl?.textContent?.trim() ||
            document.title.replace(/\s*-\s*ITVX$/i, '').trim();

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
                '.fe-mrphs__videoParent video:not(#advertPlayerA):not(#advertPlayerB)',
            ) as HTMLVideoElement | null) ||
            (document.querySelector(
                '[data-testid="video-parent"] video:not([id*="advert"])',
            ) as HTMLVideoElement | null) ||
            (document.querySelector(
                'video:not([id*="advert"])',
            ) as HTMLVideoElement | null) ||
            document.querySelector('video')
        );
    }

    getPlayerContainer(): HTMLElement | null {
        const candidate =
            (document.querySelector(
                '[data-testid="vod-player"]',
            ) as HTMLElement | null) ||
            (document.querySelector(
                '[data-testid="player"]',
            ) as HTMLElement | null) ||
            (document.querySelector(
                '.videoPlayerWrapper',
            ) as HTMLElement | null) ||
            (document.querySelector(
                '.fe-morpheus-container',
            ) as HTMLElement | null) ||
            (document.querySelector(
                '.fe-mrphs__videoParent',
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
        const subEls = document.querySelectorAll(
            '[data-testid="content-subtitles"], [data-testid="ad-subtitles"], .fe-mrphs__subtitles',
        );
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
                        'ItvxContentAdapter',
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
                    'ItvxContentAdapter',
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
                            'ItvxContentAdapter',
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
                        'ItvxContentAdapter',
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
            'ItvxContentAdapter',
            'Posting REQUEST_SUBTITLE_RETRY to ITVX injected adapter.',
        );
        window.postMessage(
            { type: NCW_MESSAGE_TYPES.REQUEST_SUBTITLE_RETRY },
            '*',
        );
    }

    requestMetadata(movieId?: string): void {
        this.logger.info(
            'ItvxContentAdapter',
            `Posting REQUEST_METADATA (${movieId || 'active'}) to ITVX injected adapter.`,
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
        if (/^[a-zA-Z0-9]+a\d{4}$/i.test(title)) return false;
        if (title.endsWith('ITVX')) return false;
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
            !ds.ncwMainTitle.startsWith('10a')
        ) {
            const meta = this.getVideoInfo();
            if (this.isGenuineMetadata(meta, targetVid)) {
                this.cachedMetadata = meta;
                return meta;
            }
        }

        // 3. Query injected adapter via tri-state message
        const queryId = `qm_itvx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
        const queryId = `qs_itvx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
