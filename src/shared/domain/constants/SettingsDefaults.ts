export interface PipelineConfig {
    minTranslateCues: number;
    maxTranslateCues: number;
    refillThreshold: number;
    reviewBatchSize: number;
}

import { LLMProvider, TranslationProvider } from '../entities/PipelineTypes';
import { Language, LanguageInfo } from '../value-objects/Language';
import { STREAMING_PLATFORMS, StreamingPlatformId } from './StreamingPlatforms';
import {
    FrictionScreenType,
    FrictionUnlockDifficulty,
    FrictionPlatformRule,
} from '../entities/ViewingFriction';

export type CacheRetentionPeriod = '1w' | '1m' | '1y';

export type ChinesePhoneticSystem = 'pinyin' | 'zhuyin';
export type KoreanPhoneticSystem = 'default' | 'hyphenated';

export interface ExtensionSettings {
    enabled: boolean;
    platformEnabled?: Partial<Record<StreamingPlatformId, boolean>>;
    uiLanguage: 'en' | 'zh' | 'ja' | 'ko';
    ollamaHost: string;
    ollamaModel: string;
    translationModel: string;
    supervisorModel: string;
    enableSupervisor: boolean;
    targetLanguage: LanguageInfo;
    displayMode: 'bilingual' | 'translated' | 'original';

    ollamaMinTranslateCues: number;
    ollamaMaxTranslateCues: number;
    ollamaRefillThreshold: number;
    ollamaReviewBatchSize: number;

    openrouterMinTranslateCues: number;
    openrouterMaxTranslateCues: number;
    openrouterRefillThreshold: number;
    openrouterReviewBatchSize: number;

    minTranslateCues: number;
    translateBatchSize: number;
    refillThreshold: number;
    subChunkSize: number;
    reviewBatchSize: number;
    fontSize: number;
    bgOpacity: number;
    translationOpacity: number;
    enableAnimation: boolean;
    enableGlassEffect: boolean;
    subOffsetBottom: number;
    showOriginalSmaller: boolean;
    swapSubtitleOrder: boolean;
    hideNativeSubtitles: boolean;
    enableDomSubtitleSync: boolean;
    subSyncOffset: number;

    aiProvider: TranslationProvider;
    openrouterApiKey: string;
    openrouterBaseUrl: string;
    openrouterTranslationModel: string;
    openrouterSupervisorModel: string;

    vocabExtractorEnabled: boolean;
    vocabExtractorProvider: LLMProvider;
    vocabExtractorModel: string;
    vocabExtractorOllamaModel: string;
    vocabExtractorDifficulty: 'easy' | 'medium' | 'hard'; // This should have a domain entity/vo.
    vocabSourceLanguage: LanguageInfo | 'auto';
    vocabExtractorCustomPrompt: string;

    preferNativeSubtitles: boolean;
    extractTermsFromNativeSubtitles: boolean;

    enableAutomaticAsrMerging: boolean;
    asrMergeBatchSize: number;
    asrSilenceThresholdMs: number;

    enableSubtitleLearning: boolean;
    autoPauseOnTokenClick: boolean;
    chinesePhoneticSystem: ChinesePhoneticSystem;
    koreanPhoneticSystem: KoreanPhoneticSystem;
    recordVocabAsLemma: boolean;
    cacheRetention: CacheRetentionPeriod;

    // Viewing Static Friction & Health Guard
    staticFrictionEnabled: boolean;
    frictionIntervalMinutes: number;
    frictionDailyLimitMinutes: number;
    frictionCurfewEnabled: boolean;
    frictionCurfewTime: string;
    frictionScreenType: FrictionScreenType;
    frictionBreakDurationSeconds: number;
    frictionUnlockDifficulty: FrictionUnlockDifficulty;
    frictionAutoResumeOnTimer: boolean;
    frictionEnableLlmAdvice: boolean;
    frictionExcludedPlatforms: string[];
    frictionPlatformRules: Record<string, FrictionPlatformRule>;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
    enabled: true,
    platformEnabled: {
        [STREAMING_PLATFORMS.NETFLIX]: true,
        [STREAMING_PLATFORMS.TVER]: true,
        [STREAMING_PLATFORMS.YOUTUBE]: true,
    },
    uiLanguage: 'en',
    ollamaHost: 'http://localhost:11434',
    ollamaModel: 'translategemma:4b',
    translationModel: 'translategemma:4b',
    supervisorModel: 'translategemma:4b',
    enableSupervisor: true,
    targetLanguage: Language.DEFAULT,
    displayMode: 'bilingual',
    ollamaMinTranslateCues: 1,
    ollamaMaxTranslateCues: 30,
    ollamaRefillThreshold: 10,
    ollamaReviewBatchSize: 8,

    openrouterMinTranslateCues: 1,
    openrouterMaxTranslateCues: 100,
    openrouterRefillThreshold: 20,
    openrouterReviewBatchSize: 20,

    minTranslateCues: 1,
    translateBatchSize: 30,
    refillThreshold: 10,
    subChunkSize: 8,
    reviewBatchSize: 8,
    fontSize: 26,
    bgOpacity: 0.0,
    translationOpacity: 1.0,
    enableAnimation: false,
    enableGlassEffect: false,
    subOffsetBottom: 80,
    showOriginalSmaller: true,
    swapSubtitleOrder: false,
    hideNativeSubtitles: true,
    enableDomSubtitleSync: false,
    subSyncOffset: 0,

    enableAutomaticAsrMerging: true,
    asrMergeBatchSize: 20,
    asrSilenceThresholdMs: 450,

    aiProvider: 'google',
    openrouterApiKey: '',
    openrouterBaseUrl: 'https://openrouter.ai/api/v1',
    openrouterTranslationModel: 'deepseek/deepseek-chat',
    openrouterSupervisorModel: 'google/gemini-2.5-flash',

    vocabExtractorEnabled: false,
    vocabExtractorProvider: 'openrouter',
    vocabExtractorModel: 'deepseek/deepseek-chat',
    vocabExtractorOllamaModel: 'qwen2.5:7b',
    vocabExtractorDifficulty: 'medium',
    vocabSourceLanguage: 'auto',
    vocabExtractorCustomPrompt: '',

    preferNativeSubtitles: true,
    extractTermsFromNativeSubtitles: false,

    enableSubtitleLearning: false,
    autoPauseOnTokenClick: true,
    chinesePhoneticSystem: 'pinyin',
    koreanPhoneticSystem: 'default',
    recordVocabAsLemma: true,
    cacheRetention: '1m',

    // Viewing Static Friction & Health Guard (default: disabled)
    staticFrictionEnabled: false,
    frictionIntervalMinutes: 45,
    frictionDailyLimitMinutes: 180,
    frictionCurfewEnabled: false,
    frictionCurfewTime: '23:30',
    frictionScreenType: 'screensaver',
    frictionBreakDurationSeconds: 20,
    frictionUnlockDifficulty: 'none',
    frictionAutoResumeOnTimer: true,
    frictionEnableLlmAdvice: true,
    frictionExcludedPlatforms: [],
    frictionPlatformRules: {},
};

export const PROVIDER_PRESETS: Record<string, PipelineConfig> = {
    google: {
        minTranslateCues: 1,
        maxTranslateCues: 20,
        refillThreshold: 8,
        reviewBatchSize: 0,
    },
    ollama: {
        minTranslateCues: 1,
        maxTranslateCues: 30,
        refillThreshold: 10,
        reviewBatchSize: 8,
    },
    openrouter: {
        minTranslateCues: 1,
        maxTranslateCues: 100,
        refillThreshold: 20,
        reviewBatchSize: 20,
    },
};

export function getPipelineConfig(
    settings?: Partial<ExtensionSettings>,
): PipelineConfig {
    const s = settings || {};
    const provider = s.aiProvider || 'google';
    const presets = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.google;

    if (provider === 'google') {
        return {
            minTranslateCues: 1,
            maxTranslateCues: 50,
            refillThreshold: 15,
            reviewBatchSize: 0,
        };
    } else if (provider === 'openrouter') {
        return {
            minTranslateCues:
                typeof s.openrouterMinTranslateCues === 'number'
                    ? s.openrouterMinTranslateCues
                    : presets.minTranslateCues,
            maxTranslateCues:
                typeof s.openrouterMaxTranslateCues === 'number'
                    ? s.openrouterMaxTranslateCues
                    : presets.maxTranslateCues,
            refillThreshold:
                typeof s.openrouterRefillThreshold === 'number'
                    ? s.openrouterRefillThreshold
                    : presets.refillThreshold,
            reviewBatchSize:
                typeof s.openrouterReviewBatchSize === 'number'
                    ? s.openrouterReviewBatchSize
                    : presets.reviewBatchSize,
        };
    } else {
        return {
            minTranslateCues:
                typeof s.ollamaMinTranslateCues === 'number'
                    ? s.ollamaMinTranslateCues
                    : typeof s.minTranslateCues === 'number'
                      ? s.minTranslateCues
                      : presets.minTranslateCues,
            maxTranslateCues:
                typeof s.ollamaMaxTranslateCues === 'number'
                    ? s.ollamaMaxTranslateCues
                    : typeof s.translateBatchSize === 'number'
                      ? s.translateBatchSize
                      : presets.maxTranslateCues,
            refillThreshold:
                typeof s.ollamaRefillThreshold === 'number'
                    ? s.ollamaRefillThreshold
                    : typeof s.refillThreshold === 'number'
                      ? s.refillThreshold
                      : presets.refillThreshold,
            reviewBatchSize:
                typeof s.ollamaReviewBatchSize === 'number'
                    ? s.ollamaReviewBatchSize
                    : typeof s.reviewBatchSize === 'number'
                      ? s.reviewBatchSize
                      : presets.reviewBatchSize,
        };
    }
}
