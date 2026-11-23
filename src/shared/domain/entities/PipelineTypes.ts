import { OpenRouterModelItem } from '../../types/Messages';
import { SubtitleCue } from './Subtitle';

export type LLMProvider = 'ollama' | 'openrouter' | 'openai';
/**
 * Supported translation providers.
 */
export type TranslationProvider = 'google' | LLMProvider;

/**
 * Result of batch translation: cue ID -> translated text.
 */
export type BatchTranslationResult = Record<number, string>;

/**
 * Result of supervisor review: cue ID -> corrected translation.
 */
export type CueCorrectionMap = Record<number, string>;

/**
 * Cached subtitle cue item record.
 * Aligned with SubtitleCue domain model.
 */
export type CachedCueEntry = SubtitleCue;

/**
 * Mapping of cue IDs to their cached translation status.
 */
export type SubtitleCueCacheMap = Record<string | number, CachedCueEntry>;

/**
 * OpenRouter Account Key Information.
 */
export interface OpenRouterKeyInfo {
    label?: string;
    usage?: number;
    limit?: number | null;
    isFreeTier?: boolean;
}

/**
 * Result of OpenRouter connection verification.
 */
export interface OpenRouterCheckResult {
    keyInfo: OpenRouterKeyInfo;
    models: OpenRouterModelItem[];
}
