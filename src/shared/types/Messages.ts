import { ContextDTO } from '../domain/entities/Context';
import {
    CharacterGlossaryMap,
    TermGlossaryMap,
} from '../domain/entities/Glossary';

import {
    SubtitleCue,
    MergeAsrCueItem,
    TrackCacheRecord,
} from '../domain/entities/Subtitle';
import { LanguageInfo } from '../domain/value-objects/Language';

/**
 * Standardized Subtitle Cue payload for translation and review pipelines.
 * Unified with the SubtitleCue domain model.
 */
export type TranslateCueItem = SubtitleCue;
export type ReviewCueItem = SubtitleCue;
export type PrecedingContextItem = SubtitleCue;

import { VocabWordItem, EpisodeVocabData } from '../domain/entities/Vocabulary';
import {
    SubtitleToken,
    LearningCueItem,
    WordLookupRequest,
    WordLookupResult,
} from '../domain/entities/SubtitleLearning';
import {
    WatchSession,
    ShowWatchSummary,
    WatchHistoryStats,
    DailyWatchStat,
    ShowEpisodeProgress,
} from '../domain/entities/WatchHistory';
import { CredentialVaultStatus } from '../domain/entities/CredentialVault';

export {
    VocabWordItem,
    EpisodeVocabData,
    TrackCacheRecord,
    MergeAsrCueItem,
    SubtitleToken,
    LearningCueItem,
    WordLookupRequest,
    WordLookupResult,
    WatchSession,
    ShowWatchSummary,
    WatchHistoryStats,
    DailyWatchStat,
    ShowEpisodeProgress,
    CredentialVaultStatus,
};

export interface OpenRouterModelItem {
    id: string;
    name: string;
    contextLength?: number;
    promptPrice?: number;
    completionPrice?: number;
}

// ==========================================
// Strongly-Typed Bus Messages & Requests
// ==========================================

import {
    BatchTranslationResult,
    CueCorrectionMap,
    SubtitleCueCacheMap,
    OpenRouterCheckResult,
} from '../domain/entities/PipelineTypes';
import { ExtensionSettings } from '../domain/constants/SettingsDefaults';
import { StreamingPlatformId } from '../domain/constants/StreamingPlatforms';
import { AiSubState } from '@shared/domain/entities/AiSubState';

export type MessagePayloadMap = {
    // AI Sub State Service
    NCW_GET_AI_SUB_STATE: {
        request: void;
        response: { success: boolean; state: AiSubState };
    };
    NCW_SET_AI_SUB_ENABLED: {
        request: { enabled: boolean; platform?: StreamingPlatformId };
        response: { success: boolean; state: AiSubState };
    };
    NCW_PUSH_AI_SUB_STATE_CHANGED: {
        request: { state: AiSubState };
        response: void;
    };

    // Glossary Service
    NCW_GET_CONTEXT: {
        request: {
            tabId?: number;
            showId?: string;
            targetLanguage?: LanguageInfo;
        };
        response: { success: boolean; context: ContextDTO | null };
    };
    NCW_WARMUP_CONTEXT: {
        request: {
            title: string;
            mainTitle: string;
            sampleDialogues: string;
            videoId: string;
            showId?: string;
            seasonId?: string;
            showSummary?: string;
            episodeSummary?: string;
            tabId?: number;
        };
        response: {
            success: boolean;
            context: ContextDTO | null;
            cached: boolean;
            error?: string;
        };
    };
    NCW_UPDATE_TERM: {
        request: {
            key: string;
            value: string;
            showId: string;
            targetLanguage: LanguageInfo;
        };
        response: {
            success: boolean;
            context: ContextDTO | null;
            error?: string;
        };
    };
    NCW_DELETE_TERM: {
        request: { key: string; showId: string; targetLanguage: LanguageInfo };
        response: { success: boolean; context: ContextDTO | null };
    };
    NCW_UPDATE_CHARACTER: {
        request: {
            name: string;
            canonical: string;
            aliases?: string[];
            showId: string;
            targetLanguage: LanguageInfo;
        };
        response: { success: boolean; context: ContextDTO | null };
    };
    NCW_DELETE_CHARACTER: {
        request: { name: string; showId: string; targetLanguage: LanguageInfo };
        response: { success: boolean; context: ContextDTO | null };
    };
    NCW_RESET_CONTEXT: {
        request: { showId: string; targetLanguage: LanguageInfo };
        response: { success: boolean; context: ContextDTO };
    };
    NCW_SWITCH_LANGUAGE: {
        request: { targetLanguage: LanguageInfo };
        response: { success: boolean; context: ContextDTO };
    };
    NCW_UNLOAD_CONTEXT: {
        request: { showId: string; targetLanguage: LanguageInfo };
        response: { success: boolean };
    };
    NCW_PUSH_GLOSSARY_CHANGED: {
        request: { context: ContextDTO };
        response: void;
    };
    NCW_PUSH_CUES_STALE: {
        request: {
            trackHash?: string;
            cacheKey?: string;
            movieId?: string;
            movieIds?: string[];
            showTitle?: string;
            showId?: string;
            invalidatedCount?: number;
        };
        response: void;
    };

    // Subtitle Translation Pipeline
    NCW_MERGE_ASR_BATCH: {
        request: {
            items: MergeAsrCueItem[];
        };
        response: {
            success: boolean;
            mergedCues?: MergeAsrCueItem[];
            error?: string;
        };
    };
    NCW_TRANSLATE_BATCH: {
        request: {
            items: TranslateCueItem[];
            contextItems?: PrecedingContextItem[];
            trackHash?: string;
            showId?: string;
            movieId?: string;
            mainTitle?: string;
            urgent?: boolean;
        };
        response: {
            success: boolean;
            results?: BatchTranslationResult;
            error?: string;
        };
    };
    NCW_SUPERVISOR_REVIEW: {
        request: {
            items: ReviewCueItem[];
            contextItems?: PrecedingContextItem[];
            trackHash?: string;
            showId?: string;
            movieId?: string;
            mainTitle?: string;
            status?: 'reviewed' | 'pre_reviewed';
        };
        response: {
            success: boolean;
            corrections?: CueCorrectionMap;
            usedTermsMap?: Record<number, Record<string, number>>;
            updatedContext?: ContextDTO;
            error?: string;
        };
    };
    NCW_GET_SUBTITLE_CACHE: {
        request: {
            trackHash: string;
            movieId?: string;
            targetLanguage?: string;
        };
        response: {
            success: boolean;
            hit: boolean;
            cachedCues?: SubtitleCueCacheMap;
            vocabScannedChunks?: string[];
            error?: string;
        };
    };
    NCW_SAVE_SUBTITLE_CACHE: {
        request: {
            trackHash: string;
            movieId: string;
            showTitle?: string;
            targetLanguage: string;
            provider?: string;
            translationModel?: string;
            supervisorModel?: string;
            results: Record<string | number, string>;
        };
        response: {
            success: boolean;
            error?: string;
        };
    };
    NCW_MARK_CUES_STALE: {
        request: {
            trackHash?: string;
            cacheKey?: string;
            movieId?: string;
            movieIds?: string[];
            showTitle?: string;
            showId?: string;
            startTime?: number;
            endTime?: number;
        };
        response: {
            success: boolean;
            invalidatedCount: number;
            error?: string;
        };
    };
    NCW_CLEAR_QUEUES: {
        request: void;
        response: { success: boolean };
    };
    NCW_EPISODE_CHANGED: {
        request: {
            showId: string;
            targetLanguage: LanguageInfo;
            title?: string;
            mainTitle?: string;
            showSynopsis?: string;
            episodeSynopsis?: string;
            episodeId?: string;
            episodeNumber?: string;
            seasonId?: string;
        };
        response: { success: boolean };
    };

    // Vocabulary Collector
    NCW_FEED_VOCAB_CUES: {
        request: {
            movieId: string;
            cues: TranslateCueItem[];
            showTitle: string;
            sourceLanguage?: LanguageInfo | 'auto';
            trackHash?: string;
        };
        response: { success: boolean };
    };
    NCW_GET_VOCAB_DATA: {
        request: { movieId?: string };
        response: { success: boolean; data: EpisodeVocabData | null };
    };
    NCW_RESET_VOCAB_DATA: {
        request: { movieId: string };
        response: { success: boolean };
    };
    NCW_SAVE_USER_VOCAB_WORD: {
        request: {
            movieId: string;
            showTitle?: string;
            wordItem: VocabWordItem;
        };
        response: { success: boolean; data?: VocabWordItem; error?: string };
    };
    NCW_DELETE_USER_VOCAB_WORD: {
        request: {
            movieId: string;
            word: string;
        };
        response: { success: boolean; error?: string };
    };
    NCW_LOOKUP_WORD_DEFINITION: {
        request: WordLookupRequest;
        response: { success: boolean; data?: WordLookupResult; error?: string };
    };
    NCW_GET_PHONETIC_READING: {
        request: {
            word: string;
            lang: string;
            system?: string;
        };
        response: { success: boolean; reading: string; error?: string };
    };
    NCW_GET_PHONETIC_BATCH: {
        request: {
            words: string[];
            lang: string;
            system?: string;
        };
        response: {
            success: boolean;
            readings: Record<string, string>;
            error?: string;
        };
    };

    // Connection Checks
    NCW_CHECK_OLLAMA: {
        request: void;
        response: {
            success: boolean;
            data?: Array<{ name: string }>;
            error?: string;
        };
    };
    NCW_CHECK_OPENROUTER: {
        request: void;
        response: {
            success: boolean;
            data?: OpenRouterCheckResult;
            error?: string;
        };
    };
    NCW_FETCH_OPENROUTER_MODELS: {
        request: void;
        response: {
            success: boolean;
            models?: OpenRouterModelItem[];
            error?: string;
        };
    };

    // Settings
    NCW_GET_SETTINGS: {
        request: void;
        response: { success: boolean; settings: ExtensionSettings };
    };
    NCW_SAVE_SETTINGS: {
        request: { settings: Partial<ExtensionSettings> };
        response: { success: boolean; settings: ExtensionSettings };
    };
    // Secure Credentials & Vault
    NCW_GET_CREDENTIAL_STATUS: {
        request: void;
        response: { success: boolean; status: CredentialVaultStatus };
    };
    NCW_SAVE_CREDENTIALS: {
        request: {
            apiKey?: string;
            masterPassword?: string;
            enableEncryption?: boolean;
        };
        response: {
            success: boolean;
            status?: CredentialVaultStatus;
            error?: string;
        };
    };
    NCW_UNLOCK_CREDENTIALS: {
        request: { password: string };
        response: { success: boolean; error?: string };
    };
    NCW_CANCEL_UNLOCK: {
        request: void;
        response: { success: boolean };
    };
    NCW_LOCK_CREDENTIALS: {
        request: void;
        response: { success: boolean };
    };
    NCW_DISABLE_CREDENTIAL_ENCRYPTION: {
        request: { password: string };
        response: { success: boolean; error?: string };
    };
    NCW_CLEAR_CREDENTIALS: {
        request: void;
        response: { success: boolean };
    };
    NCW_PUSH_SETTINGS_CHANGED: {
        request: { settings: ExtensionSettings };
        response: void;
    };

    // Vocab Push
    NCW_PUSH_VOCAB_CHANGED: {
        request: { data: EpisodeVocabData };
        response: void;
    };

    // AI Helper & Glossary Extraction
    NCW_GET_AI_CAPABILITY: {
        request: void;
        response: {
            success: boolean;
            hasAi: boolean;
            provider?: string;
            model?: string;
            isSupervisor: boolean;
            error?: string;
        };
    };
    NCW_EXTRACT_GLOSSARY_BILINGUAL: {
        request: {
            sourceText: string;
            targetText: string;
            targetLang: LanguageInfo;
        };
        response: {
            success: boolean;
            data?: {
                characters: CharacterGlossaryMap;
                terms: TermGlossaryMap;
            };
            error?: string;
        };
    };
    NCW_EXTRACT_GLOSSARY_AND_TRANSLATE: {
        request: {
            sourceText: string;
            targetLang: LanguageInfo;
        };
        response: {
            success: boolean;
            data?: {
                characters: CharacterGlossaryMap;
                terms: TermGlossaryMap;
            };
            error?: string;
        };
    };
    NCW_BULK_UPDATE_GLOSSARY: {
        request: {
            showId: string;
            targetLanguage: LanguageInfo;
            characters?: CharacterGlossaryMap;
            terms?: TermGlossaryMap;
        };
        response: {
            success: boolean;
            context?: ContextDTO;
            error?: string;
        };
    };
    NCW_EXTRACT_NATIVE_TERMS: {
        request: {
            showId: string;
            targetLanguage: LanguageInfo;
            pairs: Array<{ originalText: string; translatedText: string }>;
        };
        response: {
            success: boolean;
            charactersAdded: number;
            termsAdded: number;
            error?: string;
        };
    };
    NCW_HEARTBEAT: {
        request: {
            showId?: string | null;
            videoId?: string | null;
            targetLanguage?: LanguageInfo;
            tabId?: number;
        };
        response: {
            success: boolean;
        };
    };
    NCW_RECORD_WATCH_SESSION: {
        request: {
            session: WatchSession;
        };
        response: {
            success: boolean;
            error?: string;
        };
    };
    NCW_GET_WATCH_HISTORY: {
        request: void;
        response: {
            success: boolean;
            shows: ShowWatchSummary[];
            recentSessions: WatchSession[];
            stats: WatchHistoryStats;
            error?: string;
        };
    };
    NCW_CLEAR_WATCH_HISTORY: {
        request: void;
        response: {
            success: boolean;
            error?: string;
        };
    };
    NCW_DELETE_SHOW_HISTORY: {
        request: {
            showId: string;
        };
        response: {
            success: boolean;
            error?: string;
        };
    };
};

export type MessageType = keyof MessagePayloadMap;
