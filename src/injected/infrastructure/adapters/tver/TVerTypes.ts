/**
 * Strict TypeScript Definitions for TVer Web Player Runtime & API.
 * Reverse-engineered from TVer StreaksPlayer & Platform API.
 */

export interface TVerTrackDetail {
    readonly episodeId: string;
    readonly lang: string;
    readonly trackId: string;
    readonly label?: string;
    readonly kind?: string;
    readonly url?: string;
    readonly rawText: string;
    readonly interceptedAt: number;
}

export interface TVerUnknownTrackDetail {
    readonly url: string;
    readonly rawText: string;
    readonly interceptedAt: number;
}

export interface TVerEpisodeContent {
    readonly id: string;
    readonly seriesID?: string;
    readonly seriesTitle?: string;
    readonly title?: string;
    readonly broadcastDateLabel?: string;
    readonly [key: string]: unknown;
}

export interface TVerTextTrackLike {
    readonly id?: string;
    readonly label?: string;
    readonly language?: string;
    readonly kind?: string;
    readonly mode?: TextTrackMode;
    readonly src?: string;
    readonly cues_?: TextTrackCueList | readonly (TextTrackCue | VTTCue)[];
    readonly cues?: TextTrackCueList | readonly (TextTrackCue | VTTCue)[] | null;
    [key: string]: unknown;
}

export interface TVerSeriesGroup {
    readonly type?: string;
    readonly contents?: readonly {
        readonly type?: string;
        readonly content?: TVerEpisodeContent;
    }[];
}

export interface TVerSeriesEpisodesResponse {
    readonly code?: number;
    readonly message?: string;
    readonly result?: {
        readonly contents?: readonly TVerSeriesGroup[];
    };
}

export interface TVerV2EpisodeResponse {
    readonly episode?: {
        readonly id: string;
        readonly title?: string;
        readonly description?: string;
        readonly broadcast_date_label?: string;
        readonly date_label?: string;
        readonly share?: {
            readonly text?: string;
            readonly url?: string;
        };
        readonly talents?: readonly { readonly name?: string }[];
    };
    readonly season?: {
        readonly id?: string;
        readonly season_number?: number;
        readonly title?: string;
    };
    readonly series?: {
        readonly id?: string;
        readonly title?: string;
        readonly description?: string;
    };
}

export interface TVerStreaksPlayer {
    getMedia?(): {
        adFields?: {
            ad_series_id?: string;
            platformUid?: string;
            platformAdUid?: string;
            [key: string]: unknown;
        };
    };
    inAdBreak?(): boolean;
    isInAdMode?(): boolean;
    isInPreroll?(): boolean;
    currentAd?(): unknown;
    currentContentTime?(): number;
    currentTime?(): number;
    paused?(): boolean;
    playbackRate?(): number;
    textTracks?(): {
        tracks_?: TextTrack[];
        length?: number;
        [index: number]: TextTrack;
    } | TextTrackList;
}

declare global {
    interface Window {
        streaksplayer?: {
            getPlayers: () => Record<string, TVerStreaksPlayer>;
        };
        __NCW_TVER_INTERCEPTOR_INITIALIZED__?: boolean;
        __NCW_TVER_CAPTURED_TOKEN__?: {
            token: string;
            uid?: string;
            capturedAt?: number;
        };
    }
}
