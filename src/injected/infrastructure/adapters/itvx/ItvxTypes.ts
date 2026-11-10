/**
 * ITVX Injected Adapter Type Definitions
 */

export interface ItvxNextDataEpisode {
    ccid?: string;
    episode?: number;
    episodeId?: string; // e.g. "10/6587/0001"
    encodedEpisodeId?: {
        letterA?: string; // e.g. "10a6587a0001"
        underscore?: string; // e.g. "10_6587_0001"
    };
    episodeTitle?: string;
    description?: string;
    longDescription?: string;
    playlistUrl?: string;
    productionId?: string;
    series?: number;
    duration?: string;
    subtitled?: boolean;
}

export interface ItvxNextDataSeries {
    seriesNumber?: string | number;
    seriesLabel?: string;
    titles?: ItvxNextDataEpisode[];
}

export interface ItvxNextDataProgramme {
    ccid?: string;
    title?: string;
    titleSlug?: string;
    programmeId?: string; // e.g. "10/6587"
    encodedProgrammeId?: {
        letterA?: string; // e.g. "10a6587"
        underscore?: string; // e.g. "10_6587"
    };
    description?: string;
    longDescription?: string;
    thousandDescription?: string;
}

export interface ItvxNextDataPageProps {
    programme?: ItvxNextDataProgramme;
    seriesList?: ItvxNextDataSeries[];
}

export interface ItvxNextDataRoot {
    props?: {
        pageProps?: ItvxNextDataPageProps;
    };
}

export interface ItvxPlaylistResponse {
    StatusCode?: number;
    Playlist?: {
        Video?: {
            Duration?: string;
            Subtitles?: Array<{
                Href?: string;
            }>;
        };
        ProductionId?: string;
        ContentBreaks?: Array<{
            TimeCode?: string;
            Actions?: Array<{
                Type?: string;
                Href?: string;
            }>;
        }>;
    };
}

export interface ItvxCachedMetadata {
    showId: string;
    showTitle: string;
    showSynopsis?: string;
    episodes: Map<
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
    >;
}
