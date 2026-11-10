import {
    IInjectedAdapter,
    InjectedIncomingEvent,
    InjectedSubtitleRawDataPayload,
    InjectedMetadataLoadedPayload,
    InjectedEpisodeChangedPayload,
    InjectedUrlChangedPayload,
} from '../../../domain/IInjectedAdapter';
import { VideoMetadata } from '../../../../content/domain/adapters/IStreamingAdapter';
import {
    STREAMING_PLATFORMS,
    StreamingPlatformId,
} from '@shared/domain/constants/StreamingPlatforms';
import { NCW_MESSAGE_TYPES } from '@shared/domain/constants/MessageTypes';
import { PlaybackDatasetHelper } from '@shared/domain/entities/PlaybackDatasetPayload';
import { Logger } from '@shared/utils/logger';
import { BilibiliTrackRegistry } from './BilibiliTrackRegistry';
import {
    BilibiliSubtitleItem,
    BilibiliCachedSubtitle,
    BilibiliCachedMetadata,
    BilibiliBangumiMetadata,
} from './BilibiliTypes';

export class BilibiliInjectedAdapter implements IInjectedAdapter {
    readonly platformId: StreamingPlatformId = STREAMING_PLATFORMS.BILIBILI;
    private readonly logger: Logger = new Logger('BilibiliInjectedAdapter');

    private readonly trackRegistry: BilibiliTrackRegistry;
    private readonly cachedDetails = new Map<string, BilibiliCachedMetadata>();
    private readonly cachedBangumi = new Map<string, BilibiliBangumiMetadata>();
    private readonly aidToBvid = new Map<string, string>();
    private readonly cidToBvid = new Map<string, string>();
    private readonly pendingFetches = new Set<string>();

    private lastReportedUrl = '';
    private lastObservedVideoId: string | null = null;
    private lastEmittedSignature = '';
    private lastReportedTime: number | null = null;
    private lastTimeUpdateSync = 0;

    private pollIntervalId: ReturnType<typeof setInterval> | null = null;

    // Lifecycle cleanups
    private unhookNetwork?: () => void;
    private unhookNavigation?: () => void;
    private cleanupMessageListener?: () => void;
    private unhookPlayerEvents?: () => void;

    constructor() {
        this.trackRegistry = new BilibiliTrackRegistry();
    }

    matches(url: string): boolean {
        return /bilibili\.com/i.test(url);
    }

    initialize(): void {
        if (window.__NCW_BILIBILI_INTERCEPTOR_INITIALIZED__) return;
        window.__NCW_BILIBILI_INTERCEPTOR_INITIALIZED__ = true;

        this.lastReportedUrl = window.location.href;
        this.lastObservedVideoId = this.extractVideoId(window.location.href);

        this.logger.info(
            'Bilibili-AI-Sub',
            'Initializing Bilibili Injected Adapter in MAIN world.',
        );

        this.setupNetworkInterceptor();
        this.setupNavigationMonitoring();
        this.setupPlayerEventHooks();
        this.setupMessageListener();

        // Background state sync polling
        this.pollIntervalId = setInterval(() => {
            this.checkUrlAndVideoChange();
            this.syncPlaybackState();
        }, 500);

        // Trigger proactive fetch immediately
        const initialBvid = this.extractBvid(window.location.href);
        if (initialBvid) {
            this.fetchVideoDetail(initialBvid).catch(() => {});
        }
        const bangumiMatch = window.location.href.match(
            /\/bangumi\/play\/(ep\d+|ss\d+)/i,
        );
        if (bangumiMatch) {
            this.fetchBangumiDetail(bangumiMatch[1]).catch(() => {});
        }

        // Initial warmup
        setTimeout(() => {
            this.emitMetadataForCurrentVideo();
            this.syncPlaybackState();
        }, 100);
    }

    destroy(): void {
        if (this.pollIntervalId) {
            clearInterval(this.pollIntervalId);
            this.pollIntervalId = null;
        }

        this.cleanupMessageListener?.();
        this.unhookNavigation?.();
        this.unhookPlayerEvents?.();
        this.unhookNetwork?.();

        this.trackRegistry.clear();
        this.cachedDetails.clear();
        this.cachedBangumi.clear();
        this.aidToBvid.clear();
        this.cidToBvid.clear();
        this.pendingFetches.clear();
        PlaybackDatasetHelper.clear();

        window.__NCW_BILIBILI_INTERCEPTOR_INITIALIZED__ = false;
        this.logger.info(
            'Bilibili-AI-Sub',
            'BilibiliInjectedAdapter destroyed and cleaned up.',
        );
    }

    // --------------------------------------------------------------------------
    // 1. Helpers & Extraction
    // --------------------------------------------------------------------------

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
                const epId = window.__INITIAL_STATE__?.epInfo?.id;
                if (epId) {
                    return `ep${epId}`;
                }
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
        return null;
    }

    extractBvid(url: string = window.location.href): string | null {
        if (!url) return null;
        const match = url.match(/(?:video\/|bvid=|^)(BV[a-zA-Z0-9]+)/i);
        return match ? match[1] : null;
    }

    private getCurrentVideoId(): string | null {
        return (
            this.lastObservedVideoId ||
            this.extractVideoId(window.location.href)
        );
    }

    private getVideoElement(): HTMLVideoElement | null {
        return (
            (document.querySelector('.bpx-player-video-wrap video') as HTMLVideoElement | null) ||
            (document.querySelector('#bilibili-player video') as HTMLVideoElement | null) ||
            (document.querySelector('.bilibili-player-video video') as HTMLVideoElement | null) ||
            document.querySelector('video')
        );
    }

    // --------------------------------------------------------------------------
    // 2. Network Interceptor (Fetch & XHR) with Full Teardown
    // --------------------------------------------------------------------------

    private extractAndRecordIdsFromUrl(rawUrl: string): void {
        if (!rawUrl || (!rawUrl.includes('?') && !rawUrl.includes('&'))) return;
        try {
            const urlObj = new URL(rawUrl, window.location.origin);
            const aid =
                urlObj.searchParams.get('aid') ||
                urlObj.searchParams.get('avid');
            const bvid = urlObj.searchParams.get('bvid');
            const cid = urlObj.searchParams.get('cid');
            if (aid || bvid || cid) {
                this.recordIdMapping({
                    aid: aid || undefined,
                    bvid: bvid || undefined,
                    cid: cid || undefined,
                });
                if (bvid && !this.cachedDetails.has(bvid)) {
                    this.fetchVideoDetail(bvid).catch(() => {});
                }
            }
        } catch {
            // Safe boundary
        }
    }

    private recordIdMapping(ids: {
        aid?: number | string;
        cid?: number | string;
        bvid?: string;
        epId?: string;
        seasonId?: string;
        pages?: Array<{ cid: number; page: number; part: string }>;
    }): void {
        const { aid, cid, bvid, epId, pages } = ids;

        if (bvid && aid) {
            this.aidToBvid.set(String(aid), bvid);
        }
        if (bvid && cid) {
            this.cidToBvid.set(String(cid), bvid);
            const currentVideoId = this.getCurrentVideoId();
            if (currentVideoId) {
                this.trackRegistry.bindCidToVideoId(cid, currentVideoId);
            }
        }
        if (epId && cid) {
            this.trackRegistry.bindCidToVideoId(cid, epId);
        }
        if (pages && Array.isArray(pages)) {
            for (const p of pages) {
                if (p.cid) {
                    const pageVid = bvid
                        ? p.page > 1
                            ? `${bvid}_p${p.page}`
                            : `${bvid}_p1`
                        : '';
                    if (pageVid) {
                        this.trackRegistry.bindCidToVideoId(p.cid, pageVid);
                    }
                    if (bvid) {
                        this.cidToBvid.set(String(p.cid), bvid);
                    }
                }
            }
        }
    }

    private setupNetworkInterceptor(): void {
        const originalFetch = window.fetch;
        const origOpen = XMLHttpRequest.prototype.open as (
            ...a: unknown[]
        ) => void;
        const origSend = XMLHttpRequest.prototype.send as (
            ...a: unknown[]
        ) => void;
        const xhrUrlMap = new WeakMap<XMLHttpRequest, string>();

        const processInterceptedResponse = (rawUrl: string, text: string) => {
            try {
                this.extractAndRecordIdsFromUrl(rawUrl);
                const lowerUrl = rawUrl.toLowerCase();

                // 1. View Detail & Metadata API
                if (
                    lowerUrl.includes('/x/web-interface/wbi/view/detail') ||
                    lowerUrl.includes('/x/web-interface/view/detail') ||
                    lowerUrl.includes('/x/web-interface/view')
                ) {
                    this.handleViewDetailResponse(rawUrl, text);
                }
                // 2. Bangumi PGC Metadata API
                else if (
                    lowerUrl.includes('/pgc/view/web/season') ||
                    lowerUrl.includes('/pgc/player/web/v2')
                ) {
                    this.handlePgcSeasonResponse(rawUrl, text);
                }
                // 3. Player v2 / wbi v2 API
                else if (
                    lowerUrl.includes('/x/player/wbi/v2') ||
                    lowerUrl.includes('/x/player/v2')
                ) {
                    this.handlePlayerInfoResponse(rawUrl, text);
                }
                // 4. BCC JSON Subtitle Payload
                else if (
                    lowerUrl.includes('/bfs/subtitle/') ||
                    lowerUrl.includes('/bfs/ai_subtitle/') ||
                    ((lowerUrl.includes('subtitle') ||
                        lowerUrl.includes('ai_subtitle')) &&
                        lowerUrl.includes('.json'))
                ) {
                    this.handleBccSubtitleResponse(rawUrl, text);
                }
            } catch (err) {
                this.logger.warn(
                    'Bilibili-AI-Sub',
                    'Error processing intercepted response:',
                    err,
                );
            }
        };

        window.fetch = async (...args: Parameters<typeof originalFetch>) => {
            const response = await (
                originalFetch as (...a: unknown[]) => Promise<Response>
            ).apply(window, args);
            try {
                const rawUrl =
                    typeof args[0] === 'string'
                        ? args[0]
                        : (args[0] as Request)?.url || response.url || '';
                this.extractAndRecordIdsFromUrl(rawUrl);
                const lowerUrl = rawUrl.toLowerCase();

                if (
                    lowerUrl.includes('/x/web-interface/wbi/view/detail') ||
                    lowerUrl.includes('/x/web-interface/view/detail') ||
                    lowerUrl.includes('/x/web-interface/view') ||
                    lowerUrl.includes('/pgc/view/web/season') ||
                    lowerUrl.includes('/pgc/player/web/v2') ||
                    lowerUrl.includes('/x/player/wbi/v2') ||
                    lowerUrl.includes('/x/player/v2') ||
                    lowerUrl.includes('/bfs/subtitle/') ||
                    lowerUrl.includes('/bfs/ai_subtitle/') ||
                    ((lowerUrl.includes('subtitle') ||
                        lowerUrl.includes('ai_subtitle')) &&
                        lowerUrl.includes('.json'))
                ) {
                    const clone = response.clone();
                    clone
                        .text()
                        .then((text: string) => {
                            processInterceptedResponse(rawUrl, text);
                        })
                        .catch(() => {});
                }
            } catch {
                // Ignore interception errors to protect web page playback
            }
            return response;
        };

        XMLHttpRequest.prototype.open = function (
            this: XMLHttpRequest,
            ...args: [
                method: string,
                url: string | URL,
                async?: boolean,
                username?: string | null,
                password?: string | null,
            ]
        ) {
            const destUrl =
                typeof args[1] === 'string'
                    ? args[1]
                    : args[1] instanceof URL
                      ? args[1].href
                      : String(args[1] || '');
            xhrUrlMap.set(this, destUrl);
            return origOpen.apply(this, args);
        };

        const onXhrLoad = (xhr: XMLHttpRequest) => {
            try {
                const rawUrl = xhrUrlMap.get(xhr) || xhr.responseURL || '';
                this.extractAndRecordIdsFromUrl(rawUrl);
                const lowerUrl = rawUrl.toLowerCase();

                if (
                    lowerUrl.includes('/x/web-interface/wbi/view/detail') ||
                    lowerUrl.includes('/x/web-interface/view/detail') ||
                    lowerUrl.includes('/x/web-interface/view') ||
                    lowerUrl.includes('/pgc/view/web/season') ||
                    lowerUrl.includes('/pgc/player/web/v2') ||
                    lowerUrl.includes('/x/player/wbi/v2') ||
                    lowerUrl.includes('/x/player/v2') ||
                    lowerUrl.includes('/bfs/subtitle/') ||
                    lowerUrl.includes('/bfs/ai_subtitle/') ||
                    ((lowerUrl.includes('subtitle') ||
                        lowerUrl.includes('ai_subtitle')) &&
                        lowerUrl.includes('.json'))
                ) {
                    const text =
                        typeof xhr.response === 'string'
                            ? xhr.response
                            : JSON.stringify(xhr.response);
                    processInterceptedResponse(rawUrl, text);
                }
            } catch {
                // Safe boundary
            }
        };

        XMLHttpRequest.prototype.send = function (
            this: XMLHttpRequest,
            ...args: [body?: Document | XMLHttpRequestBodyInit | null]
        ) {
            this.addEventListener('load', () => onXhrLoad(this), { once: true });
            return origSend.apply(this, args);
        };

        this.unhookNetwork = () => {
            window.fetch = originalFetch;
            XMLHttpRequest.prototype.open = origOpen as typeof XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.send = origSend as typeof XMLHttpRequest.prototype.send;
        };
    }

    private handleViewDetailResponse(url: string, text: string): void {
        try {
            const json = JSON.parse(text) as {
                code?: number;
                data?: {
                    View?: {
                        bvid?: string;
                        aid?: number;
                        cid?: number;
                        title?: string;
                        desc?: string;
                        owner?: { name?: string };
                        pages?: Array<{
                            cid: number;
                            page: number;
                            part: string;
                            duration?: number;
                        }>;
                        subtitle?: {
                            list?: BilibiliSubtitleItem[];
                            subtitles?: BilibiliSubtitleItem[];
                        };
                    };
                    bvid?: string;
                    aid?: number;
                    cid?: number;
                    title?: string;
                    desc?: string;
                    owner?: { name?: string };
                    pages?: Array<{
                        cid: number;
                        page: number;
                        part: string;
                        duration?: number;
                    }>;
                    subtitle?: {
                        list?: BilibiliSubtitleItem[];
                        subtitles?: BilibiliSubtitleItem[];
                    };
                };
            };

            if (json.code !== 0 || !json.data) return;

            const view = json.data.View || json.data;
            const bvid =
                view.bvid ||
                this.extractBvid(url) ||
                this.extractBvid(window.location.href);
            if (!bvid) return;

            const aid = view.aid;
            const title = view.title || '';
            const desc = view.desc || '';
            const ownerName = view.owner?.name;
            const pages = view.pages || [];
            const summary = ownerName ? `UP: ${ownerName} | ${desc}` : desc;

            this.recordIdMapping({ aid, bvid, pages });

            const subtitleList =
                view.subtitle?.list || view.subtitle?.subtitles || [];

            this.cachedDetails.set(bvid, {
                bvid,
                aid,
                title,
                desc: summary,
                ownerName,
                pages,
                subtitles: subtitleList,
            });

            this.logger.info(
                'Bilibili-AI-Sub',
                `Parsed view/detail for ${bvid}: "${title}" (${pages.length} pages, ${subtitleList.length} subtitles)`,
            );

            // Bind pages & subtitles
            const currentVideoId = this.getCurrentVideoId();
            if (subtitleList.length > 0) {
                const effectiveVid = currentVideoId || `${bvid}_p1`;
                this.trackRegistry.registerAvailableTracks(
                    effectiveVid,
                    subtitleList,
                );
                const preferred =
                    this.trackRegistry.getPreferredTrack(effectiveVid);
                if (preferred && preferred.subtitle_url) {
                    this.fetchAndEmitSubtitle(
                        effectiveVid,
                        preferred,
                    ).catch(() => {});
                }
            }

            // Emit metadata now that rich title & synopsis are present
            this.emitMetadataForCurrentVideo();
        } catch (e) {
            this.logger.warn(
                'Bilibili-AI-Sub',
                'Failed to parse view detail response:',
                e,
            );
        }
    }

    private handlePgcSeasonResponse(_url: string, text: string): void {
        try {
            const json = JSON.parse(text) as {
                code?: number;
                result?: {
                    season_id?: number;
                    title?: string;
                    evaluate?: string;
                    episodes?: Array<{
                        id: number;
                        aid: number;
                        cid: number;
                        bvid: string;
                        title: string;
                        long_title: string;
                    }>;
                };
            };

            if (json.code !== 0 || !json.result) return;
            const res = json.result;
            const seasonId = res.season_id ? `ss${res.season_id}` : '';
            const title = res.title || '';
            const evaluate = res.evaluate || '';
            const episodes = res.episodes || [];

            if (seasonId) {
                this.cachedBangumi.set(seasonId, {
                    seasonId,
                    title,
                    evaluate,
                    episodes,
                });
            }

            for (const ep of episodes) {
                if (ep.id) {
                    const epKey = `ep${ep.id}`;
                    this.recordIdMapping({
                        aid: ep.aid,
                        cid: ep.cid,
                        bvid: ep.bvid,
                        epId: epKey,
                        seasonId,
                    });
                    if (seasonId) {
                        this.cachedBangumi.set(epKey, {
                            seasonId,
                            title,
                            evaluate,
                            episodes,
                        });
                    }
                }
            }

            this.logger.info(
                'Bilibili-AI-Sub',
                `Parsed PGC season: "${title}" (${episodes.length} episodes)`,
            );

            this.emitMetadataForCurrentVideo();
        } catch (e) {
            this.logger.warn(
                'Bilibili-AI-Sub',
                'Failed to parse PGC season response:',
                e,
            );
        }
    }

    private async fetchVideoDetail(bvid: string): Promise<void> {
        if (!bvid || this.pendingFetches.has(bvid)) return;
        this.pendingFetches.add(bvid);
        try {
            const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
            const resp = await window.fetch(url, { credentials: 'include' });
            if (!resp.ok) return;
            const text = await resp.text();
            this.handleViewDetailResponse(url, text);
        } catch (err) {
            this.logger.warn(
                'Bilibili-AI-Sub',
                `Proactive fetch failed for ${bvid}:`,
                err,
            );
        } finally {
            this.pendingFetches.delete(bvid);
        }
    }

    private async fetchBangumiDetail(targetId: string): Promise<void> {
        if (!targetId || this.pendingFetches.has(targetId)) return;
        this.pendingFetches.add(targetId);
        try {
            let url = '';
            if (targetId.startsWith('ep')) {
                const epId = targetId.replace(/^ep/i, '');
                url = `https://api.bilibili.com/pgc/view/web/season?ep_id=${encodeURIComponent(epId)}`;
            } else if (targetId.startsWith('ss')) {
                const ssId = targetId.replace(/^ss/i, '');
                url = `https://api.bilibili.com/pgc/view/web/season?season_id=${encodeURIComponent(ssId)}`;
            }
            if (!url) return;
            const resp = await window.fetch(url, { credentials: 'include' });
            if (!resp.ok) return;
            const text = await resp.text();
            this.handlePgcSeasonResponse(url, text);
        } catch (err) {
            this.logger.warn(
                'Bilibili-AI-Sub',
                `Proactive bangumi fetch failed for ${targetId}:`,
                err,
            );
        } finally {
            this.pendingFetches.delete(targetId);
        }
    }

    private handlePlayerInfoResponse(_url: string, text: string): void {
        try {
            const json = JSON.parse(text) as {
                code?: number;
                data?: {
                    aid?: number;
                    bvid?: string;
                    cid?: number;
                    subtitle?: {
                        subtitles?: BilibiliSubtitleItem[];
                        list?: BilibiliSubtitleItem[];
                    };
                };
            };

            if (json.code !== 0 || !json.data) return;

            const { aid, bvid, cid, subtitle } = json.data;
            this.recordIdMapping({ aid, bvid, cid });

            const currentVideoId = this.getCurrentVideoId();
            const effectiveVideoId =
                currentVideoId || (bvid ? `${bvid}_p1` : null);

            if (!effectiveVideoId) return;

            if (cid) {
                this.trackRegistry.bindCidToVideoId(cid, effectiveVideoId);
            }

            const subtitles = subtitle?.subtitles || subtitle?.list;
            if (Array.isArray(subtitles) && subtitles.length > 0) {
                this.trackRegistry.registerAvailableTracks(
                    effectiveVideoId,
                    subtitles,
                );

                // Auto-fetch preferred subtitle if not yet cached
                const preferred =
                    this.trackRegistry.getPreferredTrack(effectiveVideoId);
                if (preferred && preferred.subtitle_url) {
                    this.fetchAndEmitSubtitle(
                        effectiveVideoId,
                        preferred,
                    ).catch(() => {});
                }
            }
        } catch (e) {
            this.logger.warn(
                'Bilibili-AI-Sub',
                'Failed to parse player info response:',
                e,
            );
        }
    }

    private handleBccSubtitleResponse(url: string, text: string): void {
        if (!BilibiliTrackRegistry.isBccJson(text)) return;

        const currentVideoId = this.getCurrentVideoId();
        if (!currentVideoId) return;

        let detectedLan = 'zh-CN';
        try {
            const parsed = JSON.parse(text) as { lang?: string };
            if (parsed.lang) {
                detectedLan = parsed.lang;
            }
        } catch {}

        const cached: BilibiliCachedSubtitle = {
            videoId: currentVideoId,
            lan: detectedLan,
            lanDoc: detectedLan,
            isMachine: false,
            rawText: text,
            url,
            timestamp: Date.now(),
        };

        this.trackRegistry.cacheSubtitle(cached);
        this.emitSubtitleData(url, text, detectedLan, currentVideoId);
    }

    private async fetchAndEmitSubtitle(
        videoId: string,
        trackItem: BilibiliSubtitleItem,
    ): Promise<void> {
        let fullUrl = trackItem.subtitle_url;
        if (fullUrl.startsWith('//')) {
            fullUrl = `https:${fullUrl}`;
        }

        try {
            const resp = await window.fetch(fullUrl);
            if (!resp.ok) return;
            const text = await resp.text();
            if (!BilibiliTrackRegistry.isBccJson(text)) return;

            const cached: BilibiliCachedSubtitle = {
                videoId,
                lan: trackItem.lan || 'zh-CN',
                lanDoc: trackItem.lan_doc || '中文',
                isMachine: trackItem.is_machine === 1,
                rawText: text,
                url: fullUrl,
                timestamp: Date.now(),
            };

            this.trackRegistry.cacheSubtitle(cached);
            this.emitSubtitleData(fullUrl, text, trackItem.lan || 'zh-CN', videoId);
        } catch (err) {
            this.logger.warn(
                'Bilibili-AI-Sub',
                `Failed fetching subtitle from ${fullUrl}:`,
                err,
            );
        }
    }

    private emitSubtitleData(
        url: string,
        text: string,
        lang: string,
        videoId: string,
    ): void {
        const signature = `${videoId}_${lang}_${text.length}_${text.slice(0, 40)}`;
        if (signature === this.lastEmittedSignature) {
            return;
        }
        this.lastEmittedSignature = signature;

        const payload: InjectedSubtitleRawDataPayload = {
            type: NCW_MESSAGE_TYPES.SUBTITLE_RAW_DATA,
            movieId: videoId,
            url,
            rawText: text,
            bcp47: lang,
            timestamp: Date.now(),
        };

        this.logger.info(
            'Bilibili-AI-Sub',
            `Emitting SUBTITLE_RAW_DATA for ${videoId} [${lang}] (${text.length} chars)`,
        );

        window.postMessage(payload, '*');
    }

    // --------------------------------------------------------------------------
    // 3. Navigation & Lifecycle Events
    // --------------------------------------------------------------------------

    private setupNavigationMonitoring(): void {
        const onLocationMayChange = () => {
            setTimeout(() => this.checkUrlAndVideoChange(), 50);
        };

        window.addEventListener('popstate', onLocationMayChange);

        const originalPush = history.pushState;
        history.pushState = function (...args) {
            originalPush.apply(this, args);
            onLocationMayChange();
        };

        const originalReplace = history.replaceState;
        history.replaceState = function (...args) {
            originalReplace.apply(this, args);
            onLocationMayChange();
        };

        this.unhookNavigation = () => {
            window.removeEventListener('popstate', onLocationMayChange);
            history.pushState = originalPush;
            history.replaceState = originalReplace;
        };
    }

    private checkUrlAndVideoChange(): void {
        const currentUrl = window.location.href;
        const currentVideoId = this.extractVideoId(currentUrl);

        if (currentUrl !== this.lastReportedUrl) {
            this.lastReportedUrl = currentUrl;
            const urlPayload: InjectedUrlChangedPayload = {
                type: NCW_MESSAGE_TYPES.URL_CHANGED,
                url: currentUrl,
            };
            window.postMessage(urlPayload, '*');
        }

        if (currentVideoId && currentVideoId !== this.lastObservedVideoId) {
            this.logger.info(
                'Bilibili-AI-Sub',
                `Detected episode change: ${this.lastObservedVideoId || 'none'} -> ${currentVideoId}`,
            );
            this.lastObservedVideoId = currentVideoId;
            this.lastEmittedSignature = '';

            const epPayload: InjectedEpisodeChangedPayload = {
                type: NCW_MESSAGE_TYPES.EPISODE_CHANGED,
                movieId: currentVideoId,
            };
            window.postMessage(epPayload, '*');

            this.emitMetadataForCurrentVideo();

            const bvid = this.extractBvid(currentUrl);
            if (bvid && !this.cachedDetails.has(bvid)) {
                this.fetchVideoDetail(bvid).catch(() => {});
            }
            const bgMatch = currentUrl.match(/\/bangumi\/play\/(ep\d+|ss\d+)/i);
            if (bgMatch && !this.cachedBangumi.has(bgMatch[1])) {
                this.fetchBangumiDetail(bgMatch[1]).catch(() => {});
            }

            // Check if preferred track is already available for this video
            const preferred = this.trackRegistry.getPreferredTrack(currentVideoId);
            if (preferred && preferred.subtitle_url) {
                this.fetchAndEmitSubtitle(currentVideoId, preferred).catch(() => {});
            }
        }
    }

    // --------------------------------------------------------------------------
    // 4. Metadata Extraction
    // --------------------------------------------------------------------------

    private emitMetadataForCurrentVideo(): void {
        const videoId = this.getCurrentVideoId();
        if (!videoId) return;

        const metadata = this.extractMetadata(videoId);
        if (!metadata) return;

        const sig = `${videoId}_${metadata.mainTitle}_${metadata.episodeTitle}_${metadata.showSummary}`;
        if (sig === this.lastEmittedSignature) return;
        this.lastEmittedSignature = sig;

        // Sync to dataset
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.dataset.ncwMainTitle = metadata.mainTitle;
            document.documentElement.dataset.ncwEpisodeTitle = metadata.episodeTitle;
            document.documentElement.dataset.ncwShowId = metadata.showId;
            if (metadata.showSummary) {
                document.documentElement.dataset.ncwShowSummary = metadata.showSummary;
            }
        }

        const payload: InjectedMetadataLoadedPayload = {
            type: NCW_MESSAGE_TYPES.METADATA_LOADED,
            movieId: videoId,
            showId: metadata.showId || videoId,
            showTitle: metadata.mainTitle,
            showSynopsis: metadata.showSummary,
            currentEpisode: {
                episodeId: metadata.videoId,
                episodeTitle: metadata.episodeTitle,
                episodeSynopsis: metadata.episodeSummary,
                episodeSeq: metadata.episodeNum,
            },
        };

        window.postMessage(payload, '*');
    }

    private extractMetadata(videoId: string): VideoMetadata | null {
        const bvid =
            this.extractBvid(videoId) ||
            this.extractBvid(window.location.href);

        // 1. Authoritative cache from view / detail API
        if (bvid && this.cachedDetails.has(bvid)) {
            const detail = this.cachedDetails.get(bvid)!;
            const mainTitle = detail.title || '';
            let episodeTitle = '';

            const pMatch = videoId.match(/_p(\d+)$/);
            const currentPageNum = pMatch ? parseInt(pMatch[1], 10) : 1;

            if (Array.isArray(detail.pages) && detail.pages.length > 0) {
                const curPage = detail.pages.find((p) => p.page === currentPageNum);
                if (curPage && curPage.part) {
                    episodeTitle = curPage.part;
                } else if (currentPageNum > 1) {
                    episodeTitle = `P${currentPageNum}`;
                }
            }

            const fullTitle = episodeTitle
                ? `${mainTitle} - ${episodeTitle}`
                : mainTitle;

            return {
                mainTitle,
                episodeTitle,
                fullTitle,
                videoId,
                showId: bvid,
                showSummary: detail.desc,
                episodeNum: currentPageNum,
            };
        }

        // 2. Bangumi cached metadata
        if (this.cachedBangumi.has(videoId)) {
            const bangumi = this.cachedBangumi.get(videoId)!;
            const mainTitle = bangumi.title || '';
            let episodeTitle = '';
            let episodeSeq: number | undefined;

            if (Array.isArray(bangumi.episodes)) {
                const curEp = bangumi.episodes.find(
                    (e) => `ep${e.id}` === videoId || e.bvid === bvid,
                );
                if (curEp) {
                    episodeTitle = curEp.long_title || curEp.title || '';
                    const parsedNum = parseInt(curEp.title, 10);
                    if (!isNaN(parsedNum)) episodeSeq = parsedNum;
                }
            }

            const fullTitle = episodeTitle
                ? `${mainTitle} ${episodeTitle}`
                : mainTitle;

            return {
                mainTitle,
                episodeTitle,
                fullTitle,
                videoId,
                showId: bangumi.seasonId || videoId,
                showSummary: bangumi.evaluate,
                episodeNum: episodeSeq,
            };
        }

        // 3. Fallback: window.__INITIAL_STATE__
        const initState = window.__INITIAL_STATE__;
        if (initState?.mediaInfo) {
            const media = initState.mediaInfo;
            const mainTitle = media.title || '';
            const epInfo = initState.epInfo;
            const epTitle = epInfo?.long_title || epInfo?.title || '';
            const fullTitle = epTitle
                ? mainTitle ? `${mainTitle} ${epTitle}` : epTitle
                : mainTitle;

            return {
                mainTitle,
                episodeTitle: epTitle,
                fullTitle,
                videoId,
                showId: media.season_id ? `ss${media.season_id}` : videoId,
                showSummary: media.evaluate,
            };
        }

        if (initState?.videoData) {
            const vData = initState.videoData;
            const mainTitle = vData.title || '';
            let episodeTitle = '';

            const pMatch = videoId.match(/_p(\d+)$/);
            const currentPageNum = pMatch ? parseInt(pMatch[1], 10) : 1;

            if (Array.isArray(vData.pages) && vData.pages.length > 1) {
                const curPage = vData.pages.find((p) => p.page === currentPageNum);
                if (curPage) {
                    episodeTitle = curPage.part || `P${currentPageNum}`;
                }
            }

            const fullTitle = episodeTitle
                ? `${mainTitle} - ${episodeTitle}`
                : mainTitle;

            const uploader = vData.owner?.name;
            const summary = uploader
                ? `UP: ${uploader} | ${vData.desc || ''}`
                : vData.desc;

            return {
                mainTitle,
                episodeTitle,
                fullTitle,
                videoId,
                showId: vData.bvid || bvid || videoId,
                showSummary: summary,
                episodeNum: currentPageNum,
            };
        }

        // 4. DOM query fallback
        let title = '';
        const titleEl =
            document.querySelector('h1.video-title') ||
            document.querySelector('.video-info-title-inner') ||
            document.querySelector('.media-title');
        if (titleEl?.textContent) {
            title = titleEl.textContent.trim();
        } else if (typeof document !== 'undefined') {
            title = (document.title || '')
                .replace(/\s*_[^_\s]+_bilibili\s*$/i, '')
                .replace(/\s*-_bilibili\s*$/i, '')
                .trim();
        }

        const descEl =
            document.querySelector('.desc-info-text') ||
            document.querySelector('.basic-desc-info') ||
            document.querySelector('#v_desc .info') ||
            document.querySelector('.media-desc');
        const descText = descEl?.textContent?.trim() || undefined;

        const upEl =
            document.querySelector('.up-name') ||
            document.querySelector('.name .username');
        const upName = upEl?.textContent?.trim();
        const fallbackSummary = upName
            ? `UP: ${upName} | ${descText || ''}`
            : descText;

        const effectiveShowId = bvid || videoId;

        if (
            title &&
            title !== videoId &&
            !title.startsWith('BV') &&
            !title.startsWith('av') &&
            !title.startsWith('哔哩哔哩')
        ) {
            return {
                mainTitle: title,
                episodeTitle: '',
                fullTitle: title,
                videoId,
                showId: effectiveShowId,
                showSummary: fallbackSummary,
            };
        }

        return null;
    }

    // --------------------------------------------------------------------------
    // 5. Playback Events & Dataset Synchronization
    // --------------------------------------------------------------------------

    private setupPlayerEventHooks(): void {
        const onTimeOrStateChange = () => {
            this.syncPlaybackState();
        };

        const attachVideo = () => {
            const video = this.getVideoElement();
            if (!video) return;

            video.addEventListener('timeupdate', onTimeOrStateChange);
            video.addEventListener('play', onTimeOrStateChange);
            video.addEventListener('pause', onTimeOrStateChange);
            video.addEventListener('ratechange', onTimeOrStateChange);
            video.addEventListener('seeking', onTimeOrStateChange);
            video.addEventListener('seeked', onTimeOrStateChange);
        };

        attachVideo();

        const videoObserver = new MutationObserver(() => {
            attachVideo();
        });

        videoObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });

        this.unhookPlayerEvents = () => {
            videoObserver.disconnect();
            const video = this.getVideoElement();
            if (video) {
                video.removeEventListener('timeupdate', onTimeOrStateChange);
                video.removeEventListener('play', onTimeOrStateChange);
                video.removeEventListener('pause', onTimeOrStateChange);
                video.removeEventListener('ratechange', onTimeOrStateChange);
                video.removeEventListener('seeking', onTimeOrStateChange);
                video.removeEventListener('seeked', onTimeOrStateChange);
            }
        };
    }

    private syncPlaybackState(): void {
        const video = this.getVideoElement();
        const currentVideoId = this.getCurrentVideoId();
        if (!video || !currentVideoId) return;

        const currentTime = video.currentTime || 0;
        const isPaused = video.paused || video.ended;
        const playbackRate = video.playbackRate || 1.0;
        const now = performance.now();

        if (
            !isPaused &&
            this.lastReportedTime !== null &&
            Math.abs(currentTime - this.lastReportedTime) < 0.2 &&
            now - this.lastTimeUpdateSync < 400
        ) {
            return;
        }

        this.lastReportedTime = currentTime;
        this.lastTimeUpdateSync = now;

        PlaybackDatasetHelper.write({
            movieId: currentVideoId,
            currentTime,
            syncAt: now,
            isPaused,
            playbackRate,
            showId: currentVideoId,
        });
    }

    // --------------------------------------------------------------------------
    // 6. Cross-World Message Handling (Tri-State Protocol)
    // --------------------------------------------------------------------------

    private setupMessageListener(): void {
        const handler = (event: MessageEvent<InjectedIncomingEvent>) => {
            if (event.source !== window || !event.data) return;

            switch (event.data.type) {
                case NCW_MESSAGE_TYPES.QUERY_METADATA: {
                    const { queryId, movieId } = event.data;
                    const targetId = movieId || this.getCurrentVideoId();
                    if (!targetId) {
                        window.postMessage(
                            {
                                type: NCW_MESSAGE_TYPES.QUERY_METADATA_RESULT,
                                queryId,
                                status: 'undefined',
                            },
                            '*',
                        );
                        return;
                    }

                    const meta = this.extractMetadata(targetId);
                    if (
                        meta &&
                        meta.mainTitle &&
                        meta.mainTitle !== targetId &&
                        !meta.mainTitle.startsWith('BV') &&
                        !meta.mainTitle.startsWith('av')
                    ) {
                        window.postMessage(
                            {
                                type: NCW_MESSAGE_TYPES.QUERY_METADATA_RESULT,
                                queryId,
                                status: 'resolved',
                                movieId: targetId,
                                metadata: meta,
                            },
                            '*',
                        );
                    } else {
                        // Proactively fetch in background if not yet cached
                        const bvid =
                            this.extractBvid(targetId) ||
                            this.extractBvid(window.location.href);
                        if (bvid && !this.cachedDetails.has(bvid)) {
                            this.fetchVideoDetail(bvid).catch(() => {});
                        }
                        const bangumiMatch = (targetId || window.location.href).match(
                            /(ep\d+|ss\d+)/i,
                        );
                        if (bangumiMatch && !this.cachedBangumi.has(bangumiMatch[1])) {
                            this.fetchBangumiDetail(bangumiMatch[1]).catch(() => {});
                        }

                        window.postMessage(
                            {
                                type: NCW_MESSAGE_TYPES.QUERY_METADATA_RESULT,
                                queryId,
                                status: 'undefined',
                                movieId: targetId,
                            },
                            '*',
                        );
                    }
                    break;
                }

                case NCW_MESSAGE_TYPES.QUERY_SUBTITLE: {
                    const { queryId, movieId } = event.data;
                    const targetId = movieId || this.getCurrentVideoId();
                    if (!targetId) {
                        window.postMessage(
                            {
                                type: NCW_MESSAGE_TYPES.QUERY_SUBTITLE_RESULT,
                                queryId,
                                status: 'null',
                            },
                            '*',
                        );
                        return;
                    }

                    const cached = this.trackRegistry.getCachedSubtitle(targetId);
                    if (cached) {
                        window.postMessage(
                            {
                                type: NCW_MESSAGE_TYPES.QUERY_SUBTITLE_RESULT,
                                queryId,
                                status: 'resolved',
                                rawText: cached.rawText,
                                bcp: cached.lan,
                            },
                            '*',
                        );
                        return;
                    }

                    // Check if track is available but not yet downloaded
                    const preferred = this.trackRegistry.getPreferredTrack(targetId);
                    if (preferred && preferred.subtitle_url) {
                        this.fetchAndEmitSubtitle(targetId, preferred)
                            .then(() => {
                                const downloaded = this.trackRegistry.getCachedSubtitle(targetId);
                                window.postMessage(
                                    {
                                        type: NCW_MESSAGE_TYPES.QUERY_SUBTITLE_RESULT,
                                        queryId,
                                        status: downloaded ? 'resolved' : 'null',
                                        rawText: downloaded?.rawText,
                                        bcp: downloaded?.lan,
                                    },
                                    '*',
                                );
                            })
                            .catch(() => {
                                window.postMessage(
                                    {
                                        type: NCW_MESSAGE_TYPES.QUERY_SUBTITLE_RESULT,
                                        queryId,
                                        status: 'null',
                                    },
                                    '*',
                                );
                            });
                        return;
                    }

                    window.postMessage(
                        {
                            type: NCW_MESSAGE_TYPES.QUERY_SUBTITLE_RESULT,
                            queryId,
                            status: 'null',
                        },
                        '*',
                    );
                    break;
                }

                case NCW_MESSAGE_TYPES.REQUEST_SUBTITLE_RETRY: {
                    const targetId = this.getCurrentVideoId();
                    if (targetId) {
                        const preferred = this.trackRegistry.getPreferredTrack(targetId);
                        if (preferred) {
                            this.fetchAndEmitSubtitle(targetId, preferred).catch(() => {});
                        }
                    }
                    break;
                }
            }
        };

        window.addEventListener('message', handler);
        this.cleanupMessageListener = () => {
            window.removeEventListener('message', handler);
        };
    }
}
