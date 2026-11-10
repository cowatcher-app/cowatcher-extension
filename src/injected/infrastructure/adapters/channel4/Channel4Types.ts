/**
 * Channel 4 Injected Adapter Type Definitions
 */

export interface Channel4SubtitleAsset {
    format?: string;
    url?: string;
}

export interface Channel4AdvertBreak {
    breakOffset?: number;
    resumeOffset?: number;
}

export interface Channel4Adverts {
    siteSectionId?: string;
    fwAssetId?: string;
    breaks?: Channel4AdvertBreak[];
    adServer?: string;
}

export interface Channel4VodStreamResponse {
    contractId?: number | string;
    programmeNumber?: number;
    brandTitle?: string;
    webSafeBrandTitle?: string;
    episodeTitle?: string;
    duration?: number;
    guidanceText?: string;
    programmeId?: string;
    subtitlesAssets?: Channel4SubtitleAsset[];
    adverts?: Channel4Adverts;
}

export interface Channel4WatchMoreEpisode {
    episodeTitle?: string;
    title?: string;
    summary?: string;
    description?: string;
    episodeNumber?: number;
    seriesNumber?: number;
    programmeId?: string;
}

export interface Channel4WatchMoreBrand {
    brandTitle?: string;
    title?: string;
    summary?: string;
    description?: string;
    brandId?: string | number;
    webSafeBrandTitle?: string;
}

export interface Channel4WatchMoreResponse {
    brand?: Channel4WatchMoreBrand;
    episode?: Channel4WatchMoreEpisode;
    episodes?: Channel4WatchMoreEpisode[];
    recommendations?: unknown[];
    [key: string]: unknown;
}

export interface Channel4CachedEpisode {
    videoId: string;
    episodeTitle: string;
    episodeSynopsis?: string;
    episodeNum?: number;
    seriesNum?: number;
    subtitleUrl?: string;
}

export interface Channel4CachedMetadata {
    brandId: string;
    brandTitle: string;
    brandSynopsis?: string;
    episodes: Map<string, Channel4CachedEpisode>;
}
