import { StreamingPlatformId } from '@shared/domain/constants/StreamingPlatforms';
import NCW_CONSTANTS from '@shared/utils/constants';

/**
 * Payload definitions for messages sent from Injected Script (MAIN world)
 * to Content Script (ISOLATED world) via window.postMessage.
 */
export interface InjectedSubtitleRawDataPayload {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.SUBTITLE_RAW_DATA;
    movieId: string | null;
    url: string;
    pageUrl?: string;
    rawText: string;
    bcp47?: string | null;
    timestamp: number;
    isReplay?: boolean;
    isAsr?: boolean;
}

export interface InjectedSubtitlePreloadStagedPayload {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.SUBTITLE_PRELOAD_STAGED;
    movieId: string | null;
    url: string;
    rawText: string;
    bcp47?: string | null;
    timestamp: number;
}

export interface InjectedSubtitleOffPayload {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.SUBTITLE_OFF;
    movieId?: string | null;
    timestamp: number;
}

export interface InjectedTimeSyncPayload {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.TIME_SYNC;
    movieId?: string;
    cadmiumOffset?: number;
    adOffset?: number;
    segmentTime?: number;
    syncAt?: number;
    isPaused?: boolean;
    playbackRate?: number;
    [key: string]: unknown;
}

export interface InjectedEpisodeChangedPayload {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.EPISODE_CHANGED;
    movieId: string | number;
    sessionId?: string;
    url?: string;
}

export interface InjectedUrlChangedPayload {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.URL_CHANGED;
    url: string;
}

export interface InjectedMetadataLoadedPayload {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.METADATA_LOADED;
    movieId?: string;
    showId: string;
    showTitle: string;
    showSynopsis?: string;
    seasonId?: string;
    seasonTitle?: string;
    seasonSeq?: number;
    currentEpisode?: {
        episodeId: string;
        episodeTitle: string;
        episodeSeq?: number;
        episodeSynopsis?: string;
    };
    isLive?: boolean;
    rawMetadata?: unknown;
}

export interface InjectedSubtitleUpdatedPayload {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.SUBTITLE_UPDATED;
    movieId?: string;
    timestamp: number;
}

export interface InjectedAdStateChangedPayload {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.AD_STATE_CHANGED;
    movieId?: string;
    isAd: boolean;
}

export interface InjectedNativeTrackDataPayload {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.NATIVE_TRACK_DATA;
    movieId: string;
    found: boolean;
    bcp47?: string;
    rawText?: string;
    targetLangCode?: string;
    error?: string;
}

export interface InjectedQueryMetadataResultPayload {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.QUERY_METADATA_RESULT;
    queryId: string;
    status: 'resolved' | 'null' | 'undefined';
    movieId?: string;
    metadata?: unknown;
}

export interface InjectedQuerySubtitleResultPayload {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.QUERY_SUBTITLE_RESULT;
    queryId: string;
    status: 'resolved' | 'null' | 'undefined';
    movieId?: string;
    rawText?: string;
    bcp?: string;
}

/**
 * All outgoing events that an IInjectedAdapter can post to window.
 */
export type InjectedOutgoingEvent =
    | InjectedSubtitleRawDataPayload
    | InjectedSubtitlePreloadStagedPayload
    | InjectedMetadataLoadedPayload
    | InjectedTimeSyncPayload
    | InjectedEpisodeChangedPayload
    | InjectedUrlChangedPayload
    | InjectedAdStateChangedPayload
    | InjectedNativeTrackDataPayload
    | InjectedQueryMetadataResultPayload
    | InjectedQuerySubtitleResultPayload;

/**
 * Incoming event sent from Content Script to Injected Script.
 */
export interface InjectedSubtitleRetryEvent {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.REQUEST_SUBTITLE_RETRY;
}

export interface InjectedQueryNativeTrackEvent {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.QUERY_NATIVE_TRACK;
    movieId: string;
    targetLangCode: string;
}

export interface InjectedQueryMetadataEvent {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.QUERY_METADATA;
    queryId: string;
    movieId?: string;
}

export interface InjectedQuerySubtitleEvent {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.QUERY_SUBTITLE;
    queryId: string;
    movieId?: string;
}

export interface InjectedRequestMetadataEvent {
    type: typeof NCW_CONSTANTS.MESSAGE_TYPES.REQUEST_METADATA;
    movieId?: string;
}

export type InjectedIncomingEvent =
    | InjectedSubtitleRetryEvent
    | InjectedQueryNativeTrackEvent
    | InjectedQueryMetadataEvent
    | InjectedQuerySubtitleEvent
    | InjectedRequestMetadataEvent;

/**
 * Domain interface for Platform Injected Adapters.
 *
 * Runs exclusively in the webpage's MAIN execution world (page context).
 * Its primary responsibility is to:
 * 1. Intercept network requests (fetch / XHR) or hook player APIs to capture raw subtitle tracks.
 * 2. Intercept video/show metadata APIs to extract showId, titles, synopses, and season/episode info.
 * 3. Monitor client-side SPA routing (history.pushState / popstate) and player episode switching.
 * 4. Detect and notify advertisement states and timeline synchronization offsets (if applicable).
 * 5. Dispatch standardized events to the Content Script (ISOLATED world) via window.postMessage.
 * 6. Optionally listen for `NCW_REQUEST_SUBTITLE_RETRY` to re-fetch or re-emit cached subtitles.
 *
 * Standard Message Flow:
 * - [Required] `NCW_SUBTITLE_RAW_DATA`: Emits intercepted subtitle file content (WebVTT/XML/SRT).
 * - [Required for AI Context] `NCW_METADATA_LOADED`: Emits show/episode metadata for AI context warmup.
 * - [Required] `NCW_URL_CHANGED`: Emits SPA navigation and page URL changes.
 * - [Required for Series] `NCW_EPISODE_CHANGED`: Emits in-player episode switching events.
 * - [Optional] `NCW_TIME_SYNC`: Emits player clock / subtitle timeline offsets (if offset != 0).
 * - [Optional] `NCW_AD_STATE_CHANGED`: Emits ad play/pause state for subtitle muting.
 * - [Optional] `NCW_SUBTITLE_PRELOAD_STAGED`: Emits preloaded next-episode subtitle files.
 */
export interface IInjectedAdapter {
    /**
     * Unique identifier of the streaming platform (e.g. 'netflix', 'youtube', 'disney')
     */
    readonly platformId: StreamingPlatformId;

    /**
     * Check if the current page URL matches this streaming platform.
     * @param url The current window.location.href
     */
    matches(url: string): boolean;

    /**
     * Initialize interceptors, hooks, and player listeners in the page context.
     * This is where:
     * - Network hooks (fetch / XMLHttpRequest) are registered.
     * - Route/history monitoring is attached.
     * - Player internal bridges or window globals are hooked.
     * - Window message listeners for retry requests (`NCW_REQUEST_SUBTITLE_RETRY`) are established.
     */
    initialize(): void;

    /**
     * Optional cleanup when navigating away or unmounting.
     */
    destroy?(): void;
}
