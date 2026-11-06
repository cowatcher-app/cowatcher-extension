/**
 * BackgroundMessageService
 * Central message dispatcher for the background worker.
 * Routes domain requests to their respective authoritative services.
 */

import { MessagePayloadMap } from '@shared/types/Messages';
import { AiSubStateService } from '../application/services/AiSubStateService';
import { GlossaryService } from '../application/services/GlossaryService';
import { TranslationPipelineService } from '../application/services/TranslationPipelineService';
import { VocabService } from '../application/services/VocabService';
import { LlmService } from '../application/services/LlmService';
import { ITrackCacheRepository } from '@shared/domain/repositories/ITrackCacheRepository';
import { TrackCacheRepositoryFactory } from '../infrastructure/cache/TrackCacheRepositoryFactory';
import { NCW_CONSTANTS, ExtensionSettings } from '@shared/utils/constants';
import { IBrowserStorage } from '@shared/infrastructure/storage/IBrowserStorage';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { IBrowserPlatform } from '@shared/infrastructure/platform/IBrowserPlatform';
import { BrowserPlatformFactory } from '@shared/infrastructure/platform/BrowserPlatformFactory';
import {
    ContentBackgroundBus,
    BusMessage,
} from '@shared/infrastructure/bus/ContentBackgroundBus';
import { NCW_STORAGE_KEYS } from '@shared/domain/constants/StorageKeys';
import { NCW_MESSAGE_TYPES } from '@shared/domain/constants/MessageTypes';

import { LLMHelperService } from '../application/services/LLMHelperService';
import { WatchHistoryService } from '../application/services/WatchHistoryService';
import { ViewingFrictionService } from '../application/services/ViewingFrictionService';
import { Context } from '@shared/domain/entities/Context';
import { Logger } from '@shared/utils/logger';
import { PhoneticAdapterFactory } from '@shared/infrastructure/phonetic/PhoneticAdapterFactory';
import { ChinesePhoneticAdapter } from '@shared/infrastructure/phonetic/adapters/ChinesePhoneticAdapter';
import { KoreanPhoneticAdapter } from '@shared/infrastructure/phonetic/adapters/KoreanPhoneticAdapter';
import { CredentialVaultService } from '../application/services/CredentialVaultService';
import { TtsAudioService } from '@shared/infrastructure/audio/TtsAudioService';

export class BackgroundMessageService {
    private static instance: BackgroundMessageService | null = null;
    private readonly aiSubStateService: AiSubStateService;
    private readonly glossaryService: GlossaryService;
    private readonly translationPipelineService: TranslationPipelineService;
    private readonly vocabService: VocabService;
    private readonly llmService: LlmService;
    private readonly llmHelperService: LLMHelperService;
    private readonly watchHistoryService: WatchHistoryService;
    private readonly viewingFrictionService: ViewingFrictionService;
    private readonly storage: IBrowserStorage;
    private readonly platform: IBrowserPlatform;
    private readonly cacheRepository: ITrackCacheRepository;

    private logger: Logger = new Logger('BackgroundMessageService');

    private constructor(
        storage: IBrowserStorage = BrowserStorageFactory.getStorage(),
        platform: IBrowserPlatform = BrowserPlatformFactory.getPlatform(),
    ) {
        this.storage = storage;
        this.platform = platform;
        this.cacheRepository = TrackCacheRepositoryFactory.getRepository();
        this.aiSubStateService = AiSubStateService.getInstance();
        this.glossaryService = GlossaryService.getInstance();
        this.translationPipelineService =
            TranslationPipelineService.getInstance();
        this.vocabService = VocabService.getInstance();
        this.llmService = LlmService.getInstance();
        this.llmHelperService = LLMHelperService.getInstance();
        this.watchHistoryService = WatchHistoryService.getInstance();
        this.viewingFrictionService = ViewingFrictionService.getInstance();

        this.storage.onChanged((changes) => {
            if (changes[NCW_STORAGE_KEYS.SETTINGS]?.newValue) {
                const updated = changes[NCW_STORAGE_KEYS.SETTINGS]
                    .newValue as ExtensionSettings;
                this.llmService.updateFromSettings(updated);
                if (updated.chinesePhoneticSystem) {
                    const zhAdapter = PhoneticAdapterFactory.getAdapter(
                        'zh',
                    ) as ChinesePhoneticAdapter | undefined;
                    if (
                        zhAdapter &&
                        typeof zhAdapter.setPhoneticSystem === 'function'
                    ) {
                        zhAdapter.setPhoneticSystem(
                            updated.chinesePhoneticSystem,
                        );
                    }
                }
                if (updated.koreanPhoneticSystem) {
                    const koAdapter = PhoneticAdapterFactory.getAdapter(
                        'ko',
                    ) as KoreanPhoneticAdapter | undefined;
                    if (
                        koAdapter &&
                        typeof koAdapter.setPhoneticSystem === 'function'
                    ) {
                        koAdapter.setPhoneticSystem(
                            updated.koreanPhoneticSystem,
                        );
                    }
                }
                ContentBackgroundBus.send(
                    NCW_MESSAGE_TYPES.PUSH_SETTINGS_CHANGED,
                    {
                        settings: updated,
                    },
                ).catch(() => {});
                ContentBackgroundBus.broadcastToTabs(
                    NCW_MESSAGE_TYPES.PUSH_SETTINGS_CHANGED,
                    {
                        settings: updated,
                    },
                ).catch(() => {});
            }
        });

        this.platform.onTabRemoved((tabId) => {
            this.glossaryService.unbindTabContext(tabId);
        });
    }

    async init(): Promise<void> {
        await CredentialVaultService.getInstance(this.storage).init();
        await this.llmService.init();
        await this.llmHelperService.init();
        await this.translationPipelineService.init();
        await this.vocabService.init();
        try {
            const res = await this.storage.get<Record<string, unknown>>([
                NCW_CONSTANTS.STORAGE_KEYS.SETTINGS,
            ]);
            const settings = res?.[NCW_CONSTANTS.STORAGE_KEYS.SETTINGS] as
                | unknown as ExtensionSettings
                | undefined;
            if (settings?.chinesePhoneticSystem) {
                const zhAdapter = PhoneticAdapterFactory.getAdapter(
                    'zh',
                ) as ChinesePhoneticAdapter | undefined;
                if (
                    zhAdapter &&
                    typeof zhAdapter.setPhoneticSystem === 'function'
                ) {
                    zhAdapter.setPhoneticSystem(
                        settings.chinesePhoneticSystem,
                    );
                }
            }
            if (settings?.koreanPhoneticSystem) {
                const koAdapter = PhoneticAdapterFactory.getAdapter(
                    'ko',
                ) as KoreanPhoneticAdapter | undefined;
                if (
                    koAdapter &&
                    typeof koAdapter.setPhoneticSystem === 'function'
                ) {
                    koAdapter.setPhoneticSystem(
                        settings.koreanPhoneticSystem,
                    );
                }
            }
            const retention = settings?.cacheRetention || '1m';
            await this.cacheRepository.cleanExpiredRecords(retention);
        } catch (_e) {}
    }

    static getInstance(
        storage?: IBrowserStorage,
        platform?: IBrowserPlatform,
    ): BackgroundMessageService {
        if (!BackgroundMessageService.instance) {
            BackgroundMessageService.instance = new BackgroundMessageService(
                storage,
                platform,
            );
        }
        return BackgroundMessageService.instance;
    }

    registerHandlers(): void {
        ContentBackgroundBus.registerDispatcher(
            (message: BusMessage, sender, sendResponse) => {
                if (!message || !message.type) return false;

                switch (message.type) {
                    // --- AI Sub State Management ---
                    case NCW_MESSAGE_TYPES.GET_AI_SUB_STATE: {
                        sendResponse({
                            success: true,
                            state: this.aiSubStateService.getState(),
                        } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_AI_SUB_STATE]['response']);
                        return false;
                    }

                    case NCW_MESSAGE_TYPES.SET_AI_SUB_ENABLED: {
                        this.aiSubStateService
                            .setEnabled(
                                Boolean(message.enabled),
                                message.platform,
                            )
                            .then((state) => {
                                sendResponse({
                                    success: true,
                                    state: state,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.SET_AI_SUB_ENABLED]['response']);
                            });
                        return true;
                    }

                    // --- Heartbeat & Tab Context Sync ---
                    case NCW_CONSTANTS.MESSAGE_TYPES.HEARTBEAT: {
                        const tabId = message.tabId ?? sender.tab?.id;
                        if (tabId !== undefined) {
                            if (message.showId && message.targetLanguage) {
                                this.glossaryService
                                    .getContextForShow(
                                        message.showId,
                                        message.targetLanguage,
                                    )
                                    .then((ctx) => {
                                        if (ctx) {
                                            this.glossaryService.bindTabContext(
                                                tabId,
                                                ctx,
                                            );
                                        }
                                    });
                            } else if (!message.showId) {
                                this.glossaryService.unbindTabContext(tabId);
                            }
                        }
                        sendResponse({
                            success: true,
                        } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.HEARTBEAT]['response']);
                        return false;
                    }

                    // --- Glossary & Context Management ---
                    case NCW_CONSTANTS.MESSAGE_TYPES.GET_CONTEXT: {
                        const tabId = message.tabId ?? sender.tab?.id;
                        if (tabId !== undefined) {
                            const contextForTab =
                                this.glossaryService.getContextForTab(tabId);
                            if (contextForTab) {
                                sendResponse({
                                    success: true,
                                    context: contextForTab.toDTO(),
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_CONTEXT]['response']);
                                return false;
                            } else if (
                                message.showId !== undefined &&
                                message.targetLanguage !== undefined
                            ) {
                                this.glossaryService
                                    .getContextForShow(
                                        message.showId,
                                        message.targetLanguage,
                                    )
                                    .then((ctx) => {
                                        if (ctx && tabId !== undefined) {
                                            this.glossaryService.bindTabContext(
                                                tabId,
                                                ctx,
                                            );
                                        }
                                        sendResponse({
                                            success: Boolean(ctx),
                                            context: ctx ? ctx.toDTO() : null,
                                        } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_CONTEXT]['response']);
                                    });
                                return true;
                            } else {
                                sendResponse({
                                    success: false,
                                    context: null,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_CONTEXT]['response']);
                                return false;
                            }
                        }

                        if (
                            message.showId !== undefined &&
                            message.targetLanguage !== undefined
                        ) {
                            this.glossaryService
                                .getContextForShow(
                                    message.showId,
                                    message.targetLanguage,
                                )
                                .then((ctx) => {
                                    if (!ctx) {
                                        sendResponse({
                                            success: false,
                                            context: null,
                                        } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_CONTEXT]['response']);
                                        return;
                                    }
                                    if (sender.tab?.id !== undefined) {
                                        this.glossaryService.bindTabContext(
                                            sender.tab.id,
                                            ctx || undefined,
                                        );
                                    }
                                    sendResponse({
                                        success: true,
                                        context: ctx.toDTO(),
                                    } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_CONTEXT]['response']);
                                });
                            return true;
                        }
                        sendResponse({
                            success: false,
                            context: null,
                        } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_CONTEXT]['response']);
                        return false;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.UPDATE_TERM: {
                        this.glossaryService
                            .updateManualTerm(
                                message.showId,
                                message.targetLanguage,
                                message.key,
                                message.value,
                            )
                            .then((ctx) => {
                                if (!ctx) {
                                    sendResponse({
                                        success: false,
                                        context: null,
                                    } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.UPDATE_TERM]['response']);
                                    return;
                                }
                                sendResponse({
                                    success: true,
                                    context: ctx.toDTO(),
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.UPDATE_TERM]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.DELETE_TERM: {
                        this.glossaryService
                            .deleteTerm(
                                message.showId,
                                message.targetLanguage,
                                message.key,
                            )
                            .then((ctx) => {
                                sendResponse({
                                    success: true,
                                    context: ctx.toDTO(),
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.DELETE_TERM]['response']);
                            })
                            .catch((e) => {
                                this.logger.error(
                                    'Glossary',
                                    `Failed to delete term ${message.key} on ${message.showId}-${message.targetLanguage} due to ${e}`,
                                );
                                sendResponse({
                                    success: false,
                                    context: null,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.DELETE_TERM]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.UPDATE_CHARACTER: {
                        this.glossaryService
                            .updateCharacter(
                                message.showId,
                                message.targetLanguage,
                                message.name,
                                message.canonical,
                                message.aliases || [],
                            )
                            .then((ctx) => {
                                sendResponse({
                                    success: true,
                                    context: ctx.toDTO(),
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.UPDATE_CHARACTER]['response']);
                            })
                            .catch((e) => {
                                this.logger.error(
                                    'Glossary',
                                    `Failed to update character ${message.name} on ${message.showId}-${message.targetLanguage} due to ${e}`,
                                );
                                sendResponse({
                                    success: false,
                                    context: null,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.UPDATE_CHARACTER]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.DELETE_CHARACTER: {
                        this.glossaryService
                            .deleteCharacter(
                                message.showId,
                                message.targetLanguage,
                                message.name,
                            )
                            .then((ctx) => {
                                sendResponse({
                                    success: true,
                                    context: ctx.toDTO(),
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.DELETE_CHARACTER]['response']);
                            })
                            .catch((e) => {
                                this.logger.error(
                                    'Glossary',
                                    `Failed to delete character ${message.name} on ${message.showId}-${message.targetLanguage} due to ${e}`,
                                );
                                sendResponse({
                                    success: false,
                                    context: null,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.DELETE_CHARACTER]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.RESET_CONTEXT: {
                        this.glossaryService
                            .resetContext(
                                message.showId,
                                message.targetLanguage,
                            )
                            .then((ctx) => {
                                sendResponse({
                                    success: true,
                                    context: ctx.toDTO(),
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.RESET_CONTEXT]['response']);
                            })
                            .catch(() => {});
                        return true;
                    }

                    // --- Translation & Supervisor Review Pipeline ---
                    case NCW_CONSTANTS.MESSAGE_TYPES.WARMUP_CONTEXT: {
                        this.translationPipelineService
                            .warmupContext(message)
                            .then((res) => {
                                if (res.success && res.context) {
                                    const effectiveTabId =
                                        message.tabId ?? sender.tab?.id;
                                    if (typeof effectiveTabId === 'number') {
                                        const ctx = Context.fromDTO(
                                            res.context,
                                        );
                                        this.glossaryService.bindTabContext(
                                            effectiveTabId,
                                            ctx,
                                        );
                                    }
                                }
                                sendResponse(
                                    res as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.WARMUP_CONTEXT]['response'],
                                );
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    context: null,
                                    cached: false,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.WARMUP_CONTEXT]['response']);
                            });
                        return true;
                    }

                    case NCW_MESSAGE_TYPES.MERGE_ASR_BATCH: {
                        this.translationPipelineService
                            .mergeAsrBatch({ items: message.items })
                            .then((res) => {
                                sendResponse(
                                    res as MessagePayloadMap[typeof NCW_MESSAGE_TYPES.MERGE_ASR_BATCH]['response'],
                                );
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_MESSAGE_TYPES.MERGE_ASR_BATCH]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.TRANSLATE_BATCH: {
                        this.translationPipelineService
                            .translateBatch(message)
                            .then((res) => {
                                sendResponse(
                                    res as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.TRANSLATE_BATCH]['response'],
                                );
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.TRANSLATE_BATCH]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.SUPERVISOR_REVIEW: {
                        this.translationPipelineService
                            .reviewBatch(message)
                            .then((res) => {
                                sendResponse(
                                    res as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.SUPERVISOR_REVIEW]['response'],
                                );
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.SUPERVISOR_REVIEW]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.CLEAR_QUEUES: {
                        this.translationPipelineService.clearQueues();
                        this.vocabService.clearQueues();
                        sendResponse({
                            success: true,
                        } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.CLEAR_QUEUES]['response']);
                        return false;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.UNLOAD_CONTEXT: {
                        this.glossaryService
                            .unloadContext(
                                message.showId,
                                message.targetLanguage,
                            )
                            .then(() => {
                                sendResponse({
                                    success: true,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.UNLOAD_CONTEXT]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.EPISODE_CHANGED: {
                        this.translationPipelineService.clearQueues();
                        this.vocabService.clearQueues();
                        this.glossaryService
                            .getOrCreateContext({
                                showId: message.showId,
                                targetLanguage: message.targetLanguage,
                                title: message.title,
                                mainTitle: message.mainTitle,
                                showSynopsis: message.showSynopsis,
                                episodeSynopsis: message.episodeSynopsis,
                                episodeId: message.episodeId,
                                episodeNumber: message.episodeNumber,
                                seasonId: message.seasonId,
                            })
                            .catch(() => {});
                        sendResponse({
                            success: true,
                        } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.EPISODE_CHANGED]['response']);
                        return false;
                    }

                    // --- Cache Operations ---
                    case NCW_CONSTANTS.MESSAGE_TYPES.GET_SUBTITLE_CACHE: {
                        (async () => {
                            const provider =
                                this.translationPipelineService.getActiveProvider();
                            const targetLanguage =
                                message.targetLanguage ||
                                this.translationPipelineService.getTargetLanguage()
                                    .code;
                            const translationModel =
                                provider === 'google'
                                    ? 'google'
                                    : (
                                          await this.llmService.getClient(
                                              'translator',
                                          )
                                      ).model;

                            // 1. Check native official cache first
                            this.cacheRepository
                                .getTrackCache({
                                    trackHash: message.trackHash,
                                    targetLanguage,
                                    provider: 'netflix_native',
                                    translationModel: 'official',
                                })
                                .then(async (nativeCache) => {
                                    if (
                                        nativeCache &&
                                        nativeCache.cues &&
                                        Object.keys(nativeCache.cues).length > 0
                                    ) {
                                        return nativeCache;
                                    }
                                    // 2. Fallback to active AI provider cache
                                    return await this.cacheRepository.getTrackCache(
                                        {
                                            trackHash: message.trackHash,
                                            targetLanguage,
                                            provider,
                                            translationModel,
                                        },
                                    );
                                })
                                .then((cache) => {
                                    if (
                                        cache &&
                                        cache.cues &&
                                        Object.keys(cache.cues).length > 0
                                    ) {
                                        sendResponse({
                                            success: true,
                                            hit: true,
                                            cachedCues: cache.cues,
                                            vocabScannedChunks:
                                                cache.vocabScannedChunks || [],
                                        } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_SUBTITLE_CACHE]['response']);
                                    } else {
                                        sendResponse({
                                            success: true,
                                            hit: false,
                                            cachedCues: {},
                                        } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_SUBTITLE_CACHE]['response']);
                                    }
                                })
                                .catch((err) => {
                                    sendResponse({
                                        success: false,
                                        hit: false,
                                        error: err?.message,
                                    } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_SUBTITLE_CACHE]['response']);
                                });
                        })();
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.SAVE_SUBTITLE_CACHE: {
                        this.cacheRepository
                            .saveTranslatedCues({
                                trackHash: message.trackHash,
                                movieId: message.movieId,
                                showTitle: message.showTitle || '',
                                targetLanguage: message.targetLanguage,
                                provider: message.provider || 'netflix_native',
                                translationModel:
                                    message.translationModel || 'official',
                                supervisorModel:
                                    message.supervisorModel || 'official',
                                results: message.results,
                            })
                            .then((saved) => {
                                sendResponse({
                                    success: saved,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.SAVE_SUBTITLE_CACHE]['response']);
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.SAVE_SUBTITLE_CACHE]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.MARK_CUES_STALE: {
                        this.cacheRepository
                            .markCuesStaleByTimeRange({
                                trackHash: message.trackHash,
                                cacheKey: message.cacheKey,
                                movieId: message.movieId,
                                movieIds: message.movieIds,
                                showTitle: message.showTitle,
                                showId: message.showId,
                                startTime: message.startTime,
                                endTime: message.endTime,
                            })
                            .then((count) => {
                                ContentBackgroundBus.broadcastToTabs(
                                    NCW_CONSTANTS.MESSAGE_TYPES.PUSH_CUES_STALE,
                                    {
                                        movieId: message.movieId,
                                        movieIds: message.movieIds,
                                        showTitle: message.showTitle,
                                        showId: message.showId,
                                        trackHash: message.trackHash,
                                        cacheKey: message.cacheKey,
                                        invalidatedCount: count,
                                    },
                                ).catch(() => {});

                                sendResponse({
                                    success: true,
                                    invalidatedCount: count,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.MARK_CUES_STALE]['response']);
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    invalidatedCount: 0,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.MARK_CUES_STALE]['response']);
                            });
                        return true;
                    }

                    // --- Vocabulary Operations ---
                    case NCW_CONSTANTS.MESSAGE_TYPES.FEED_VOCAB_CUES: {
                        this.vocabService.feedVocabCues(message).then(() => {
                            sendResponse({
                                success: true,
                            } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.FEED_VOCAB_CUES]['response']);
                        });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.GET_VOCAB_DATA: {
                        this.vocabService
                            .getVocabData(message.movieId)
                            .then((data) => {
                                sendResponse({
                                    success: true,
                                    data,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_VOCAB_DATA]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.RESET_VOCAB_DATA: {
                        this.vocabService
                            .resetVocabData(message.movieId)
                            .then(() => {
                                sendResponse({
                                    success: true,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.RESET_VOCAB_DATA]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.SAVE_USER_VOCAB_WORD: {
                        this.vocabService
                            .saveUserMarkedWord(message)
                            .then((res) => {
                                sendResponse(
                                    res as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.SAVE_USER_VOCAB_WORD]['response'],
                                );
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.DELETE_USER_VOCAB_WORD: {
                        this.vocabService
                            .deleteUserMarkedWord(message)
                            .then((res) => {
                                sendResponse(
                                    res as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.DELETE_USER_VOCAB_WORD]['response'],
                                );
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.LOOKUP_WORD_DEFINITION: {
                        this.vocabService
                            .lookupWordDefinition(message)
                            .then((res) => {
                                sendResponse(
                                    res as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.LOOKUP_WORD_DEFINITION]['response'],
                                );
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.GET_PHONETIC_READING: {
                        const adapter = PhoneticAdapterFactory.getAdapter(
                            message.lang,
                        );
                        if (!adapter) {
                            sendResponse({
                                success: false,
                                reading: '',
                            } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_PHONETIC_READING]['response']);
                            return true;
                        }
                        adapter
                            .getWordReading(message.word, {
                                system: message.system,
                            })
                            .then((reading) => {
                                sendResponse({
                                    success: true,
                                    reading,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_PHONETIC_READING]['response']);
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    reading: '',
                                    error: String(err),
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_PHONETIC_READING]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.GET_PHONETIC_BATCH: {
                        const adapter = PhoneticAdapterFactory.getAdapter(
                            message.lang,
                        );
                        if (!adapter) {
                            sendResponse({
                                success: false,
                                readings: {},
                            } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_PHONETIC_BATCH]['response']);
                            return true;
                        }
                        const readings: Record<string, string> = {};
                        const words: string[] = Array.isArray(message.words)
                            ? message.words
                            : [];
                        Promise.all(
                            words.map(async (w: string) => {
                                try {
                                    const r = await adapter.getWordReading(w, {
                                        system: message.system,
                                    });
                                    if (r && r !== w) {
                                        readings[w] = r;
                                    }
                                } catch {
                                    // Ignore single token errors
                                }
                            }),
                        )
                            .then(() => {
                                sendResponse({
                                    success: true,
                                    readings,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_PHONETIC_BATCH]['response']);
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    readings,
                                    error: String(err),
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_PHONETIC_BATCH]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.GET_TTS_AUDIO: {
                        TtsAudioService.fetchAudioBase64(
                            message.text,
                            message.lang,
                        )
                            .then((audioBase64) => {
                                sendResponse({
                                    success: !!audioBase64,
                                    audioBase64: audioBase64 || undefined,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_TTS_AUDIO]['response']);
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: String(err),
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_TTS_AUDIO]['response']);
                            });
                        return true;
                    }

                    // --- Watch History & Analytics ---
                    case NCW_CONSTANTS.MESSAGE_TYPES.RECORD_WATCH_SESSION: {
                        this.watchHistoryService
                            .recordSession(message.session)
                            .then((success) => {
                                sendResponse({
                                    success,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.RECORD_WATCH_SESSION]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.GET_WATCH_HISTORY: {
                        this.watchHistoryService
                            .getWatchHistory()
                            .then((data) => {
                                sendResponse({
                                    success: true,
                                    shows: data.shows,
                                    recentSessions: data.recentSessions,
                                    stats: data.stats,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_WATCH_HISTORY]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.CLEAR_WATCH_HISTORY: {
                        this.watchHistoryService
                            .clearWatchHistory()
                            .then((success) => {
                                sendResponse({
                                    success,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.CLEAR_WATCH_HISTORY]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.DELETE_SHOW_HISTORY: {
                        this.watchHistoryService
                            .deleteShowHistory(message.showId)
                            .then((success) => {
                                sendResponse({
                                    success,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.DELETE_SHOW_HISTORY]['response']);
                            });
                        return true;
                    }

                    // --- Viewing Static Friction ---
                    case NCW_CONSTANTS.MESSAGE_TYPES.GET_TODAY_WATCH_TIME: {
                        this.watchHistoryService
                            .getTodayWatchStats(message.excludedPlatforms || [])
                            .then((stats) => {
                                sendResponse({
                                    success: true,
                                    ...stats,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_TODAY_WATCH_TIME]['response']);
                            })
                            .catch(() => {
                                sendResponse({
                                    success: false,
                                    todaySeconds: 0,
                                    todaySessions: 0,
                                    platformSeconds: {},
                                    todayRestSeconds: 0,
                                    todayBreakCount: 0,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_TODAY_WATCH_TIME]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.RECORD_REST_TIME: {
                        this.watchHistoryService
                            .recordRestTime(message.restSeconds)
                            .then((stats) => {
                                sendResponse({
                                    success: true,
                                    ...stats,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.RECORD_REST_TIME]['response']);
                            })
                            .catch(() => {
                                sendResponse({
                                    success: false,
                                    totalRestSeconds: 0,
                                    breakCount: 0,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.RECORD_REST_TIME]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.GET_FRICTION_ADVICE: {
                        this.generateFrictionAdvice(message)
                            .then((advice) => {
                                sendResponse({
                                    success: true,
                                    advice,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_FRICTION_ADVICE]['response']);
                            })
                            .catch(() => {
                                sendResponse({
                                    success: false,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_FRICTION_ADVICE]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.CLOSE_CURRENT_TAB: {
                        const tabId = message.tabId ?? sender.tab?.id;
                        if (
                            tabId !== undefined &&
                            typeof chrome !== 'undefined' &&
                            chrome.tabs &&
                            chrome.tabs.remove
                        ) {
                            chrome.tabs.remove(tabId);
                        }
                        sendResponse({
                            success: true,
                        } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.CLOSE_CURRENT_TAB]['response']);
                        return false;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.FRICTION_HEARTBEAT: {
                        this.viewingFrictionService
                            .handleHeartbeat(message)
                            .then((res) => {
                                sendResponse(res as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.FRICTION_HEARTBEAT]['response']);
                            })
                            .catch(() => {
                                sendResponse({
                                    shouldPause: false,
                                    activeBreak: null,
                                    continuousSeconds: 0,
                                    todaySeconds: 0,
                                    todayRestSeconds: 0,
                                    todayBreakCount: 0,
                                    isStoppedForToday: false,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.FRICTION_HEARTBEAT]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.TICK_FRICTION_BREAK: {
                        this.viewingFrictionService
                            .handleTickBreak(message.breakId)
                            .then((res) => {
                                sendResponse(res as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.TICK_FRICTION_BREAK]['response']);
                            })
                            .catch(() => {
                                sendResponse({
                                    remainingSeconds: 0,
                                    isCompleted: true,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.TICK_FRICTION_BREAK]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.COMPLETE_FRICTION_BREAK: {
                        this.viewingFrictionService
                            .handleCompleteBreak(
                                message.breakId,
                                message.passedChallenge,
                            )
                            .then((res) => {
                                sendResponse(res as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.COMPLETE_FRICTION_BREAK]['response']);
                            })
                            .catch(() => {
                                sendResponse({
                                    success: false,
                                    canResume: true,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.COMPLETE_FRICTION_BREAK]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.DISMISS_HARD_BLOCK: {
                        this.viewingFrictionService
                            .handleDismissHardBlock(message.breakId)
                            .then((res) => {
                                sendResponse(res as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.DISMISS_HARD_BLOCK]['response']);
                            })
                            .catch(() => {
                                sendResponse({
                                    success: false,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.DISMISS_HARD_BLOCK]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.UPDATE_FRICTION_PENALTY: {
                        this.viewingFrictionService
                            .handleUpdatePenalty(message)
                            .then((res) => {
                                sendResponse(res as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.UPDATE_FRICTION_PENALTY]['response']);
                            })
                            .catch(() => {
                                sendResponse({
                                    success: false,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.UPDATE_FRICTION_PENALTY]['response']);
                            });
                        return true;
                    }

                    // --- LLM Connection Checks ---
                    case NCW_CONSTANTS.MESSAGE_TYPES.CHECK_OLLAMA: {
                        this.llmService
                            .checkOllamaConnection()
                            .then((data) => {
                                sendResponse({
                                    success: true,
                                    data: data.models.map((m) => ({ name: m })),
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.CHECK_OLLAMA]['response']);
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.CHECK_OLLAMA]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.CHECK_OPENROUTER: {
                        this.llmService
                            .checkOpenRouterConnection()
                            .then((data) => {
                                sendResponse({
                                    success: true,
                                    data,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.CHECK_OPENROUTER]['response']);
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.CHECK_OPENROUTER]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.FETCH_OPENROUTER_MODELS: {
                        this.llmService
                            .fetchOpenRouterModels()
                            .then((models) => {
                                sendResponse({
                                    success: true,
                                    models,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.FETCH_OPENROUTER_MODELS]['response']);
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.FETCH_OPENROUTER_MODELS]['response']);
                            });
                        return true;
                    }

                    // --- Settings Operations ---
                    case NCW_CONSTANTS.MESSAGE_TYPES.GET_SETTINGS: {
                        this.storage
                            .get<ExtensionSettings>([NCW_STORAGE_KEYS.SETTINGS])
                            .then((res) => {
                                const settings = (res[
                                    NCW_STORAGE_KEYS.SETTINGS
                                ] ||
                                    NCW_CONSTANTS.DEFAULT_SETTINGS) as ExtensionSettings;
                                // Credentials write-only: never expose plaintext API key in settings
                                settings.openrouterApiKey = '';
                                sendResponse({
                                    success: true,
                                    settings,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_SETTINGS]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.SAVE_SETTINGS: {
                        this.storage
                            .get<Partial<ExtensionSettings>>([
                                NCW_STORAGE_KEYS.SETTINGS,
                            ])
                            .then(async (res) => {
                                const current = (res[
                                    NCW_STORAGE_KEYS.SETTINGS
                                ] ||
                                    NCW_CONSTANTS.DEFAULT_SETTINGS) as Partial<ExtensionSettings>;

                                // Intercept openrouterApiKey if provided and route to secure vault
                                if (message.settings.openrouterApiKey !== undefined) {
                                    const keyToSave = message.settings.openrouterApiKey;
                                    if (keyToSave) {
                                        await CredentialVaultService.getInstance().saveCredentials({
                                            apiKey: keyToSave,
                                        });
                                    } else {
                                        await CredentialVaultService.getInstance().clear();
                                    }
                                    delete message.settings.openrouterApiKey;
                                }

                                const updated = {
                                    ...current,
                                    ...(message.settings as Partial<ExtensionSettings>),
                                } as ExtensionSettings;

                                // Always ensure plaintext key is not stored in general settings or broadcast to tabs
                                delete (updated as Partial<ExtensionSettings>).openrouterApiKey;

                                await this.storage.set({
                                    [NCW_STORAGE_KEYS.SETTINGS]: updated,
                                });
                                this.llmService.updateFromSettings(updated);
                                ContentBackgroundBus.send(
                                    NCW_MESSAGE_TYPES.PUSH_SETTINGS_CHANGED,
                                    {
                                        settings: updated,
                                    },
                                ).catch(() => {});
                                ContentBackgroundBus.broadcastToTabs(
                                    NCW_MESSAGE_TYPES.PUSH_SETTINGS_CHANGED,
                                    {
                                        settings: updated,
                                    },
                                ).catch(() => {});
                                sendResponse({
                                    success: true,
                                    settings: updated,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_SETTINGS]['response']);
                            });
                        return true;
                    }

                    // --- Secure Credential Vault Operations ---
                    case NCW_CONSTANTS.MESSAGE_TYPES.GET_CREDENTIAL_STATUS: {
                        const status = CredentialVaultService.getInstance().getStatus();
                        sendResponse({
                            success: true,
                            status,
                        } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_CREDENTIAL_STATUS]['response']);
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.SAVE_CREDENTIALS: {
                        CredentialVaultService.getInstance()
                            .saveCredentials(message)
                            .then((status) => {
                                sendResponse({
                                    success: true,
                                    status,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.SAVE_CREDENTIALS]['response']);
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.SAVE_CREDENTIALS]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.UNLOCK_CREDENTIALS: {
                        CredentialVaultService.getInstance()
                            .unlock(message.password)
                            .then((unlocked) => {
                                if (unlocked) {
                                    sendResponse({
                                        success: true,
                                    } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.UNLOCK_CREDENTIALS]['response']);
                                } else {
                                    sendResponse({
                                        success: false,
                                        error: 'INVALID_PASSWORD',
                                    } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.UNLOCK_CREDENTIALS]['response']);
                                }
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.UNLOCK_CREDENTIALS]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.CANCEL_UNLOCK: {
                        CredentialVaultService.getInstance().cancelUnlock();
                        sendResponse({
                            success: true,
                        } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.CANCEL_UNLOCK]['response']);
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.LOCK_CREDENTIALS: {
                        CredentialVaultService.getInstance()
                            .lock()
                            .then(() => {
                                sendResponse({
                                    success: true,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.LOCK_CREDENTIALS]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.DISABLE_CREDENTIAL_ENCRYPTION: {
                        CredentialVaultService.getInstance()
                            .disableEncryption(message.password)
                            .then((unlocked) => {
                                if (unlocked) {
                                    sendResponse({
                                        success: true,
                                    } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.DISABLE_CREDENTIAL_ENCRYPTION]['response']);
                                } else {
                                    sendResponse({
                                        success: false,
                                        error: 'INVALID_PASSWORD',
                                    } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.DISABLE_CREDENTIAL_ENCRYPTION]['response']);
                                }
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.DISABLE_CREDENTIAL_ENCRYPTION]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.CLEAR_CREDENTIALS: {
                        CredentialVaultService.getInstance()
                            .clear()
                            .then(() => {
                                sendResponse({
                                    success: true,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.CLEAR_CREDENTIALS]['response']);
                            });
                        return true;
                    }

                    // --- AI Helper & Glossary Extraction ---
                    case NCW_CONSTANTS.MESSAGE_TYPES.GET_AI_CAPABILITY: {
                        this.llmService
                            .getAiCapability()
                            .then((res) => {
                                sendResponse({
                                    success: true,
                                    ...res,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.GET_AI_CAPABILITY]['response']);
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    hasAi: false,
                                    isSupervisor: false,
                                    error: err?.message,
                                });
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES
                        .EXTRACT_GLOSSARY_BILINGUAL: {
                        this.llmHelperService
                            .extractGlossaryBilingual({
                                sourceText: message.sourceText,
                                targetText: message.targetText,
                                targetLang: message.targetLang,
                            })
                            .then((data) => {
                                sendResponse({
                                    success: true,
                                    data,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.EXTRACT_GLOSSARY_BILINGUAL]['response']);
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.EXTRACT_GLOSSARY_BILINGUAL]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES
                        .EXTRACT_GLOSSARY_AND_TRANSLATE: {
                        this.llmHelperService
                            .extractGlossaryAndTranslate({
                                sourceText: message.sourceText,
                                targetLang: message.targetLang,
                            })
                            .then((data) => {
                                sendResponse({
                                    success: true,
                                    data,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.EXTRACT_GLOSSARY_AND_TRANSLATE]['response']);
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.EXTRACT_GLOSSARY_AND_TRANSLATE]['response']);
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.BULK_UPDATE_GLOSSARY: {
                        this.glossaryService
                            .bulkUpdateGlossary({
                                showId: message.showId,
                                targetLanguage: message.targetLanguage,
                                characters: message.characters,
                                terms: message.terms,
                            })
                            .then((ctx) => {
                                sendResponse({
                                    success: true,
                                    context: ctx.toDTO(),
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.BULK_UPDATE_GLOSSARY]['response']);
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    error: err?.message,
                                });
                            });
                        return true;
                    }

                    case NCW_CONSTANTS.MESSAGE_TYPES.EXTRACT_NATIVE_TERMS: {
                        this.translationPipelineService
                            .extractTermsFromNativeBilingualCues({
                                showId: message.showId,
                                targetLanguage: message.targetLanguage,
                                pairs: message.pairs,
                            })
                            .then((res) => {
                                sendResponse(
                                    res as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.EXTRACT_NATIVE_TERMS]['response'],
                                );
                            })
                            .catch((err) => {
                                sendResponse({
                                    success: false,
                                    charactersAdded: 0,
                                    termsAdded: 0,
                                    error: err?.message,
                                } as MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.EXTRACT_NATIVE_TERMS]['response']);
                            });
                        return true;
                    }

                    default:
                        return false;
                }
            },
        );
    }

    private async generateFrictionAdvice(params: {
        reason: string;
        showTitle?: string;
        watchMinutes: number;
        todayMinutes: number;
        watchSeconds?: number;
        todaySeconds?: number;
        todayRestSeconds?: number;
        todayBreakCount?: number;
        curfewTime?: string;
    }): Promise<string | undefined> {
        const isSupervisorActive = await this.llmService.isSupervisorActive();
        if (!isSupervisorActive) return undefined;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);

        try {
            const durationStr =
                params.watchSeconds && params.watchSeconds < 60
                    ? `${params.watchSeconds} seconds`
                    : `${params.watchMinutes} minutes`;
            const todayStr =
                params.todaySeconds && params.todaySeconds < 60
                    ? `${params.todaySeconds} seconds`
                    : `${params.todayMinutes} minutes`;

            const reasonDesc =
                params.reason === 'curfew'
                    ? `it is late at night (past curfew ${params.curfewTime || 'midnight'})`
                    : params.reason === 'daily_limit'
                      ? `daily viewing limit reached (${todayStr} today)`
                      : `they have been watching continuously for ${durationStr}`;

            const restContext =
                params.todayRestSeconds && params.todayRestSeconds > 0
                    ? ` The viewer has already taken ${params.todayBreakCount || 1} mindful eye-rest breaks totaling ${Math.round(params.todayRestSeconds)} seconds today.`
                    : '';

            const prompt = `You are a supportive digital wellness and eye health companion in a video player.
The viewer was just paused for a health micro-break because: ${reasonDesc}.${restContext}
${params.showTitle ? `Current show: "${params.showTitle}".` : ''}

Give a single, concise, warm 1-2 sentence tip or encouragement. You may praise them for prioritizing eye health, reference the show playfully, or suggest eye rest (20-20-20 rule), hydration, posture stretching, or sleep. Maximum 40 words.`;

            const reply = await this.llmService.callChat('supervisor', {
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                signal: controller.signal,
            });
            clearTimeout(timeout);
            return reply?.trim() || undefined;
        } catch {
            clearTimeout(timeout);
            return undefined;
        }
    }
}
