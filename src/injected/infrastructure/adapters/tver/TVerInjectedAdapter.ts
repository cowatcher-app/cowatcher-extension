import {
    IInjectedAdapter,
    InjectedIncomingEvent,
    InjectedMetadataLoadedPayload,
} from '../../../domain/IInjectedAdapter';
import { VideoMetadata } from '../../../../content/domain/adapters/IStreamingAdapter';
import {
    STREAMING_PLATFORMS,
    StreamingPlatformId,
} from '@shared/domain/constants/StreamingPlatforms';
import { NCW_MESSAGE_TYPES } from '@shared/domain/constants/MessageTypes';
import { PlaybackDatasetHelper } from '@shared/domain/entities/PlaybackDatasetPayload';
import { Logger } from '@shared/utils/logger';
import { TVerTrackRegistry } from './TVerTrackRegistry';
import { TVerMetadataManager } from './TVerMetadataManager';
import { TVerStreaksPlayer, TVerTextTrackLike, TVerSeriesEpisodesResponse } from './TVerTypes';

export class TVerInjectedAdapter implements IInjectedAdapter {
    readonly platformId: StreamingPlatformId = STREAMING_PLATFORMS.TVER;
    private readonly logger: Logger = new Logger('TVerInjectedAdapter');

    private readonly trackRegistry: TVerTrackRegistry;
    private readonly metadataManager: TVerMetadataManager;

    private lastEmittedSignature = '';
    private lastReportedUrl = '';
    private lastObservedEpisodeId: string | null = null;
    private lastTrackState = '';
    private lastAdState = false;
    private subtitleUpdateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private lastReportedTime: number | null = null;
    private lastTimeUpdateSync = 0;

    private pollIntervalId: ReturnType<typeof setInterval> | null = null;

    // Lifecycle cleanups
    private unhookNetwork?: () => void;
    private unhookRouting?: () => void;
    private unhookPlayerEvents?: () => void;
    private cleanupMessageListener?: () => void;

    constructor() {
        this.trackRegistry = new TVerTrackRegistry();
        this.metadataManager = new TVerMetadataManager();
    }

    matches(url: string): boolean {
        return /tver\.jp/i.test(url);
    }

    initialize(): void {
        if (window.__NCW_TVER_INTERCEPTOR_INITIALIZED__) return;
        window.__NCW_TVER_INTERCEPTOR_INITIALIZED__ = true;

        this.lastReportedUrl = window.location.href;
        this.lastObservedEpisodeId = this.extractEpisodeId(window.location.href);

        this.logger.info(
            'TVer-AI-Sub',
            'Initializing TVer Injected Adapter in MAIN world.',
        );

        this.setupNetworkInterceptor();
        this.setupRouteMonitoring();
        this.setupPlayerEventHooks();
        this.setupMessageListener();

        // Background state sync polling
        this.pollIntervalId = setInterval(() => {
            this.notifyUrlChange();
            this.checkTVerPlayerState();
        }, 500);

        // Initial bootstrapping
        setTimeout(() => {
            this.checkTVerPlayerState();
            this.tryExtractFromTextTracks();
        }, 1000);
    }

    destroy(): void {
        if (this.pollIntervalId) {
            clearInterval(this.pollIntervalId);
            this.pollIntervalId = null;
        }
        if (this.subtitleUpdateDebounceTimer) {
            clearTimeout(this.subtitleUpdateDebounceTimer);
            this.subtitleUpdateDebounceTimer = null;
        }

        this.cleanupMessageListener?.();
        this.unhookRouting?.();
        this.unhookPlayerEvents?.();
        this.unhookNetwork?.();

        this.trackRegistry.clear();
        this.metadataManager.clear();
        PlaybackDatasetHelper.clear();

        window.__NCW_TVER_INTERCEPTOR_INITIALIZED__ = false;
        this.logger.info('TVer-AI-Sub', 'TVerInjectedAdapter destroyed and cleaned up.');
    }

    // --------------------------------------------------------------------------
    // 1. Helpers & Extraction
    // --------------------------------------------------------------------------

    private extractEpisodeId(url?: string): string | null {
        const match = (url || window.location.href || '').match(
            /\/episodes\/([a-zA-Z0-9_-]+)/,
        );
        return match ? match[1] : null;
    }

    private getVideoElement(): HTMLVideoElement | null {
        return (
            (document.getElementById('video-player') as HTMLVideoElement | null) ||
            document.querySelector('video')
        );
    }

    private getTVerPlayer(): TVerStreaksPlayer | null {
        try {
            const video = this.getVideoElement() as
                | (HTMLVideoElement & { playerId?: string })
                | null;
            if (!video) return null;
            const players = window.streaksplayer?.getPlayers?.() || {};
            return (
                (video.playerId && players[video.playerId]) ||
                Object.values(players)[0] ||
                null
            );
        } catch {
            return null;
        }
    }

    private emitSubtitleData(
        url: string,
        text: string,
        force = false,
        explicitEpisodeId: string | null = null,
        explicitLang = 'ja',
    ): void {
        try {
            if (!text || text.length < 20) return;

            const currentActiveId = this.extractEpisodeId(window.location.href);
            const effectiveId = explicitEpisodeId || currentActiveId;

            const signature = `${effectiveId || ''}_${text.length}_${text.slice(0, 80)}_${text.slice(-80)}`;
            if (!force && signature === this.lastEmittedSignature) {
                return;
            }
            this.lastEmittedSignature = signature;

            window.postMessage(
                {
                    type: NCW_MESSAGE_TYPES.SUBTITLE_RAW_DATA,
                    movieId: effectiveId,
                    url: url || window.location.href,
                    pageUrl: window.location.href,
                    rawText: text,
                    bcp47: explicitLang || 'ja',
                    timestamp: Date.now(),
                },
                '*',
            );
            this.logger.info(
                'TVer-AI-Sub',
                `Emitted subtitle payload for episode (${effectiveId || 'active'}), length: ${text.length}`,
            );
        } catch (e) {
            this.logger.error('TVer-AI-Sub', 'Failed to post subtitle message:', e);
        }
    }

    // --------------------------------------------------------------------------
    // 2. Network Interceptor (Fetch & XHR) with Full Teardown
    // --------------------------------------------------------------------------

    private setupNetworkInterceptor(): void {
        const originalFetch = window.fetch;
        const origOpen = XMLHttpRequest.prototype.open as (
            ...a: unknown[]
        ) => void;
        const origSend = XMLHttpRequest.prototype.send as (
            ...a: unknown[]
        ) => void;
        const xhrUrlMap = new WeakMap<XMLHttpRequest, string>();

        window.fetch = async (...args: Parameters<typeof originalFetch>) => {
            const response = await (originalFetch as (...a: unknown[]) => Promise<Response>).apply(window, args);
            try {
                const rawUrl =
                    typeof args[0] === 'string'
                        ? args[0]
                        : (args[0] as Request)?.url || response.url || '';
                const lowerUrl = rawUrl.toLowerCase();

                // 1. Intercept platform_token & platform_uid
                if (lowerUrl.includes('platform_token=')) {
                    try {
                        const u = new URL(rawUrl, window.location.href);
                        const token = u.searchParams.get('platform_token');
                        const uid = u.searchParams.get('platform_uid');
                        if (token) {
                            this.metadataManager.setCapturedToken(token, uid || undefined);
                            this.triggerMetadataFetchIfReady();
                        }
                    } catch {}
                }

                // 2. Intercept series episodes response directly
                if (lowerUrl.includes('/callseriesepisodes/')) {
                    const clone = response.clone();
                    clone
                        .json()
                        .then((data: unknown) => {
                            this.handleSeriesEpisodesApiResponse(
                                data as TVerSeriesEpisodesResponse,
                            );
                        })
                        .catch(() => {});
                }

                // 3. Intercept subtitle files (.vtt, .ttml, etc.)
                const isCandidate =
                    !lowerUrl.includes('thumbnail') &&
                    (lowerUrl.includes('.vtt') ||
                        lowerUrl.includes('webvtt') ||
                        lowerUrl.includes('.ttml') ||
                        lowerUrl.includes('arib') ||
                        lowerUrl.includes('subtitles') ||
                        lowerUrl.includes('caption') ||
                        lowerUrl.includes('track/'));

                if (isCandidate) {
                    const clone = response.clone();
                    clone
                        .text()
                        .then((text: string) => {
                            if (TVerTrackRegistry.isSubtitleContent(text)) {
                                const epId = this.extractEpisodeId(window.location.href);
                                const detail = this.trackRegistry.addInterceptedTrack(
                                    rawUrl,
                                    text,
                                    epId,
                                    'ja',
                                );
                                if (detail) {
                                    this.notifySubtitleUpdated(detail.episodeId);
                                    this.emitSubtitleData(rawUrl, text, false, detail.episodeId);
                                }
                            }
                        })
                        .catch(() => {});
                }
            } catch {}
            return response;
        };

        const onXhrLoad = (xhr: XMLHttpRequest) => {
            try {
                const rawUrl = xhrUrlMap.get(xhr) || xhr.responseURL || '';
                const lowerUrl = rawUrl.toLowerCase();

                // Token detection
                if (lowerUrl.includes('platform_token=')) {
                    try {
                        const u = new URL(rawUrl, window.location.href);
                        const token = u.searchParams.get('platform_token');
                        const uid = u.searchParams.get('platform_uid');
                        if (token) {
                            this.metadataManager.setCapturedToken(token, uid || undefined);
                            this.triggerMetadataFetchIfReady();
                        }
                    } catch {}
                }

                // Series episodes JSON
                if (lowerUrl.includes('/callseriesepisodes/')) {
                    try {
                        const text = xhr.responseText;
                        if (text) {
                            const data = JSON.parse(text);
                            this.handleSeriesEpisodesApiResponse(data);
                        }
                    } catch {}
                }

                // Subtitle text
                if (!lowerUrl.includes('thumbnail')) {
                    const text = xhr.responseText;
                    if (
                        typeof text === 'string' &&
                        TVerTrackRegistry.isSubtitleContent(text)
                    ) {
                        const epId = this.extractEpisodeId(window.location.href);
                        const detail = this.trackRegistry.addInterceptedTrack(
                            rawUrl,
                            text,
                            epId,
                            'ja',
                        );
                        if (detail) {
                            this.notifySubtitleUpdated(detail.episodeId);
                            this.emitSubtitleData(rawUrl, text, false, detail.episodeId);
                        }
                    }
                }
            } catch {}
        };

        XMLHttpRequest.prototype.open = function (
            this: XMLHttpRequest,
            method: string,
            url: string | URL,
            ...rest: [
                async?: boolean,
                username?: string | null,
                password?: string | null,
            ]
        ) {
            const urlStr = typeof url === 'string' ? url : url.href;
            xhrUrlMap.set(this, urlStr);
            return origOpen.apply(this, [method, url, ...rest]);
        };

        XMLHttpRequest.prototype.send = function (
            this: XMLHttpRequest,
            ...args: [body?: Document | XMLHttpRequestBodyInit | null]
        ) {
            this.addEventListener('load', () => onXhrLoad(this), { passive: true });
            return origSend.apply(this, args);
        };

        this.unhookNetwork = () => {
            window.fetch = originalFetch;
            XMLHttpRequest.prototype.open = origOpen;
            XMLHttpRequest.prototype.send = origSend;
        };
    }

    // --------------------------------------------------------------------------
    // 3. SPA Route Observer & History Hooks with Full Teardown
    // --------------------------------------------------------------------------

    private setupRouteMonitoring(): void {
        const origPushState = history.pushState;
        const origReplaceState = history.replaceState;

        const notify = () => this.notifyUrlChange();

        history.pushState = function (
            this: History,
            data: unknown,
            unused: string,
            url?: string | URL | null,
        ) {
            const res = origPushState.call(this, data, unused, url);
            notify();
            return res;
        };

        history.replaceState = function (
            this: History,
            data: unknown,
            unused: string,
            url?: string | URL | null,
        ) {
            const res = origReplaceState.call(this, data, unused, url);
            notify();
            return res;
        };

        const popstateHandler = () => notify();
        window.addEventListener('popstate', popstateHandler);

        this.unhookRouting = () => {
            history.pushState = origPushState;
            history.replaceState = origReplaceState;
            window.removeEventListener('popstate', popstateHandler);
        };
    }

    private notifyUrlChange(): void {
        const current = window.location.href;
        if (current !== this.lastReportedUrl) {
            this.lastReportedUrl = current;
            this.lastEmittedSignature = '';

            const newEpId = this.extractEpisodeId(current);
            if (newEpId && newEpId !== this.lastObservedEpisodeId) {
                this.lastObservedEpisodeId = newEpId;
                this.lastTrackState = '';

                window.postMessage(
                    {
                        type: NCW_MESSAGE_TYPES.EPISODE_CHANGED,
                        movieId: newEpId,
                        url: current,
                    },
                    '*',
                );

                this.triggerMetadataFetchIfReady();
                setTimeout(() => this.tryExtractFromTextTracks(true), 600);
            }

            window.postMessage(
                {
                    type: NCW_MESSAGE_TYPES.URL_CHANGED,
                    url: current,
                },
                '*',
            );
        }
    }

    // --------------------------------------------------------------------------
    // 4. Player Event Hooks & Teardown
    // --------------------------------------------------------------------------

    private setupPlayerEventHooks(): void {
        const onStateChange = () => setTimeout(() => this.checkTVerPlayerState(), 50);
        const playerEvents = ['seeked', 'playing', 'pause', 'ratechange'] as const;

        playerEvents.forEach((evt) => {
            window.addEventListener(evt, onStateChange, {
                capture: true,
                passive: true,
            });
        });

        const onTimeUpdate = () => {
            const now = performance.now();
            if (now - this.lastTimeUpdateSync > 250) {
                this.lastTimeUpdateSync = now;
                this.checkTVerPlayerState();
            }
        };
        window.addEventListener('timeupdate', onTimeUpdate, {
            capture: true,
            passive: true,
        });

        this.unhookPlayerEvents = () => {
            playerEvents.forEach((evt) => {
                window.removeEventListener(evt, onStateChange, true);
            });
            window.removeEventListener('timeupdate', onTimeUpdate, true);
        };
    }

    // --------------------------------------------------------------------------
    // 5. State Synchronization (Type 4 Dataset + Type 3 Events)
    // --------------------------------------------------------------------------

    private checkTVerPlayerState(): void {
        try {
            const video = this.getVideoElement();
            const player = this.getTVerPlayer();
            const currentEpId =
                this.lastObservedEpisodeId || this.extractEpisodeId(window.location.href) || '';

            // 1. Authoritative Ad Break Detection
            let isAd = false;
            if (player) {
                if (typeof player.inAdBreak === 'function') {
                    isAd = Boolean(player.inAdBreak());
                } else if (typeof player.isInAdMode === 'function') {
                    isAd = Boolean(player.isInAdMode());
                } else if (typeof player.isInPreroll === 'function') {
                    isAd = Boolean(player.isInPreroll());
                }
                if (!isAd && typeof player.currentAd === 'function' && player.currentAd()) {
                    isAd = true;
                }
            }
            if (!isAd) {
                const activeAdEl = document.querySelector(
                    '.vjs-ad-playing, .vjs-ad-loading',
                );
                if (activeAdEl && (activeAdEl as HTMLElement).offsetParent !== null) {
                    isAd = true;
                }
            }

            if (isAd !== this.lastAdState) {
                this.lastAdState = isAd;
                this.logger.info('TVer-AI-Sub', `TVer Ad State changed: ${isAd} for movie ${currentEpId}`);
                window.postMessage(
                    {
                        type: NCW_MESSAGE_TYPES.AD_STATE_CHANGED,
                        isAd,
                        movieId: currentEpId || undefined,
                    },
                    '*',
                );
            }

            if (isAd) return;

            // 2. Playback Presentation Time Synchronization (Type 4 Dataset)
            if (video && currentEpId) {
                let curTime = 0;
                if (player && typeof player.currentContentTime === 'function') {
                    try {
                        const t = player.currentContentTime();
                        if (typeof t === 'number' && !isNaN(t) && t >= 0) curTime = t;
                    } catch {}
                }
                if (!curTime && player && typeof player.currentTime === 'function') {
                    try {
                        const t = player.currentTime();
                        if (typeof t === 'number' && !isNaN(t) && t >= 0) curTime = t;
                    } catch {}
                }
                if (!curTime && typeof video.currentTime === 'number') {
                    curTime = video.currentTime;
                }

                const isPaused = video.paused;
                const playbackRate = video.playbackRate || 1.0;
                const nowPerf = performance.now();

                // 2.1 Authoritative Type 4 DOM Dataset write
                PlaybackDatasetHelper.write({
                    movieId: currentEpId,
                    currentTime: curTime,
                    syncAt: nowPerf,
                    isPaused,
                    playbackRate,
                });
                if (typeof document !== 'undefined' && document.documentElement) {
                    document.documentElement.dataset.ncwIsLive = this.isLiveStream() ? 'true' : 'false';
                }

                // 2.2 Low-frequency event sync when time shifts significantly
                if (
                    this.lastReportedTime === null ||
                    Math.abs(curTime - this.lastReportedTime) > 0.5
                ) {
                    this.lastReportedTime = curTime;
                    window.postMessage(
                        {
                            type: NCW_MESSAGE_TYPES.TIME_SYNC,
                            movieId: currentEpId,
                            segmentTime: curTime,
                            syncAt: nowPerf,
                            isPaused,
                            playbackRate,
                            cadmiumOffset: 0,
                            adOffset: 0,
                        },
                        '*',
                    );
                }
            }

            // Check metadata trigger
            this.triggerMetadataFetchIfReady();

            // Check text track changes
            this.checkTVerTextTracks();

            // Attempt extraction if not yet cached or if live stream
            if (currentEpId && (this.isLiveStream() || !this.trackRegistry.getCachedTrack(currentEpId))) {
                this.tryExtractFromTextTracks();
            }
        } catch {}
    }

    private isLiveStream(): boolean {
        const url = window.location.href;
        if (url.includes('/live/') || url.includes('simul')) return true;
        const video = this.getVideoElement();
        if (video && (video.duration === Infinity || (video.duration > 0 && !isFinite(video.duration)))) return true;
        const player = this.getTVerPlayer();
        const adFields = player?.getMedia?.()?.adFields as Record<string, unknown> | undefined;
        if (adFields && (adFields.c === 'simul' || adFields.type === 'live')) return true;
        return false;
    }

    private notifySubtitleUpdated(movieId: string): void {
        if (!movieId) return;
        if (this.subtitleUpdateDebounceTimer) {
            clearTimeout(this.subtitleUpdateDebounceTimer);
        }
        this.subtitleUpdateDebounceTimer = setTimeout(() => {
            this.subtitleUpdateDebounceTimer = null;
            this.logger.info(
                'TVer-AI-Sub',
                `Posting SUBTITLE_UPDATED for ${movieId}`,
            );
            window.postMessage(
                {
                    type: NCW_MESSAGE_TYPES.SUBTITLE_UPDATED,
                    movieId,
                    timestamp: Date.now(),
                },
                '*',
            );
        }, 300);
    }

    private checkTVerTextTracks(): void {
        try {
            const video = this.getVideoElement();
            const player = this.getTVerPlayer();

            const rawTrackList = (
                player && typeof player.textTracks === 'function'
                    ? (player.textTracks() as { tracks_?: TVerTextTrackLike[] })?.tracks_ || player.textTracks()
                    : video && video.textTracks ? video.textTracks : null
            ) as ArrayLike<TVerTextTrackLike> | null;

            if (!rawTrackList) return;

            const length = typeof rawTrackList.length === 'number' ? rawTrackList.length : 0;
            if (length === 0) return;

            let activeTrack: TVerTextTrackLike | null = null;
            let activeTrackIndex = -1;

            for (let i = 0; i < length; i++) {
                const track = rawTrackList[i];
                if (!track) continue;

                const src = (track.src || '').toLowerCase();
                if (src.includes('thumbnail')) continue;

                const kind = (track.kind || '').toLowerCase();
                if (kind === 'metadata' || kind === 'chapters') continue;

                if (track.mode === 'showing') {
                    activeTrack = track;
                    activeTrackIndex = i;
                    break;
                }
            }

            const currentEpId =
                this.lastObservedEpisodeId || this.extractEpisodeId(window.location.href) || '';

            if (activeTrack) {
                const trackSig = String(
                    activeTrack.id ||
                        activeTrack.label ||
                        activeTrack.language ||
                        activeTrackIndex,
                );
                if (this.lastTrackState !== trackSig) {
                    this.logger.info(
                        'TVer-AI-Sub',
                        `Subtitle track changed on TVer: "${this.lastTrackState}" -> "${trackSig}". Extracting...`,
                    );
                    this.lastTrackState = trackSig;
                    this.tryExtractFromTextTracks(true);
                }
            } else {
                if (this.lastTrackState && this.lastTrackState !== '__OFF__') {
                    this.logger.info(
                        'TVer-AI-Sub',
                        'All subtitle tracks disabled on TVer. Posting SUBTITLE_OFF.',
                    );
                    this.lastTrackState = '__OFF__';
                    window.postMessage(
                        {
                            type: NCW_MESSAGE_TYPES.SUBTITLE_OFF,
                            movieId: currentEpId,
                            timestamp: Date.now(),
                        },
                        '*',
                    );
                }
            }
        } catch (e) {
            this.logger.warn('TVer-AI-Sub', 'Error in checkTVerTextTracks:', e);
        }
    }

    private tryExtractFromTextTracks(force = false): boolean {
        const currentEpId =
            this.lastObservedEpisodeId || this.extractEpisodeId(window.location.href);
        if (!currentEpId) return false;

        this.trackRegistry
            .extractOrUpdateFromPlayerTracks(currentEpId, this.getTVerPlayer(), this.getVideoElement())
            .then(({ detail, hasNewCues }) => {
                if (detail && detail.rawText) {
                    if (hasNewCues) {
                        this.notifySubtitleUpdated(currentEpId);
                    }
                    this.emitSubtitleData(
                        detail.url || 'streaksplayer-track',
                        detail.rawText,
                        force,
                        currentEpId,
                        detail.lang,
                    );
                }
            });
        return true;
    }

    // --------------------------------------------------------------------------
    // 6. Metadata Handling
    // --------------------------------------------------------------------------

    private triggerMetadataFetchIfReady(): void {
        try {
            const player = this.getTVerPlayer();
            const adFields = player?.getMedia?.()?.adFields || {};
            const seriesId = adFields.ad_series_id;
            const currentEpId =
                this.lastObservedEpisodeId || this.extractEpisodeId(window.location.href);

            if (!seriesId || !currentEpId) return;

            // If already cached, no need to re-fetch
            if (this.metadataManager.isEpisodeCached(currentEpId)) {
                return;
            }

            this.metadataManager.fetchSeriesEpisodes(seriesId, currentEpId).then((payload) => {
                if (payload) {
                    window.postMessage(payload, '*');
                    this.logger.info(
                        'TVer-AI-Sub',
                        `Dispatched METADATA_LOADED for movie: ${payload.movieId} (Series "${payload.showTitle}")`,
                    );
                }
            });
        } catch {}
    }

    private handleSeriesEpisodesApiResponse(
        data: TVerSeriesEpisodesResponse,
    ): void {
        const currentEpId =
            this.lastObservedEpisodeId || this.extractEpisodeId(window.location.href);
        const payload = this.metadataManager.handleSeriesEpisodesResponse(data, currentEpId);
        if (payload) {
            window.postMessage(payload, '*');
            this.logger.info(
                'TVer-AI-Sub',
                `Dispatched METADATA_LOADED from API response: Series "${payload.showTitle}" [${payload.showId}]`,
            );
        }
    }

    // --------------------------------------------------------------------------
    // 7. Message Listener (ISOLATED World -> MAIN World)
    // --------------------------------------------------------------------------

    private setupMessageListener(): void {
        const handler = async (event: MessageEvent) => {
            if (event.source !== window || !event.data) return;
            const data: InjectedIncomingEvent = event.data;

            // 7.1 Legacy Subtitle Retry (Backward Compatibility)
            if (data.type === NCW_MESSAGE_TYPES.REQUEST_SUBTITLE_RETRY) {
                const currentEpId =
                    this.lastObservedEpisodeId || this.extractEpisodeId(window.location.href);
                this.lastEmittedSignature = '';
                if (currentEpId) {
                    const cached = this.trackRegistry.getCachedTrack(currentEpId);
                    if (cached && cached.rawText) {
                        this.emitSubtitleData(
                            cached.url || 'cached-track',
                            cached.rawText,
                            true,
                            currentEpId,
                            cached.lang,
                        );
                        return;
                    }
                }
                this.tryExtractFromTextTracks(true);
            }

            // 7.2 Legacy Request Metadata (Backward Compatibility)
            if (data.type === NCW_MESSAGE_TYPES.REQUEST_METADATA) {
                const targetEpId =
                    data.movieId ||
                    this.lastObservedEpisodeId ||
                    this.extractEpisodeId(window.location.href);
                if (targetEpId) {
                    const cachedMeta = this.metadataManager.getCachedMetadata(targetEpId);
                    if (cachedMeta) {
                        const payload: InjectedMetadataLoadedPayload = {
                            type: NCW_MESSAGE_TYPES.METADATA_LOADED,
                            movieId: targetEpId,
                            showId: cachedMeta.showId || targetEpId,
                            showTitle: cachedMeta.mainTitle,
                            isLive: this.isLiveStream(),
                            currentEpisode: {
                                episodeId: targetEpId,
                                episodeTitle: cachedMeta.episodeTitle || '',
                                episodeSynopsis: cachedMeta.episodeSummary || '',
                            },
                        };
                        window.postMessage(payload, '*');
                    }
                }
            }

            // 7.3 Tri-State Query Metadata (Type 2)
            if (data.type === NCW_MESSAGE_TYPES.QUERY_METADATA) {
                const queryId = data.queryId;
                const targetEpId =
                    data.movieId ||
                    this.lastObservedEpisodeId ||
                    this.extractEpisodeId(window.location.href);

                const respond = (
                    status: 'resolved' | 'null' | 'undefined',
                    metadata?: VideoMetadata,
                ) => {
                    window.postMessage(
                        {
                            type: NCW_MESSAGE_TYPES.QUERY_METADATA_RESULT,
                            queryId,
                            status,
                            movieId: targetEpId || undefined,
                            metadata,
                        },
                        '*',
                    );
                };

                if (!targetEpId) {
                    respond('undefined');
                    return;
                }

                const player = this.getTVerPlayer();
                const playerSeriesId = player?.getMedia?.()?.adFields?.ad_series_id || null;
                const result = this.metadataManager.getMetadata(targetEpId, playerSeriesId);
                if (result.metadata) {
                    result.metadata.isLive = this.isLiveStream();
                }

                respond(result.status, result.metadata);
            }

            // 7.4 Tri-State Query Subtitle (Type 2)
            if (data.type === NCW_MESSAGE_TYPES.QUERY_SUBTITLE) {
                const queryId = data.queryId;
                const targetEpId =
                    data.movieId ||
                    this.lastObservedEpisodeId ||
                    this.extractEpisodeId(window.location.href);

                const respond = (
                    status: 'resolved' | 'null' | 'undefined',
                    payload?: { rawText: string; bcp: string },
                ) => {
                    window.postMessage(
                        {
                            type: NCW_MESSAGE_TYPES.QUERY_SUBTITLE_RESULT,
                            queryId,
                            status,
                            movieId: targetEpId || undefined,
                            rawText: payload?.rawText,
                            bcp: payload?.bcp,
                        },
                        '*',
                    );
                };

                if (!targetEpId) {
                    respond('undefined');
                    return;
                }

                const track = await this.trackRegistry.getTrack(
                    targetEpId,
                    'ja',
                    this.getTVerPlayer(),
                    this.getVideoElement(),
                );

                if (track && track.rawText) {
                    respond('resolved', {
                        rawText: track.rawText,
                        bcp: track.lang || 'ja',
                    });
                } else if (track === null) {
                    respond('null');
                } else {
                    respond('undefined');
                }
            }
        };

        window.addEventListener('message', handler);
        this.cleanupMessageListener = () => {
            window.removeEventListener('message', handler);
        };
    }
}
