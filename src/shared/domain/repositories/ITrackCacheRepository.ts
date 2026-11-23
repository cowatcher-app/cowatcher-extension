import { TrackCacheRecord } from '../../types/Messages';
import { CachedCueEntry } from '../entities/PipelineTypes';

export interface TrackCacheQueryParams {
    trackHash: string;
    targetLanguage: string;
    provider: string;
    translationModel: string;
}

export interface SaveTranslatedCuesParams {
    trackHash: string;
    movieId: string;
    showTitle: string;
    targetLanguage: string;
    provider: string;
    translationModel: string;
    supervisorModel?: string;
    items?: Array<{ id: number; text?: string; start?: number; end?: number }>;
    results: Record<string | number, string>;
    status?: 'raw' | 'reviewed';
    usedTermsMap?: Record<number, Record<string, number>>;
}

export interface SaveReviewedCuesParams {
    trackHash: string;
    movieId: string;
    showTitle: string;
    targetLanguage: string;
    provider: string;
    translationModel: string;
    supervisorModel?: string;
    items: CachedCueEntry[];
    corrections?: Record<string | number, string>;
    status?: 'reviewed' | 'pre_reviewed';
    usedTermsMap?: Record<number, Record<string, number>>;
}

export interface MarkCuesStaleParams {
    cacheKey?: string;
    trackHash?: string;
    movieId?: string;
    movieIds?: string[];
    showTitle?: string;
    showId?: string;
    targetLanguage?: string;
    provider?: string;
    translationModel?: string;
    startTime?: number;
    endTime?: number;
}

export interface VocabScanCheckParams {
    trackHash: string;
    targetLanguage: string;
    provider: string;
    translationModel: string;
    chunkSig: string;
    cueIds?: number[];
}

export interface MarkVocabScannedParams {
    trackHash: string;
    targetLanguage: string;
    provider: string;
    translationModel: string;
    chunkSig: string;
    cueIds?: number[];
}

/**
 * Repository interface for managing track-level subtitle translation caching.
 * Decoupled from generic key-value storage (IBrowserStorage).
 */
export interface ITrackCacheRepository {
    getTrackCache(
        params: TrackCacheQueryParams | string,
    ): Promise<TrackCacheRecord | null>;
    saveTranslatedCues(params: SaveTranslatedCuesParams): Promise<boolean>;
    saveReviewedCues(params: SaveReviewedCuesParams): Promise<boolean>;
    markCuesStaleByTimeRange(params: MarkCuesStaleParams): Promise<number>;
    isVocabScanned(params: VocabScanCheckParams): Promise<boolean>;
    markVocabScanned(params: MarkVocabScannedParams): Promise<boolean>;
    getAllTrackCaches(): Promise<TrackCacheRecord[]>;
    deleteTrackCache(cacheKey: string): Promise<boolean>;
    clearAllTrackCaches(): Promise<boolean>;
    cleanExpiredRecords(retention?: '1w' | '1m' | '1y'): Promise<number>;
}
