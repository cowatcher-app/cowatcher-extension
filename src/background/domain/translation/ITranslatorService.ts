import { CharacterItem } from '@shared/domain/entities/Translation';
import { PrecedingContextItem } from '@shared/types/Messages';
import { MergeAsrCueItem } from '@shared/domain/entities/Subtitle';

import { Context } from '@shared/domain/entities/Context';
import { LanguageInfo } from '@shared/domain/value-objects/Language';
import { TranslationProvider } from '@shared/domain/entities/PipelineTypes';

export { MergeAsrCueItem };

export interface TranslateBatchRequest {
    items: Array<{ id: number; rawText: string }>;
    sourceLang?: LanguageInfo;
    targetLang: LanguageInfo;
    contextItems?: PrecedingContextItem[];
    context: Context | null;
    signal?: AbortSignal;
    movieId?: string;
    mainTitle?: string;
    extractGlossary?: boolean;
}

export interface TranslateBatchResponse {
    success: boolean;
    results?: Record<number, string>;
    merged?: Record<number, number[]>;
    newCharacters?: Record<string, CharacterItem>;
    newTerms?: Record<string, string>;
    error?: string;
}

export interface ReviewBatchRequest {
    items: Array<{
        id: number;
        rawText: string;
        transText: string;
        merged?: number[];
    }>;
    sourceLang?: LanguageInfo;
    targetLang: LanguageInfo;
    contextItems?: PrecedingContextItem[];
    context: Context | null;
    signal?: AbortSignal;
    movieId?: string;
    mainTitle?: string;
}

export interface ReviewBatchResponse {
    success: boolean;
    corrections?: Record<number, string>;
    newCharacters?: Record<string, CharacterItem>;
    newTerms?: Record<string, string>;
    error?: string;
}

export interface MergeAsrBatchRequest {
    items: MergeAsrCueItem[];
    signal?: AbortSignal;
}

export interface MergeAsrBatchResponse {
    success: boolean;
    mergedCues?: MergeAsrCueItem[];
    error?: string;
}

export interface HealthCheckResult {
    ok: boolean;
    message?: string;
}

export interface ITranslatorService {
    readonly providerId: TranslationProvider;

    /**
     * Async initialization for services that need to read storage/config
     */
    init?(): Promise<void>;

    /**
     * Translate a batch of subtitle cues to target language
     */
    translateBatch(req: TranslateBatchRequest): Promise<TranslateBatchResponse>;

    /**
     * Supervise and review translated cues
     */
    reviewBatch(req: ReviewBatchRequest): Promise<ReviewBatchResponse>;

    /**
     * Intelligently group and merge fragmented ASR subtitle segments into complete sentences
     */
    mergeAsrBatch?(req: MergeAsrBatchRequest): Promise<MergeAsrBatchResponse>;

    /**
     * Check connection/health of the translation service
     */
    checkHealth(): Promise<HealthCheckResult>;
}
