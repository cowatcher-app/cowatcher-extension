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
    Channel4VodStreamResponse,
    Channel4WatchMoreResponse,
    Channel4CachedMetadata,
    Channel4CachedEpisode,
} from './Channel4Types';

declare global {
    interface Window {
        __NCW_CHANNEL4_INTERCEPTOR_INITIALIZED__?: boolean;
    }
}

export class Channel4InjectedAdapter implements IInjectedAdapter {
    readonly platformId: StreamingPlatformId = STREAMING_PLATFORMS.CHANNEL4;
    private readonly logger: Logger = new Logger('Channel4InjectedAdapter');

    private cachedMetadata: Channel4CachedMetadata | null = null;
    private cachedSubtitles = new Map<
        string,
        { rawText: string; bcp: string; url: string }
    >();
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
        return /channel4\.com/i.test(url);
    }

    initialize(): void {
        if (window.__NCW_CHANNEL4_INTERCEPTOR_INITIALIZED__) return;
        window.__NCW_CHANNEL4_INTERCEPTOR_INITIALIZED__ = true;

        this.lastReportedUrl = window.location.href;
        this.lastObservedVideoId = this.extractVideoId(window.location.href);

        this.logger.info(
            'Channel4InjectedAdapter',
            'Initializing Channel 4 Injected Adapter in MAIN world.',
        );

        this.setupNetworkInterceptor();
        this.setupNavigationMonitoring();
        this.setupPlayerEventHooks();
        this.setupMessageListener();

        // Background state sync polling (every 500ms)
        this.pollIntervalId = setInterval(() => {
            this.checkUrlAndVideoChange();
            this.checkAdState();
            this.syncPlaybackState();
            this.checkTrackElements();
        }, 500);

        // Initial warmup
        setTimeout(() => {
            this.proactiveFetchMetadataAndSubtitle();
            this.emitMetadataForCurrentVideo();
            this.syncPlaybackState();
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
        this.episodeSubtitleUrls.clear();
        this.cachedMetadata = null;
        PlaybackDatasetHelper.clear();

        window.__NCW_CHANNEL4_INTERCEPTOR_INITIALIZED__ = false;
        this.logger.info(
            'Channel4InjectedAdapter',
            'Channel4InjectedAdapter destroyed.',
        );
    }

    // --------------------------------------------------------------------------
    // 1. URL & ID Extraction
    // --------------------------------------------------------------------------

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
        return null;
    }

    extractShowId(url: string = window.location.href): string | null {
        if (!url) return null;
        try {
            const urlObj = new URL(url, window.location.origin);
            const pathname = urlObj.pathname;
            const match = pathname.match(/\/programmes\/([^/?#]+)/i);
            if (match) {
                return match[1];
            }
        } catch {}

        const videoId = this.extractVideoId(url);
        if (videoId) {
            const hyphenIdx = videoId.indexOf('-');
            if (hyphenIdx > 0) {
                return videoId.slice(0, hyphenIdx);
            }
        }
        return null;
    }

    private getCurrentVideoId(): string | null {
        return (
            this.lastObservedVideoId ||
            this.extractVideoId(window.location.href)
        );
    }

    // --------------------------------------------------------------------------
    // 2. Metadata Handling
    // --------------------------------------------------------------------------

    private extractMetadata(videoId: string): VideoMetadata | null {
        const brandId =
            this.cachedMetadata?.brandId || this.extractShowId() || videoId;
        const mainTitle = this.cachedMetadata?.brandTitle || '';

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
                '.player__brand-title, .brand-title, [data-testid="brand-title"]',
            );
            resolvedTitle =
                domTitle?.textContent?.trim() ||
                document.title.replace(/\s*-\s*Channel 4$/i, '').trim();
        }

        if (
            resolvedTitle &&
            resolvedTitle !== videoId &&
            !/^\d{4,}-\d+$/.test(resolvedTitle)
        ) {
            const fullTitle = episodeTitle
                ? `${resolvedTitle} - ${episodeTitle}`
                : resolvedTitle;

            return {
                mainTitle: resolvedTitle,
                episodeTitle,
                fullTitle,
                videoId,
                showId: brandId,
                showSummary: this.cachedMetadata?.brandSynopsis,
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
    // 3. Network Interceptor (VOD Stream API & Subtitles)
    // --------------------------------------------------------------------------

    private setupNetworkInterceptor(): void {
        // 3.1 Listen for WebVTT subtitle stream detected by NetworkHook
        this.unhookNetworkSubtitle = NetworkHook.onSubtitlePayload(
            (url, text) => {
                const currentVideoId = this.getCurrentVideoId();
                this.logger.info(
                    'Channel4InjectedAdapter',
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

        // 3.2 Intercept fetch to capture vod/stream and watch-more responses
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

                if (requestUrl.includes('/vod/stream/')) {
                    const clone = response.clone();
                    clone
                        .json()
                        .then((data: Channel4VodStreamResponse) => {
                            this.handleVodStreamResponse(requestUrl, data);
                        })
                        .catch(() => {});
                } else if (requestUrl.includes('/player/watch-more/')) {
                    const clone = response.clone();
                    clone
                        .json()
                        .then((data: Channel4WatchMoreResponse) => {
                            this.handleWatchMoreResponse(requestUrl, data);
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

    private handleVodStreamResponse(
        url: string,
        data: Channel4VodStreamResponse,
    ): void {
        try {
            const urlMatch = url.match(/\/vod\/stream\/([a-zA-Z0-9_-]+)/i);
            const videoId =
                (data.programmeId
                    ? data.programmeId.replace(/\//g, '-')
                    : null) ||
                (urlMatch ? urlMatch[1] : null) ||
                this.getCurrentVideoId();

            if (!videoId) return;

            const brandTitle = data.brandTitle || '';
            const episodeTitle = data.episodeTitle || '';
            const brandId = String(
                data.contractId ||
                    data.webSafeBrandTitle ||
                    this.extractShowId() ||
                    videoId,
            );
            const episodeNum = data.programmeNumber;

            // Find WebVTT subtitle asset
            let vttUrl: string | undefined;
            if (Array.isArray(data.subtitlesAssets)) {
                const found = data.subtitlesAssets.find(
                    (s) =>
                        s.url?.toLowerCase().endsWith('.vtt') ||
                        s.format?.toLowerCase().includes('webvtt'),
                );
                if (found?.url) {
                    vttUrl = found.url;
                }
            }

            if (vttUrl) {
                this.episodeSubtitleUrls.set(videoId, vttUrl);
                this.logger.info(
                    'Channel4InjectedAdapter',
                    `Discovered subtitle URL for ${videoId}: ${vttUrl}`,
                );
                this.fetchAndEmitSubtitle(vttUrl, videoId).catch(() => {});
            }

            // Update cached metadata
            const existingEp = this.cachedMetadata?.episodes.get(videoId);
            const updatedEp: Channel4CachedEpisode = {
                videoId,
                episodeTitle: episodeTitle || existingEp?.episodeTitle || '',
                episodeSynopsis:
                    existingEp?.episodeSynopsis || data.guidanceText,
                episodeNum:
                    typeof episodeNum === 'number'
                        ? episodeNum
                        : existingEp?.episodeNum,
                seriesNum: existingEp?.seriesNum,
                subtitleUrl: vttUrl || existingEp?.subtitleUrl,
            };

            const epMap =
                this.cachedMetadata?.episodes ||
                new Map<string, Channel4CachedEpisode>();
            epMap.set(videoId, updatedEp);

            this.cachedMetadata = {
                brandId,
                brandTitle: brandTitle || this.cachedMetadata?.brandTitle || '',
                brandSynopsis: this.cachedMetadata?.brandSynopsis,
                episodes: epMap,
            };

            this.logger.info(
                'Channel4InjectedAdapter',
                `Parsed vod/stream metadata: "${brandTitle}" - "${episodeTitle}" (videoId: ${videoId})`,
            );

            this.emitMetadataForCurrentVideo();
        } catch (e) {
            this.logger.warn(
                'Channel4InjectedAdapter',
                'Failed handling vod/stream response:',
                e,
            );
        }
    }

    private handleWatchMoreResponse(
        _url: string,
        data: Channel4WatchMoreResponse,
    ): void {
        try {
            const brandTitle = data.brand?.brandTitle || data.brand?.title;
            const brandSynopsis =
                data.brand?.summary || data.brand?.description;
            const brandId = String(
                data.brand?.brandId ||
                    data.brand?.webSafeBrandTitle ||
                    this.extractShowId() ||
                    '',
            );

            const currentVid = this.getCurrentVideoId();
            if (data.episode && currentVid) {
                const epTitle =
                    data.episode.episodeTitle || data.episode.title || '';
                const epSynopsis =
                    data.episode.summary || data.episode.description;
                const epNum = data.episode.episodeNumber;
                const seriesNum = data.episode.seriesNumber;

                const epMap =
                    this.cachedMetadata?.episodes ||
                    new Map<string, Channel4CachedEpisode>();
                const existing = epMap.get(currentVid);

                epMap.set(currentVid, {
                    videoId: currentVid,
                    episodeTitle: epTitle || existing?.episodeTitle || '',
                    episodeSynopsis: epSynopsis || existing?.episodeSynopsis,
                    episodeNum:
                        typeof epNum === 'number' ? epNum : existing?.episodeNum,
                    seriesNum:
                        typeof seriesNum === 'number'
                            ? seriesNum
                            : existing?.seriesNum,
                    subtitleUrl: existing?.subtitleUrl,
                });

                this.cachedMetadata = {
                    brandId: brandId || this.cachedMetadata?.brandId || '',
                    brandTitle:
                        brandTitle || this.cachedMetadata?.brandTitle || '',
                    brandSynopsis:
                        brandSynopsis || this.cachedMetadata?.brandSynopsis,
                    episodes: epMap,
                };

                this.emitMetadataForCurrentVideo();
            }
        } catch (e) {
            this.logger.warn(
                'Channel4InjectedAdapter',
                'Failed handling watch-more response:',
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
                'Channel4InjectedAdapter',
                `Successfully fetched and emitted WebVTT for ${effectiveVid || 'current'}.`,
            );
        } catch (err) {
            this.logger.warn(
                'Channel4InjectedAdapter',
                `Failed fetching subtitle from ${subtitleUrl}:`,
                err,
            );
        }
    }

    private checkTrackElements(): void {
        const currentVid = this.getCurrentVideoId();
        if (!currentVid || this.cachedSubtitles.has(currentVid)) return;

        // Check if <track kind="subtitles"> exists in DOM
        const track = document.querySelector(
            'video.vod-player track[kind="subtitles"], video track[kind="subtitles"]',
        ) as HTMLTrackElement | null;
        if (track && track.src && track.src.includes('.vtt')) {
            const subUrl = track.src;
            if (!this.episodeSubtitleUrls.has(currentVid)) {
                this.episodeSubtitleUrls.set(currentVid, subUrl);
                this.logger.info(
                    'Channel4InjectedAdapter',
                    `Found subtitle URL from DOM track element: ${subUrl}`,
                );
                this.fetchAndEmitSubtitle(subUrl, currentVid).catch(() => {});
            }
        }
    }

    private proactiveFetchMetadataAndSubtitle(): void {
        const videoId = this.getCurrentVideoId();
        if (!videoId) return;

        // 1. If we already have the subtitle URL, fetch it directly
        const subUrl = this.episodeSubtitleUrls.get(videoId);
        if (subUrl && !this.cachedSubtitles.has(videoId)) {
            this.fetchAndEmitSubtitle(subUrl, videoId).catch(() => {});
            return;
        }

        // 2. Proactively call Channel 4 VOD stream API
        const vodUrl = `https://www.channel4.com/vod/stream/${videoId}`;
        window
            .fetch(vodUrl)
            .then((r) => r.json())
            .then((data: Channel4VodStreamResponse) => {
                this.handleVodStreamResponse(vodUrl, data);
            })
            .catch(() => {});

        // 3. Proactively call watch-more API for rich metadata
        const watchMoreUrl = `https://www.channel4.com/player/watch-more/${videoId}`;
        window
            .fetch(watchMoreUrl)
            .then((r) => r.json())
            .then((data: Channel4WatchMoreResponse) => {
                this.handleWatchMoreResponse(watchMoreUrl, data);
            })
            .catch(() => {});
    }

    // --------------------------------------------------------------------------
    // 4. Playback State, Ad State & Navigation Hooks
    // --------------------------------------------------------------------------

    private getContentVideoElement(): HTMLVideoElement | null {
        return (
            (document.querySelector(
                'video.vod-player',
            ) as HTMLVideoElement | null) ||
            (document.querySelector(
                '#html5-player video:not(#freewheelPlayer)',
            ) as HTMLVideoElement | null) ||
            (document.querySelector(
                'video:not(#freewheelPlayer)',
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
        const fwContainer = document.querySelector('#freewheelContainer');
        const fwPlayer = document.querySelector(
            '#freewheelPlayer',
        ) as HTMLVideoElement | null;
        const adPauseControls = document.querySelector('#adPauseControls');
        const vodPlayer = document.querySelector(
            'video.vod-player',
        ) as HTMLVideoElement | null;

        const isContainerActive = Boolean(
            fwContainer &&
            fwContainer.classList.contains('show') &&
            !fwContainer.classList.contains('hide'),
        );

        const isFwPlayerActive = Boolean(
            fwPlayer &&
            (fwPlayer.classList.contains('show') ||
                (fwPlayer.src && fwPlayer.src.length > 0 && !fwPlayer.paused)),
        );

        const isAdPauseControlsActive = Boolean(
            adPauseControls &&
            adPauseControls.classList.contains('show') &&
            !adPauseControls.classList.contains('hide'),
        );

        const isVodHidden = Boolean(
            vodPlayer &&
            (vodPlayer.classList.contains('hidden') ||
                vodPlayer.style.display === 'none' ||
                vodPlayer.style.visibility === 'hidden'),
        );

        const isAd =
            isContainerActive ||
            isFwPlayerActive ||
            isAdPauseControlsActive ||
            (isVodHidden && Boolean(fwPlayer?.src));

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

        const showId =
            this.cachedMetadata?.brandId ||
            this.extractShowId() ||
            currentVideoId;
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
                'Channel4InjectedAdapter',
                `Detected episode change: ${this.lastObservedVideoId || 'none'} -> ${currentVideoId}`,
            );
            this.lastObservedVideoId = currentVideoId;
            this.lastEmittedSignature = '';

            const epPayload: InjectedEpisodeChangedPayload = {
                type: NCW_MESSAGE_TYPES.EPISODE_CHANGED,
                movieId: currentVideoId,
            };
            window.postMessage(epPayload, '*');

            this.proactiveFetchMetadataAndSubtitle();
            this.emitMetadataForCurrentVideo();
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
                    this.proactiveFetchMetadataAndSubtitle();
                    this.emitMetadataForCurrentVideo();
                    break;
                }

                case NCW_MESSAGE_TYPES.REQUEST_SUBTITLE_RETRY: {
                    this.proactiveFetchMetadataAndSubtitle();
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
                        !/^\d{4,}-\d+$/.test(meta.mainTitle)
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
                        this.proactiveFetchMetadataAndSubtitle();
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
                    this.proactiveFetchMetadataAndSubtitle();

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
