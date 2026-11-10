import {
    IStreamingAdapter,
    SubtitleCueData,
    VideoMetadata,
    IAdDetector,
    AdDetectorOptions,
} from '../../../domain/adapters/IStreamingAdapter';
import { SubtitleParser } from '../../../application/utils/parser';
import { BilibiliSubtitleParser } from './BilibiliSubtitleParser';
import { BilibiliAdDetector } from './BilibiliAdDetector';
import { STREAMING_PLATFORMS } from '@shared/domain/constants/StreamingPlatforms';
import { NCW_MESSAGE_TYPES } from '@shared/domain/constants/MessageTypes';
import { Logger } from '@shared/utils/logger';
import { PlaybackDatasetHelper } from '@shared/domain/entities/PlaybackDatasetPayload';

export class BilibiliContentAdapter implements IStreamingAdapter {
    readonly platformName = STREAMING_PLATFORMS.BILIBILI;
    private adDetector: BilibiliAdDetector;
    private messageListeners: Array<(event: MessageEvent) => void> = [];
    private cachedMetadata?: VideoMetadata;
    private readonly logger: Logger = new Logger('BilibiliContentAdapter');

    constructor() {
        this.adDetector = new BilibiliAdDetector();
    }

    createAdDetector(options?: AdDetectorOptions): IAdDetector {
        if (this.adDetector) {
            this.adDetector.stopMonitoring();
        }
        this.adDetector = new BilibiliAdDetector(options);
        return this.adDetector;
    }

    matches(url: string): boolean {
        return /bilibili\.com/i.test(url);
    }

    extractVideoId(url: string = window.location.href): string | null {
        if (!url) return null;
        try {
            const urlObj = new URL(url, window.location.origin);
            const pathname = urlObj.pathname;

            // Bangumi episode: /bangumi/play/ep12345
            const epMatch = pathname.match(/\/bangumi\/play\/ep(\d+)/i);
            if (epMatch) {
                return `ep${epMatch[1]}`;
            }

            // Bangumi season: /bangumi/play/ss12345
            const ssMatch = pathname.match(/\/bangumi\/play\/ss(\d+)/i);
            if (ssMatch) {
                return `ss${ssMatch[1]}`;
            }

            // Standard video: /video/BV1xxxxxx or /video/av12345
            const bvMatch = pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/i);
            if (bvMatch) {
                const bvid = bvMatch[1];
                const p = urlObj.searchParams.get('p');
                return p && p !== '1' ? `${bvid}_p${p}` : `${bvid}_p1`;
            }

            const avMatch = pathname.match(/\/video\/(av\d+)/i);
            if (avMatch) {
                const avid = avMatch[1];
                const p = urlObj.searchParams.get('p');
                return p && p !== '1' ? `${avid}_p${p}` : `${avid}_p1`;
            }
        } catch {
            const bvMatch = url.match(/\/video\/(BV[a-zA-Z0-9]+)/i);
            if (bvMatch) return `${bvMatch[1]}_p1`;
        }

        if (this.cachedMetadata?.videoId) return this.cachedMetadata.videoId;
        return null;
    }

    extractShowId(videoId?: string | null): string | null {
        if (!videoId) return null;
        const bvMatch = videoId.match(/^(BV[a-zA-Z0-9]+)(?:_p\d+)?$/i);
        if (bvMatch) return bvMatch[1];
        const avMatch = videoId.match(/^(av\d+)(?:_p\d+)?$/i);
        if (avMatch) return avMatch[1];
        const ssMatch = videoId.match(/^(ss\d+)/i);
        if (ssMatch) return ssMatch[1];
        return videoId;
    }

    extractBvid(url: string = window.location.href): string | null {
        if (!url) return null;
        const match = url.match(/(?:video\/|bvid=|^)(BV[a-zA-Z0-9]+)/i);
        return match ? match[1] : null;
    }

    isPlaybackPage(url: string = window.location.href): boolean {
        return (
            /\/video\/(BV|av)/i.test(url) ||
            /\/bangumi\/play\/(ep|ss)/i.test(url) ||
            Boolean(this.extractVideoId(url))
        );
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
                ? mainTitle ? `${mainTitle} - ${episodeTitle}` : episodeTitle
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

        // Fallback: parse from page document title and DOM
        let rawTitle =
            typeof document !== 'undefined' ? document.title || '' : '';
        rawTitle = rawTitle
            .replace(/\s*_[^_\s]+_bilibili\s*$/i, '')
            .replace(/\s*-_bilibili\s*$/i, '')
            .trim();

        const domTitleEl =
            document.querySelector('h1.video-title') ||
            document.querySelector('.video-info-title-inner') ||
            document.querySelector('.media-title');
        const title = domTitleEl?.textContent?.trim() || rawTitle;

        const domDescEl =
            document.querySelector('.desc-info-text') ||
            document.querySelector('.basic-desc-info') ||
            document.querySelector('#v_desc .info') ||
            document.querySelector('.media-desc');
        const descText = domDescEl?.textContent?.trim() || undefined;

        const upEl =
            document.querySelector('.up-name') ||
            document.querySelector('.name .username');
        const upName = upEl?.textContent?.trim();
        const summary = upName ? `UP: ${upName} | ${descText || ''}` : descText;

        return {
            mainTitle: title || videoId,
            episodeTitle: '',
            fullTitle: title || videoId,
            videoId,
            showId: fallbackShowId,
            showSummary: summary,
        };
    }

    getVideoElement(): HTMLVideoElement | null {
        return (
            (document.querySelector('.bpx-player-video-wrap video') as HTMLVideoElement | null) ||
            (document.querySelector('#bilibili-player video') as HTMLVideoElement | null) ||
            (document.querySelector('.bilibili-player-video video') as HTMLVideoElement | null) ||
            document.querySelector('video')
        );
    }

    getPlayerContainer(): HTMLElement | null {
        const video = this.getVideoElement();
        const candidate =
            (document.querySelector('.bpx-player-video-area') as HTMLElement | null) ||
            (document.querySelector('.bpx-player-container') as HTMLElement | null) ||
            (document.querySelector('#bilibili-player') as HTMLElement | null) ||
            (document.querySelector('.bilibili-player-video') as HTMLElement | null) ||
            (video?.parentElement as HTMLElement | null) ||
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
            '.bpx-player-subtitle-wrap, .bpx-player-subtitle-panel, .bilibili-player-video-subtitle',
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
                        'Bilibili-AI-Sub',
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
                    ? mainTitle ? `${mainTitle} - ${episodeTitle}` : episodeTitle
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
                    'Bilibili-AI-Sub',
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
        return BilibiliSubtitleParser.parse(rawText);
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
                            'zh-CN';

                        this.logger.info(
                            'Bilibili-AI-Sub',
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
                        'Bilibili-AI-Sub',
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
            'Bilibili-AI-Sub',
            'Posting REQUEST_SUBTITLE_RETRY to Bilibili injected adapter.',
        );
        window.postMessage(
            { type: NCW_MESSAGE_TYPES.REQUEST_SUBTITLE_RETRY },
            '*',
        );
    }

    requestMetadata(movieId?: string): void {
        this.logger.info(
            'Bilibili-AI-Sub',
            `Posting REQUEST_METADATA (${movieId || 'active'}) to Bilibili injected adapter.`,
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
        if (/^BV[a-zA-Z0-9]+$/i.test(title)) return false;
        if (/^av\d+$/i.test(title)) return false;
        if (title.startsWith('哔哩哔哩')) return false;
        return true;
    }

    private async fetchVideoMetadataDirect(
        bvid: string,
        videoId: string,
    ): Promise<VideoMetadata | null> {
        try {
            const resp = await fetch(
                `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
            );
            if (!resp.ok) return null;
            const json = (await resp.json()) as {
                code?: number;
                data?: {
                    title?: string;
                    desc?: string;
                    owner?: { name?: string };
                    pages?: Array<{ page: number; part: string }>;
                };
            };
            if (json.code !== 0 || !json.data) return null;

            const data = json.data;
            const mainTitle = data.title || '';
            const desc = data.desc || '';
            const ownerName = data.owner?.name;
            const showSummary = ownerName ? `UP: ${ownerName} | ${desc}` : desc;

            const pMatch = videoId.match(/_p(\d+)$/);
            const currentPageNum = pMatch ? parseInt(pMatch[1], 10) : 1;
            let episodeTitle = '';

            if (Array.isArray(data.pages) && data.pages.length > 0) {
                const curPage = data.pages.find(
                    (p) => p.page === currentPageNum,
                );
                if (curPage && curPage.part) {
                    episodeTitle = curPage.part;
                } else if (currentPageNum > 1) {
                    episodeTitle = `P${currentPageNum}`;
                }
            }

            const fullTitle = episodeTitle
                ? `${mainTitle} - ${episodeTitle}`
                : mainTitle;

            const meta: VideoMetadata = {
                mainTitle,
                episodeTitle,
                fullTitle,
                videoId: videoId || `${bvid}_p${currentPageNum}`,
                showId: bvid,
                showSummary,
                episodeNum: currentPageNum,
            };

            this.cachedMetadata = meta;
            if (typeof document !== 'undefined' && document.documentElement) {
                document.documentElement.dataset.ncwMainTitle = mainTitle;
                document.documentElement.dataset.ncwEpisodeTitle = episodeTitle;
                document.documentElement.dataset.ncwShowId = bvid;
                if (showSummary) {
                    document.documentElement.dataset.ncwShowSummary = showSummary;
                }
            }

            return meta;
        } catch {
            return null;
        }
    }

    private async fetchBangumiMetadataDirect(
        targetId: string,
        videoId: string,
    ): Promise<VideoMetadata | null> {
        try {
            let url = '';
            if (targetId.startsWith('ep')) {
                const epId = targetId.replace(/^ep/i, '');
                url = `https://api.bilibili.com/pgc/view/web/season?ep_id=${encodeURIComponent(epId)}`;
            } else if (targetId.startsWith('ss')) {
                const ssId = targetId.replace(/^ss/i, '');
                url = `https://api.bilibili.com/pgc/view/web/season?season_id=${encodeURIComponent(ssId)}`;
            }
            if (!url) return null;
            const resp = await fetch(url);
            if (!resp.ok) return null;
            const json = (await resp.json()) as {
                code?: number;
                result?: {
                    season_id?: number;
                    title?: string;
                    evaluate?: string;
                    episodes?: Array<{
                        id: number;
                        title: string;
                        long_title: string;
                    }>;
                };
            };
            if (json.code !== 0 || !json.result) return null;

            const result = json.result;
            const mainTitle = result.title || '';
            const showSummary = result.evaluate || '';
            let episodeTitle = '';
            let episodeNum: number | undefined;

            if (Array.isArray(result.episodes)) {
                const curEp = result.episodes.find(
                    (e) => `ep${e.id}` === targetId || `ep${e.id}` === videoId,
                );
                if (curEp) {
                    episodeTitle = curEp.long_title || curEp.title || '';
                    const parsed = parseInt(curEp.title, 10);
                    if (!isNaN(parsed)) episodeNum = parsed;
                }
            }

            const fullTitle = episodeTitle
                ? `${mainTitle} ${episodeTitle}`
                : mainTitle;

            const meta: VideoMetadata = {
                mainTitle,
                episodeTitle,
                fullTitle,
                videoId: videoId || targetId,
                showId: result.season_id ? `ss${result.season_id}` : targetId,
                showSummary,
                episodeNum,
            };

            this.cachedMetadata = meta;
            if (typeof document !== 'undefined' && document.documentElement) {
                document.documentElement.dataset.ncwMainTitle = mainTitle;
                document.documentElement.dataset.ncwEpisodeTitle = episodeTitle;
                document.documentElement.dataset.ncwShowId = meta.showId;
                if (showSummary) {
                    document.documentElement.dataset.ncwShowSummary = showSummary;
                }
            }

            return meta;
        } catch {
            return null;
        }
    }

    async queryMetadata(
        movieId?: string,
    ): Promise<VideoMetadata | null | undefined> {
        const targetVid = movieId || this.extractVideoId() || '';

        // 1. Return cached metadata if already genuine
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
            !ds.ncwMainTitle.startsWith('BV')
        ) {
            const meta = this.getVideoInfo();
            if (this.isGenuineMetadata(meta, targetVid)) {
                this.cachedMetadata = meta;
                return meta;
            }
        }

        // 3. Proactively trigger direct fetch from content script
        const bvid =
            this.extractBvid(targetVid) ||
            this.extractBvid(window.location.href);
        const directFetchPromise = bvid
            ? this.fetchVideoMetadataDirect(bvid, targetVid)
            : targetVid.match(/(ep\d+|ss\d+)/i)
              ? this.fetchBangumiMetadataDirect(
                    targetVid.match(/(ep\d+|ss\d+)/i)![1],
                    targetVid,
                )
              : Promise.resolve(null);

        // 4. Query injected adapter via tri-state message
        const queryId = `qm_bili_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const effectiveMid = movieId ? String(movieId) : undefined;

        return new Promise<VideoMetadata | null | undefined>((resolve) => {
            let resolved = false;
            let timer: ReturnType<typeof setTimeout> | null = null;

            const finish = async (result: VideoMetadata | null | undefined) => {
                if (resolved) return;
                resolved = true;
                if (timer) clearTimeout(timer);
                window.removeEventListener('message', handler);

                if (result && this.isGenuineMetadata(result, targetVid)) {
                    this.cachedMetadata = result;
                    resolve(result);
                    return;
                }

                // If result was undefined or not genuine yet, check direct fetch
                const directMeta = await directFetchPromise;
                if (directMeta && this.isGenuineMetadata(directMeta, targetVid)) {
                    this.cachedMetadata = directMeta;
                    resolve(directMeta);
                    return;
                }

                if (
                    this.cachedMetadata &&
                    this.isGenuineMetadata(this.cachedMetadata, targetVid)
                ) {
                    resolve(this.cachedMetadata);
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
        const queryId = `qs_bili_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
            delete document.documentElement.dataset.ncwShowSummary;
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
