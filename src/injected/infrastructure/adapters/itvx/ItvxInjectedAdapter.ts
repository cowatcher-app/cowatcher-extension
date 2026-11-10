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
import { NetworkHook } from '../../network/NetworkHook';
import {
    ItvxNextDataRoot,
    ItvxPlaylistResponse,
    ItvxCachedMetadata,
} from './ItvxTypes';

declare global {
    interface Window {
        __NEXT_DATA__?: ItvxNextDataRoot;
        __NCW_ITVX_INTERCEPTOR_INITIALIZED__?: boolean;
    }
}

export class ItvxInjectedAdapter implements IInjectedAdapter {
    readonly platformId: StreamingPlatformId = STREAMING_PLATFORMS.ITVX;
    private readonly logger: Logger = new Logger('ItvxInjectedAdapter');

    private cachedMetadata: ItvxCachedMetadata | null = null;
    private cachedSubtitles = new Map<
        string,
        { rawText: string; bcp: string; url: string }
    >();
    private episodePlaylistUrls = new Map<string, string>(); // videoId -> playlistUrl
    private episodeSubtitleUrls = new Map<string, string>(); // videoId -> subtitleUrl

    private lastReportedUrl = '';
    private lastObservedVideoId: string | null = null;
    private lastEmittedSignature = '';
    private lastReportedTime: number | null = null;
    private lastTimeUpdateSync = 0;
    private lastAdState: boolean = false;

    private pollIntervalId: ReturnType<typeof setInterval> | null = null;

    // Lifecycle cleanups
    private unhookNetworkSubtitle?: () => void;
    private unhookFetch?: () => void;
    private unhookNavigation?: () => void;
    private cleanupMessageListener?: () => void;
    private unhookPlayerEvents?: () => void;

    matches(url: string): boolean {
        return /itv\.com/i.test(url);
    }

    initialize(): void {
        if (window.__NCW_ITVX_INTERCEPTOR_INITIALIZED__) return;
        window.__NCW_ITVX_INTERCEPTOR_INITIALIZED__ = true;

        this.lastReportedUrl = window.location.href;
        this.lastObservedVideoId = this.extractVideoId(window.location.href);

        this.logger.info(
            'ItvxInjectedAdapter',
            'Initializing ITVX Injected Adapter in MAIN world.',
        );

        this.parseNextDataMetadata();
        this.setupNetworkInterceptor();
        this.setupNavigationMonitoring();
        this.setupPlayerEventHooks();
        this.setupMessageListener();

        // Background state sync polling (every 500ms)
        this.pollIntervalId = setInterval(() => {
            this.checkUrlAndVideoChange();
            this.checkAdState();
            this.syncPlaybackState();
        }, 500);

        // Initial warmup
        setTimeout(() => {
            this.parseNextDataMetadata();
            this.emitMetadataForCurrentVideo();
            this.syncPlaybackState();
            this.proactiveFetchSubtitleForCurrentVideo();
        }, 300);
    }

    destroy(): void {
        if (this.pollIntervalId) {
            clearInterval(this.pollIntervalId);
            this.pollIntervalId = null;
        }

        this.cleanupMessageListener?.();
        this.unhookNavigation?.();
        this.unhookPlayerEvents?.();
        this.unhookNetworkSubtitle?.();
        this.unhookFetch?.();

        this.cachedSubtitles.clear();
        this.episodePlaylistUrls.clear();
        this.episodeSubtitleUrls.clear();
        this.cachedMetadata = null;
        PlaybackDatasetHelper.clear();

        window.__NCW_ITVX_INTERCEPTOR_INITIALIZED__ = false;
        this.logger.info('ItvxInjectedAdapter', 'ItvxInjectedAdapter destroyed.');
    }

    // --------------------------------------------------------------------------
    // 1. URL & ID Extraction
    // --------------------------------------------------------------------------

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

            // Pattern 2: /watch/:seriesSlug/:programmeId (default episode 1)
            // e.g. /watch/scandal/10a6587
            const showMatch = pathname.match(/\/watch\/[^/]+\/([a-zA-Z0-9]+)/i);
            if (showMatch) {
                const showId = showMatch[1];
                // Check if cached metadata has the default episode
                if (this.cachedMetadata) {
                    const firstEp = this.cachedMetadata.episodes.values().next()
                        .value;
                    if (firstEp) return firstEp.videoId;
                }
                return `${showId}a0001`;
            }
        } catch {}
        return null;
    }

    extractShowId(url: string = window.location.href): string | null {
        if (!url) return null;
        try {
            const urlObj = new URL(url, window.location.origin);
            const pathname = urlObj.pathname;
            const match = pathname.match(/\/watch\/[^/]+\/([a-zA-Z0-9]+)/i);
            if (match) {
                return match[1];
            }
        } catch {}
        return null;
    }

    private getCurrentVideoId(): string | null {
        return (
            this.lastObservedVideoId ||
            this.extractVideoId(window.location.href)
        );
    }

    // --------------------------------------------------------------------------
    // 2. Metadata Extraction from __NEXT_DATA__
    // --------------------------------------------------------------------------

    private parseNextDataMetadata(): void {
        try {
            let nextData = window.__NEXT_DATA__;
            if (!nextData) {
                const el = document.getElementById('__NEXT_DATA__');
                if (el?.textContent) {
                    nextData = JSON.parse(el.textContent) as ItvxNextDataRoot;
                }
            }

            const pageProps = nextData?.props?.pageProps;
            if (!pageProps?.programme) return;

            const programme = pageProps.programme;
            const showTitle = programme.title || '';
            const showId =
                programme.encodedProgrammeId?.letterA ||
                programme.programmeId ||
                this.extractShowId() ||
                '';
            const showSynopsis =
                programme.longDescription ||
                programme.thousandDescription ||
                programme.description;

            const episodeMap = new Map<
                string,
                {
                    videoId: string;
                    episodeTitle: string;
                    episodeSynopsis?: string;
                    episodeNum?: number;
                    seriesNum?: number;
                    playlistUrl?: string;
                    subtitleUrl?: string;
                }
            >();

            if (Array.isArray(pageProps.seriesList)) {
                for (const series of pageProps.seriesList) {
                    const seriesNum =
                        typeof series.seriesNumber === 'number'
                            ? series.seriesNumber
                            : parseInt(String(series.seriesNumber || '1'), 10);

                    if (Array.isArray(series.titles)) {
                        for (const ep of series.titles) {
                            const videoId =
                                ep.encodedEpisodeId?.letterA ||
                                (ep.episodeId
                                    ? ep.episodeId.replace(/\//g, 'a')
                                    : '');
                            if (!videoId) continue;

                            const epTitle = ep.episodeTitle || '';
                            const epSynopsis =
                                ep.longDescription || ep.description;
                            const epNum = ep.episode;
                            const playlistUrl = ep.playlistUrl;

                            if (playlistUrl) {
                                this.episodePlaylistUrls.set(
                                    videoId,
                                    playlistUrl,
                                );
                            }

                            episodeMap.set(videoId, {
                                videoId,
                                episodeTitle: epTitle,
                                episodeSynopsis: epSynopsis,
                                episodeNum: epNum,
                                seriesNum: isNaN(seriesNum) ? 1 : seriesNum,
                                playlistUrl,
                            });
                        }
                    }
                }
            }

            this.cachedMetadata = {
                showId,
                showTitle,
                showSynopsis,
                episodes: episodeMap,
            };

            this.logger.info(
                'ItvxInjectedAdapter',
                `Parsed __NEXT_DATA__ metadata: "${showTitle}" (${episodeMap.size} episodes)`,
            );
        } catch (e) {
            this.logger.warn(
                'ItvxInjectedAdapter',
                'Failed parsing __NEXT_DATA__ metadata:',
                e,
            );
        }
    }

    private extractMetadata(videoId: string): VideoMetadata | null {
        if (!this.cachedMetadata) {
            this.parseNextDataMetadata();
        }

        const showId =
            this.cachedMetadata?.showId || this.extractShowId() || videoId;
        const mainTitle = this.cachedMetadata?.showTitle || '';

        let episodeTitle = '';
        let episodeSummary: string | undefined;
        let episodeNum: number | undefined;
        let seasonNum: number | undefined;

        if (this.cachedMetadata?.episodes.has(videoId)) {
            const ep = this.cachedMetadata.episodes.get(videoId)!;
            episodeTitle = ep.episodeTitle;
            episodeSummary = ep.episodeSynopsis;
            episodeNum = ep.episodeNum;
            seasonNum = ep.seriesNum;
        }

        // Fallback to DOM if title is missing
        let resolvedTitle = mainTitle;
        if (!resolvedTitle) {
            const domTitle = document.querySelector(
                '.fe-mrphs__programme__title',
            );
            resolvedTitle =
                domTitle?.textContent?.trim() ||
                document.title.replace(/\s*-\s*ITVX$/i, '').trim();
        }

        if (
            resolvedTitle &&
            resolvedTitle !== videoId &&
            !resolvedTitle.startsWith('10a')
        ) {
            const fullTitle = episodeTitle
                ? `${resolvedTitle} - ${episodeTitle}`
                : resolvedTitle;

            return {
                mainTitle: resolvedTitle,
                episodeTitle,
                fullTitle,
                videoId,
                showId,
                showSummary: this.cachedMetadata?.showSynopsis,
                episodeSummary,
                episodeNum,
                seasonNum,
            };
        }

        return null;
    }

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
            document.documentElement.dataset.ncwEpisodeTitle =
                metadata.episodeTitle;
            document.documentElement.dataset.ncwShowId = metadata.showId;
            if (metadata.showSummary) {
                document.documentElement.dataset.ncwShowSummary =
                    metadata.showSummary;
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

    // --------------------------------------------------------------------------
    // 3. Network Interceptor (Playlist & Subtitles)
    // --------------------------------------------------------------------------

    private setupNetworkInterceptor(): void {
        // 3.1 Listen for WebVTT subtitle stream detected by NetworkHook
        this.unhookNetworkSubtitle = NetworkHook.onSubtitlePayload(
            (url, text) => {
                const currentVideoId = this.getCurrentVideoId();
                this.logger.info(
                    'ItvxInjectedAdapter',
                    `Captured WebVTT subtitle from: ${url}`,
                );

                if (currentVideoId) {
                    this.cachedSubtitles.set(currentVideoId, {
                        rawText: text,
                        bcp: 'en',
                        url,
                    });
                }

                const payload: InjectedSubtitleRawDataPayload = {
                    type: NCW_MESSAGE_TYPES.SUBTITLE_RAW_DATA,
                    movieId: currentVideoId,
                    url,
                    rawText: text,
                    bcp47: 'en',
                    timestamp: Date.now(),
                };
                window.postMessage(payload, '*');
            },
        );

        // 3.2 Intercept fetch to capture magni playlist responses
        const originalFetch = window.fetch;
        window.fetch = async (...args: Parameters<typeof originalFetch>) => {
            const response = await originalFetch.apply(window, args);
            try {
                const requestUrl =
                    typeof args[0] === 'string'
                        ? args[0]
                        : args[0] instanceof Request
                          ? args[0].url
                          : args[0] instanceof URL
                            ? args[0].href
                            : '';

                if (requestUrl.includes('magni.itv.com/playlist/')) {
                    const clone = response.clone();
                    clone
                        .json()
                        .then((data: ItvxPlaylistResponse) => {
                            this.handlePlaylistResponse(requestUrl, data);
                        })
                        .catch(() => {});
                }
            } catch {}
            return response;
        };

        this.unhookFetch = () => {
            window.fetch = originalFetch;
        };
    }

    private handlePlaylistResponse(
        _url: string,
        data: ItvxPlaylistResponse,
    ): void {
        try {
            const subtitles = data.Playlist?.Video?.Subtitles;
            if (Array.isArray(subtitles) && subtitles.length > 0) {
                const subHref = subtitles[0]?.Href;
                if (subHref) {
                    const currentVid = this.getCurrentVideoId();
                    if (currentVid) {
                        this.episodeSubtitleUrls.set(currentVid, subHref);
                    }
                    this.logger.info(
                        'ItvxInjectedAdapter',
                        `Discovered subtitle URL from Magni playlist: ${subHref}`,
                    );
                    this.fetchAndEmitSubtitle(subHref, currentVid).catch(
                        () => {},
                    );
                }
            }
        } catch (e) {
            this.logger.warn(
                'ItvxInjectedAdapter',
                'Failed handling playlist response:',
                e,
            );
        }
    }

    private async fetchAndEmitSubtitle(
        subtitleUrl: string,
        targetVideoId?: string | null,
    ): Promise<void> {
        try {
            const resp = await window.fetch(subtitleUrl);
            if (!resp.ok) return;
            const text = await resp.text();
            if (!text || !text.includes('WEBVTT')) return;

            const effectiveVid = targetVideoId || this.getCurrentVideoId();
            if (effectiveVid) {
                this.cachedSubtitles.set(effectiveVid, {
                    rawText: text,
                    bcp: 'en',
                    url: subtitleUrl,
                });
            }

            const payload: InjectedSubtitleRawDataPayload = {
                type: NCW_MESSAGE_TYPES.SUBTITLE_RAW_DATA,
                movieId: effectiveVid,
                url: subtitleUrl,
                rawText: text,
                bcp47: 'en',
                timestamp: Date.now(),
            };
            window.postMessage(payload, '*');
            this.logger.info(
                'ItvxInjectedAdapter',
                `Successfully fetched and emitted WebVTT for ${effectiveVid || 'current'}.`,
            );
        } catch (err) {
            this.logger.warn(
                'ItvxInjectedAdapter',
                `Failed fetching subtitle from ${subtitleUrl}:`,
                err,
            );
        }
    }

    private proactiveFetchSubtitleForCurrentVideo(): void {
        const videoId = this.getCurrentVideoId();
        if (!videoId || this.cachedSubtitles.has(videoId)) return;

        // 1. If we already have the subtitle URL, fetch it directly
        const subUrl = this.episodeSubtitleUrls.get(videoId);
        if (subUrl) {
            this.fetchAndEmitSubtitle(subUrl, videoId).catch(() => {});
            return;
        }

        // 2. If we have the playlist URL from __NEXT_DATA__, fetch the playlist
        const playlistUrl = this.episodePlaylistUrls.get(videoId);
        if (playlistUrl) {
            window
                .fetch(playlistUrl)
                .then((r) => r.json())
                .then((data: ItvxPlaylistResponse) => {
                    this.handlePlaylistResponse(playlistUrl, data);
                })
                .catch(() => {});
        }
    }

    // --------------------------------------------------------------------------
    // 4. Playback State, Ad State & Navigation Hooks
    // --------------------------------------------------------------------------

    private getContentVideoElement(): HTMLVideoElement | null {
        return (
            (document.querySelector(
                '.fe-mrphs__videoParent video:not(#advertPlayerA):not(#advertPlayerB)',
            ) as HTMLVideoElement | null) ||
            (document.querySelector(
                '[data-testid="video-parent"] video:not([id*="advert"])',
            ) as HTMLVideoElement | null) ||
            (document.querySelector(
                'video:not([id*="advert"])',
            ) as HTMLVideoElement | null)
        );
    }

    private setupPlayerEventHooks(): void {
        const onTimeOrStateChange = () => {
            this.syncPlaybackState();
        };

        const attachVideo = () => {
            const video = this.getContentVideoElement();
            if (!video) return;

            video.addEventListener('timeupdate', onTimeOrStateChange);
            video.addEventListener('play', onTimeOrStateChange);
            video.addEventListener('pause', onTimeOrStateChange);
            video.addEventListener('ratechange', onTimeOrStateChange);
            video.addEventListener('seeking', onTimeOrStateChange);
        };

        attachVideo();
        const obs = new MutationObserver(() => {
            attachVideo();
        });
        obs.observe(document.body, { childList: true, subtree: true });

        this.unhookPlayerEvents = () => {
            obs.disconnect();
            const video = this.getContentVideoElement();
            if (video) {
                video.removeEventListener('timeupdate', onTimeOrStateChange);
                video.removeEventListener('play', onTimeOrStateChange);
                video.removeEventListener('pause', onTimeOrStateChange);
                video.removeEventListener('ratechange', onTimeOrStateChange);
                video.removeEventListener('seeking', onTimeOrStateChange);
            }
        };
    }

    private checkAdState(): void {
        const adPlayerA = document.querySelector(
            '#advertPlayerA',
        ) as HTMLVideoElement | null;
        const adPlayerB = document.querySelector(
            '#advertPlayerB',
        ) as HTMLVideoElement | null;

        const isPlayerAActive = Boolean(
            adPlayerA &&
            adPlayerA.style.display !== 'none' &&
            adPlayerA.src &&
            adPlayerA.src.length > 0 &&
            !adPlayerA.paused,
        );

        const isPlayerBActive = Boolean(
            adPlayerB &&
            adPlayerB.style.display !== 'none' &&
            adPlayerB.src &&
            adPlayerB.src.length > 0 &&
            !adPlayerB.paused,
        );

        const isAd = isPlayerAActive || isPlayerBActive;
        if (isAd !== this.lastAdState) {
            this.lastAdState = isAd;
            window.postMessage(
                {
                    type: NCW_MESSAGE_TYPES.AD_STATE_CHANGED,
                    isAd,
                },
                '*',
            );
        }
    }

    private syncPlaybackState(): void {
        const video = this.getContentVideoElement();
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

        const showId = this.cachedMetadata?.showId || this.extractShowId() || currentVideoId;
        PlaybackDatasetHelper.write({
            movieId: currentVideoId,
            currentTime,
            syncAt: now,
            isPaused,
            playbackRate,
            showId,
        });
    }

    private setupNavigationMonitoring(): void {
        const originalPush = window.history.pushState;
        const originalReplace = window.history.replaceState;

        const onNav = () => {
            setTimeout(() => {
                this.checkUrlAndVideoChange();
            }, 100);
        };

        window.history.pushState = function (...args) {
            const ret = originalPush.apply(this, args);
            onNav();
            return ret;
        };

        window.history.replaceState = function (...args) {
            const ret = originalReplace.apply(this, args);
            onNav();
            return ret;
        };

        window.addEventListener('popstate', onNav);

        this.unhookNavigation = () => {
            window.history.pushState = originalPush;
            window.history.replaceState = originalReplace;
            window.removeEventListener('popstate', onNav);
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
                'ItvxInjectedAdapter',
                `Detected episode change: ${this.lastObservedVideoId || 'none'} -> ${currentVideoId}`,
            );
            this.lastObservedVideoId = currentVideoId;
            this.lastEmittedSignature = '';

            const epPayload: InjectedEpisodeChangedPayload = {
                type: NCW_MESSAGE_TYPES.EPISODE_CHANGED,
                movieId: currentVideoId,
            };
            window.postMessage(epPayload, '*');

            this.parseNextDataMetadata();
            this.emitMetadataForCurrentVideo();
            this.proactiveFetchSubtitleForCurrentVideo();
        }
    }

    // --------------------------------------------------------------------------
    // 5. Message Handlers (Tri-State Queries)
    // --------------------------------------------------------------------------

    private setupMessageListener(): void {
        const handler = (event: MessageEvent) => {
            if (event.source !== window || !event.data) return;
            const data: InjectedIncomingEvent = event.data;

            switch (data.type) {
                case NCW_MESSAGE_TYPES.REQUEST_METADATA: {
                    this.parseNextDataMetadata();
                    this.emitMetadataForCurrentVideo();
                    break;
                }

                case NCW_MESSAGE_TYPES.REQUEST_SUBTITLE_RETRY: {
                    this.proactiveFetchSubtitleForCurrentVideo();
                    break;
                }

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
                        !meta.mainTitle.startsWith('10a')
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
                        this.parseNextDataMetadata();
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

                    const cached = this.cachedSubtitles.get(targetId);
                    if (cached) {
                        window.postMessage(
                            {
                                type: NCW_MESSAGE_TYPES.QUERY_SUBTITLE_RESULT,
                                queryId,
                                status: 'resolved',
                                rawText: cached.rawText,
                                bcp: cached.bcp,
                            },
                            '*',
                        );
                        return;
                    }

                    // Proactively attempt fetch if not cached yet
                    this.proactiveFetchSubtitleForCurrentVideo();

                    window.postMessage(
                        {
                            type: NCW_MESSAGE_TYPES.QUERY_SUBTITLE_RESULT,
                            queryId,
                            status: 'undefined',
                            movieId: targetId,
                        },
                        '*',
                    );
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
