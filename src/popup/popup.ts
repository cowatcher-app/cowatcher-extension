/**
 * CoWatcher - Popup Controller
 * Dual-Model Configuration:
 * - Translation Model (e.g. translategemma:4b): 50-cue batch ahead, refill threshold.
 * - Supervisor Model (e.g. gemma4:e4b): consistency review & Context maintenance.
 */

import { NCW_CONSTANTS, ExtensionSettings } from '@shared/utils/constants';
import NCW_I18N from '@shared/utils/i18n';
import { PopupMessageService } from './application/PopupMessageService';
import { ContextDTO } from '@shared/domain/entities/Context';
import { CharacterItem } from '@shared/domain/entities/Translation';
import { EpisodeVocabData, OpenRouterModelItem } from '@shared/types/Messages';
import { BrowserPlatformFactory } from '@shared/infrastructure/platform/BrowserPlatformFactory';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { NCW_STORAGE_KEYS } from '@shared/domain/constants/StorageKeys';
import { TranslationProvider } from '@shared/domain/entities/PipelineTypes';
import { Language } from '@shared/domain/value-objects/Language';
import {
    STREAMING_PLATFORMS,
    StreamingPlatformId,
} from '@shared/domain/constants/StreamingPlatforms';
import { AiSubState } from '@shared/domain/entities/AiSubState';
import { Logger } from '@shared/utils/logger';

const logger: Logger = new Logger('popup');

document.addEventListener('DOMContentLoaded', () => {
    const messageService = PopupMessageService.getInstance();
    const platform = BrowserPlatformFactory.getPlatform();
    const storage = BrowserStorageFactory.getStorage();

    const enabledToggle = document.getElementById(
        'enabled-toggle',
    ) as HTMLInputElement;
    const statusDot = document.getElementById('status-dot') as HTMLElement;
    const statusTitle = document.getElementById('status-title') as HTMLElement;
    const statusDesc = document.getElementById('status-desc') as HTMLElement;
    const btnRefreshModels = document.getElementById(
        'btn-refresh-models',
    ) as HTMLButtonElement;
    const ollamaHostInput = document.getElementById(
        'ollama-host',
    ) as HTMLInputElement;
    const btnSaveHost = document.getElementById(
        'btn-save-host',
    ) as HTMLButtonElement;

    // AI Provider & OpenRouter elements
    const aiProviderSelect = document.getElementById(
        'ai-provider',
    ) as HTMLSelectElement;
    const ollamaSettingsGroup = document.getElementById(
        'ollama-settings-group',
    ) as HTMLElement;
    const openrouterSettingsGroup = document.getElementById(
        'openrouter-settings-group',
    ) as HTMLElement;
    const openrouterApiKeyInput = document.getElementById(
        'openrouter-api-key',
    ) as HTMLInputElement;
    const btnToggleKey = document.getElementById(
        'btn-toggle-key',
    ) as HTMLButtonElement;
    const btnTestOpenRouter = document.getElementById(
        'btn-test-openrouter',
    ) as HTMLButtonElement;
    const popupKeyStatus = document.getElementById(
        'popup-key-status',
    ) as HTMLDivElement | null;
    const btnClearOpenRouterKey = document.getElementById(
        'btn-clear-openrouter-key',
    ) as HTMLButtonElement | null;
    const popupVaultCard = document.getElementById(
        'popup-vault-card',
    ) as HTMLDivElement | null;
    const popupVaultLockedView = document.getElementById(
        'popup-vault-locked-view',
    ) as HTMLDivElement | null;
    const popupVaultPwdInput = document.getElementById(
        'popup-vault-pwd-input',
    ) as HTMLInputElement | null;
    const btnPopupVaultUnlock = document.getElementById(
        'btn-popup-vault-unlock',
    ) as HTMLButtonElement | null;
    const popupVaultError = document.getElementById(
        'popup-vault-error',
    ) as HTMLDivElement | null;
    const popupVaultUnlockedView = document.getElementById(
        'popup-vault-unlocked-view',
    ) as HTMLDivElement | null;
    const btnPopupVaultLock = document.getElementById(
        'btn-popup-vault-lock',
    ) as HTMLButtonElement | null;
    const openrouterTranslationModelSelect = document.getElementById(
        'openrouter-translation-model',
    ) as HTMLSelectElement;
    const openrouterCustomTranslationModelInput = document.getElementById(
        'openrouter-custom-translation-model',
    ) as HTMLInputElement;
    const openrouterSupervisorModelGroup = document.getElementById(
        'openrouter-supervisor-model-group',
    ) as HTMLElement;
    const openrouterSupervisorModelSelect = document.getElementById(
        'openrouter-supervisor-model',
    ) as HTMLSelectElement;
    const openrouterCustomSupervisorModelInput = document.getElementById(
        'openrouter-custom-supervisor-model',
    ) as HTMLInputElement;

    // Tab elements
    const tabBtnSubtitles = document.getElementById(
        'tab-btn-subtitles',
    ) as HTMLButtonElement;
    const tabBtnVocab = document.getElementById(
        'tab-btn-vocab',
    ) as HTMLButtonElement;
    const tabBtnAi = document.getElementById(
        'tab-btn-ai',
    ) as HTMLButtonElement;
    const tabSubtitles = document.getElementById(
        'tab-subtitles',
    ) as HTMLElement;
    const tabVocab = document.getElementById('tab-vocab') as HTMLElement;
    const tabAi = document.getElementById('tab-ai') as HTMLElement;

    // Provider status badges
    const subtitlesProviderStatus = document.getElementById(
        'subtitles-provider-status',
    ) as HTMLElement;
    const vocabProviderStatus = document.getElementById(
        'vocab-provider-status',
    ) as HTMLElement;
    const aiTabOllamaStatus = document.getElementById(
        'ai-tab-ollama-status',
    ) as HTMLElement;
    const aiTabOpenRouterStatus = document.getElementById(
        'ai-tab-openrouter-status',
    ) as HTMLElement;

    // Vocab Collector elements
    const vocabEnabledToggle = document.getElementById(
        'vocab-enabled-toggle',
    ) as HTMLInputElement;
    const vocabEpisodeTitle = document.getElementById(
        'vocab-episode-title',
    ) as HTMLElement;
    const vocabCountBadge = document.getElementById(
        'vocab-count-badge',
    ) as HTMLElement;
    const vocabStatusDetail = document.getElementById(
        'vocab-status-detail',
    ) as HTMLElement;
    const vocabProviderSelect = document.getElementById(
        'vocab-provider',
    ) as HTMLSelectElement;
    const vocabOpenrouterGroup = document.getElementById(
        'vocab-openrouter-group',
    ) as HTMLElement;
    const vocabOpenrouterModelSelect = document.getElementById(
        'vocab-openrouter-model',
    ) as HTMLSelectElement;
    const vocabCustomOpenrouterModelInput = document.getElementById(
        'vocab-custom-openrouter-model',
    ) as HTMLInputElement;
    const vocabOllamaGroup = document.getElementById(
        'vocab-ollama-group',
    ) as HTMLElement;
    const vocabOllamaModelSelect = document.getElementById(
        'vocab-ollama-model',
    ) as HTMLSelectElement;
    const vocabDifficultySelect = document.getElementById(
        'vocab-difficulty',
    ) as HTMLSelectElement;
    const vocabSourceLangSelect = document.getElementById(
        'vocab-source-lang',
    ) as HTMLSelectElement;
    const vocabCustomPromptInput = document.getElementById(
        'vocab-custom-prompt',
    ) as HTMLTextAreaElement;
    const vocabLangBadge = document.getElementById(
        'vocab-lang-badge',
    ) as HTMLElement;
    const btnDownloadVocabCsv = document.getElementById(
        'btn-download-vocab-csv',
    ) as HTMLButtonElement;
    const btnResetVocab = document.getElementById(
        'btn-reset-vocab',
    ) as HTMLButtonElement;
    const vocabPreviewCount = document.getElementById(
        'vocab-preview-count',
    ) as HTMLElement;
    const vocabPreviewBox = document.getElementById(
        'vocab-preview-box',
    ) as HTMLElement;

    let currentActiveEpisodeId = '';
    let currentActiveEpisodeTitle = '';
    let currentContextDTO: ContextDTO | null = null;
    let currentVocabData: EpisodeVocabData | null = null;

    const RECOMMENDED_OPENROUTER_MODELS = [
        { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3' },
        { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
        { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct' },
        {
            id: 'meta-llama/llama-3.3-70b-instruct',
            name: 'Llama 3.3 70B Instruct',
        },
        { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
        { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
    ];
    let cachedOpenRouterModels: OpenRouterModelItem[] = [];

    const uiLanguageSelect = document.getElementById(
        'ui-language',
    ) as HTMLSelectElement;
    const translationModelSelect = document.getElementById(
        'translation-model',
    ) as HTMLSelectElement;
    const enableSupervisorCheckbox = document.getElementById(
        'enable-supervisor',
    ) as HTMLInputElement;
    const supervisorModelGroup = document.getElementById(
        'supervisor-model-group',
    ) as HTMLElement;
    const supervisorModelSelect = document.getElementById(
        'supervisor-model',
    ) as HTMLSelectElement;
    const targetLanguageSelect = document.getElementById(
        'target-language',
    ) as HTMLSelectElement;
    const displayModeSelect = document.getElementById(
        'display-mode',
    ) as HTMLSelectElement;
    const preferNativeSubsCheckbox = document.getElementById(
        'prefer-native-subs',
    ) as HTMLInputElement;
    const extractNativeTermsCheckbox = document.getElementById(
        'extract-native-terms',
    ) as HTMLInputElement;
    const extractNativeTermsGroup = document.getElementById(
        'extract-native-terms-group',
    ) as HTMLElement;
    const hideNativeSubsCheckbox = document.getElementById(
        'hide-native-subs',
    ) as HTMLInputElement;
    const enableLearningCheckbox = document.getElementById(
        'enable-learning',
    ) as HTMLInputElement | null;
    const enableDomSyncCheckbox = document.getElementById(
        'enable-dom-sync',
    ) as HTMLInputElement;

    // Context card elements
    const showTitle = document.getElementById('show-title') as HTMLElement;
    const memoryBadge = document.getElementById('memory-badge') as HTMLElement;
    const showSynopsis = document.getElementById(
        'show-synopsis',
    ) as HTMLElement;
    const glossaryCount = document.getElementById(
        'glossary-count',
    ) as HTMLElement;
    const glossaryTags = document.getElementById(
        'glossary-tags',
    ) as HTMLElement;
    const btnResetContext = document.getElementById(
        'btn-reset-context',
    ) as HTMLButtonElement;
    const btnOpenEditor = document.getElementById(
        'btn-open-editor',
    ) as HTMLButtonElement;

    // Sliders & controls
    const minCuesSlider = document.getElementById(
        'min-translate-cues',
    ) as HTMLInputElement;
    const minCuesVal = document.getElementById('min-cues-val') as HTMLElement;
    const maxCuesSlider = (document.getElementById('max-translate-cues') ||
        document.getElementById('translate-batch-size')) as HTMLInputElement;
    const maxCuesVal = (document.getElementById('max-cues-val') ||
        document.getElementById('batch-size-val')) as HTMLElement;
    const refillSlider = document.getElementById(
        'refill-threshold',
    ) as HTMLInputElement;
    const refillVal = document.getElementById('refill-val') as HTMLElement;

    const reviewBatchGroup = document.getElementById(
        'review-batch-group',
    ) as HTMLElement;
    const reviewBatchSlider = document.getElementById(
        'review-batch-size',
    ) as HTMLInputElement;
    const reviewBatchVal = document.getElementById(
        'review-batch-val',
    ) as HTMLElement;

    const enableAutomaticAsrMergingCheckbox = document.getElementById(
        'enable-automatic-asr-merging',
    ) as HTMLInputElement;
    const asrMergeBatchSlider = document.getElementById(
        'asr-merge-batch-size',
    ) as HTMLInputElement;
    const asrMergeBatchVal = document.getElementById(
        'asr-merge-batch-val',
    ) as HTMLElement;
    const asrSilenceThresholdSlider = document.getElementById(
        'asr-silence-threshold',
    ) as HTMLInputElement;
    const asrSilenceThresholdVal = document.getElementById(
        'asr-silence-threshold-val',
    ) as HTMLElement;

    const fontSizeSlider = document.getElementById(
        'font-size',
    ) as HTMLInputElement;
    const fontSizeVal = document.getElementById('font-size-val') as HTMLElement;
    const bgOpacitySlider = document.getElementById(
        'bg-opacity',
    ) as HTMLInputElement;
    const bgOpacityVal = document.getElementById(
        'bg-opacity-val',
    ) as HTMLElement;
    const transOpacitySlider = document.getElementById(
        'trans-opacity',
    ) as HTMLInputElement;
    const transOpacityVal = document.getElementById(
        'trans-opacity-val',
    ) as HTMLElement;
    const subOffsetSlider = document.getElementById(
        'sub-offset',
    ) as HTMLInputElement;
    const subOffsetVal = document.getElementById(
        'sub-offset-val',
    ) as HTMLElement;
    const showOriginalSmallerCheckbox = document.getElementById(
        'show-original-smaller',
    ) as HTMLInputElement;
    const swapSubtitleOrderCheckbox = document.getElementById(
        'swap-subtitle-order',
    ) as HTMLInputElement;
    const enableGlassEffectCheckbox = document.getElementById(
        'enable-glass-effect',
    ) as HTMLInputElement;
    const enableAnimationCheckbox = document.getElementById(
        'enable-animation',
    ) as HTMLInputElement;

    const syncOffsetVal = document.getElementById(
        'sync-offset-val',
    ) as HTMLElement;
    const btnSyncEarlier = document.getElementById(
        'btn-sync-earlier',
    ) as HTMLButtonElement;
    const btnSyncReset = document.getElementById(
        'btn-sync-reset',
    ) as HTMLButtonElement;
    const btnSyncLater = document.getElementById(
        'btn-sync-later',
    ) as HTMLButtonElement;

    const testInput = document.getElementById('test-input') as HTMLInputElement;
    const btnTest = document.getElementById('btn-test') as HTMLButtonElement;
    const testResult = document.getElementById('test-result') as HTMLElement;

    let currentSettings: ExtensionSettings = {
        ...NCW_CONSTANTS.DEFAULT_SETTINGS,
    };
    let currentDetectedPlatform: StreamingPlatformId | null = null;

    function detectPlatformFromUrl(url?: string): StreamingPlatformId | null {
        if (!url) return null;
        if (url.includes('netflix.com')) return STREAMING_PLATFORMS.NETFLIX;
        if (url.includes('tver.jp')) return STREAMING_PLATFORMS.TVER;
        if (url.includes('youtube.com')) return STREAMING_PLATFORMS.YOUTUBE;
        if (url.includes('bilibili.com')) return STREAMING_PLATFORMS.BILIBILI;
        return null;
    }

    // 1. Detect active streaming tab on popup open
    let currentActiveTab: { id?: number; url?: string; title?: string } | null =
        null;
    platform.getActiveTab().then(async (tab) => {
        currentActiveTab = tab;
        currentDetectedPlatform = detectPlatformFromUrl(tab?.url);
        if (tab && tab.url) {
            // Load context directly bound to this active tab
            if (tab.id !== undefined) {
                const ctx = await messageService.getGlossaryContext(tab.id);
                if (ctx) {
                    renderContext(ctx);
                }
            }
        }
        // Refresh enabled toggle for the detected platform
        if (enabledToggle && currentSettings) {
            if (
                currentDetectedPlatform &&
                currentSettings.platformEnabled &&
                typeof currentSettings.platformEnabled[
                    currentDetectedPlatform
                ] === 'boolean'
            ) {
                enabledToggle.checked =
                    currentSettings.platformEnabled[currentDetectedPlatform]!;
            } else {
                enabledToggle.checked = currentSettings.enabled;
            }
        }
        refreshVocabData();
    });

    // 2. Load settings from storage
    storage.get([NCW_STORAGE_KEYS.SETTINGS]).then((res) => {
        const storedSettings = res[NCW_STORAGE_KEYS.SETTINGS] as
            Partial<ExtensionSettings> | undefined;
        if (storedSettings && typeof storedSettings === 'object') {
            currentSettings = {
                ...currentSettings,
                ...storedSettings,
            };
        }
        syncUIWithSettings();
        refreshConnectionStatus();
    });

    // Load authoritative AI Sub state from Background
    messageService.getAiSubState().then((state: AiSubState | null) => {
        if (state && enabledToggle) {
            enabledToggle.checked = state.isPlatformEnabled(
                currentDetectedPlatform,
            );
        }
    });

    // Listen to background push events
    messageService.onAiSubStateChanged((state) => {
        if (enabledToggle) {
            enabledToggle.checked = state.isPlatformEnabled(
                currentDetectedPlatform,
            );
        }
    });

    messageService.onGlossaryChanged((ctx) => {
        // If we're locked to a specific episode tab, only update UI if context matches or is newer for this episode/show
        if (
            !currentActiveEpisodeId ||
            (ctx.showId && ctx.showId === currentActiveEpisodeId) ||
            (ctx.mainTitle &&
                currentActiveEpisodeTitle &&
                ctx.mainTitle.toLowerCase() ===
                    currentActiveEpisodeTitle.toLowerCase()) ||
            (currentContextDTO && currentContextDTO.showId === ctx.showId)
        ) {
            renderContext(ctx);
        }
    });

    function applyI18n(lang?: string): void {
        const l = lang || currentSettings.uiLanguage || 'en';
        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                el.textContent = NCW_I18N.getText(key, l);
            }
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) {
                el.setAttribute('placeholder', NCW_I18N.getText(key, l));
            }
        });

        document.querySelectorAll('[data-i18n-title]').forEach((el) => {
            const key = el.getAttribute('data-i18n-title');
            if (key) {
                el.setAttribute('title', NCW_I18N.getText(key, l));
            }
        });

        // Update dynamic slider values
        syncPipelineUI();
        const op =
            currentSettings.bgOpacity !== undefined
                ? currentSettings.bgOpacity
                : 0.0;
        if (bgOpacityVal) bgOpacityVal.textContent = `${Math.round(op * 100)}%`;
        const transOp =
            currentSettings.translationOpacity !== undefined
                ? currentSettings.translationOpacity
                : 1.0;
        if (transOpacityVal)
            transOpacityVal.textContent = `${Math.round(transOp * 100)}%`;

        updateVocabStatusHeader();
        if (currentVocabData) {
            renderVocabData(currentVocabData);
        }
    }

    function syncPipelineUI(): void {
        const config = NCW_CONSTANTS.getPipelineConfig(currentSettings);
        const l = currentSettings.uiLanguage || 'en';

        if (minCuesSlider) {
            minCuesSlider.value = String(config.minTranslateCues);
            if (minCuesVal) {
                minCuesVal.textContent = NCW_I18N.getText('minCuesVal', l, {
                    count: config.minTranslateCues,
                });
            }
        }
        if (maxCuesSlider) {
            maxCuesSlider.value = String(config.maxTranslateCues);
            if (maxCuesVal) {
                maxCuesVal.textContent = NCW_I18N.getText('maxCuesVal', l, {
                    count: config.maxTranslateCues,
                });
            }
        }
        if (refillSlider) {
            refillSlider.value = String(config.refillThreshold);
            if (refillVal) {
                refillVal.textContent = NCW_I18N.getText('refillHint', l, {
                    count: config.refillThreshold,
                });
            }
        }
        if (reviewBatchSlider) {
            reviewBatchSlider.value = String(config.reviewBatchSize);
            if (reviewBatchVal) {
                reviewBatchVal.textContent = NCW_I18N.getText(
                    'reviewBatchVal',
                    l,
                    {
                        count: config.reviewBatchSize,
                    },
                );
            }
        }
    }

    function syncUIWithSettings(): void {
        const l = currentSettings.uiLanguage || 'en';
        if (enabledToggle) {
            if (
                currentDetectedPlatform &&
                currentSettings.platformEnabled &&
                typeof currentSettings.platformEnabled[
                    currentDetectedPlatform
                ] === 'boolean'
            ) {
                enabledToggle.checked =
                    currentSettings.platformEnabled[currentDetectedPlatform]!;
            } else {
                enabledToggle.checked = currentSettings.enabled;
            }
        }

        const activeProvider = currentSettings.aiProvider || 'ollama';
        if (aiProviderSelect) {
            aiProviderSelect.value = activeProvider;
        }
        updateProviderVisibility(activeProvider);

        if (ollamaHostInput) {
            ollamaHostInput.value =
                currentSettings.ollamaHost || 'http://localhost:11434';
        }
        refreshPopupVaultStatus().catch(() => {});

        if (uiLanguageSelect) {
            uiLanguageSelect.value = currentSettings.uiLanguage || 'en';
        }
        if (enableSupervisorCheckbox) {
            enableSupervisorCheckbox.checked =
                currentSettings.enableSupervisor !== false;
        }
        const supEnabled = currentSettings.enableSupervisor !== false;
        if (supervisorModelGroup) {
            supervisorModelGroup.classList.toggle('disabled', !supEnabled);
        }
        if (openrouterSupervisorModelGroup) {
            openrouterSupervisorModelGroup.classList.toggle(
                'disabled',
                !supEnabled,
            );
        }
        if (reviewBatchGroup) {
            reviewBatchGroup.classList.toggle('disabled', !supEnabled);
        }

        // Populate OpenRouter selects with current/recommended options initially
        populateOpenRouterModelSelects(cachedOpenRouterModels);

        if (targetLanguageSelect) {
            targetLanguageSelect.innerHTML = Language.getAll()
                .map((l) => `<option value="${l.code}">${l.label}</option>`)
                .join('');
            const currentLang = Language.resolve(
                currentSettings.targetLanguage,
            );
            targetLanguageSelect.value = currentLang.code;
        }
        if (displayModeSelect) {
            displayModeSelect.value = currentSettings.displayMode;
        }
        if (preferNativeSubsCheckbox) {
            preferNativeSubsCheckbox.checked =
                currentSettings.preferNativeSubtitles !== false;
        }
        if (extractNativeTermsCheckbox) {
            extractNativeTermsCheckbox.checked = Boolean(
                currentSettings.extractTermsFromNativeSubtitles,
            );
        }
        if (extractNativeTermsGroup) {
            extractNativeTermsGroup.style.display =
                currentSettings.preferNativeSubtitles !== false
                    ? 'flex'
                    : 'none';
        }
        if (hideNativeSubsCheckbox) {
            hideNativeSubsCheckbox.checked =
                currentSettings.hideNativeSubtitles !== false;
        }
        if (enableLearningCheckbox) {
            enableLearningCheckbox.checked = Boolean(
                currentSettings.enableSubtitleLearning,
            );
        }
        if (enableDomSyncCheckbox) {
            enableDomSyncCheckbox.checked = Boolean(
                currentSettings.enableDomSubtitleSync,
            );
        }

        syncPipelineUI();

        if (fontSizeSlider) {
            fontSizeSlider.value = String(currentSettings.fontSize);
        }
        if (fontSizeVal) {
            fontSizeVal.textContent = `${currentSettings.fontSize}px`;
        }
        if (bgOpacitySlider) {
            const op =
                currentSettings.bgOpacity !== undefined
                    ? currentSettings.bgOpacity
                    : 0.0;
            bgOpacitySlider.value = String(Math.round(op * 100));
            if (bgOpacityVal)
                bgOpacityVal.textContent = `${Math.round(op * 100)}%`;
        }
        if (transOpacitySlider) {
            const transOp =
                currentSettings.translationOpacity !== undefined
                    ? currentSettings.translationOpacity
                    : 1.0;
            transOpacitySlider.value = String(Math.round(transOp * 100));
            if (transOpacityVal)
                transOpacityVal.textContent = `${Math.round(transOp * 100)}%`;
        }
        if (enableAutomaticAsrMergingCheckbox) {
            enableAutomaticAsrMergingCheckbox.checked =
                currentSettings.enableAutomaticAsrMerging !== false;
        }
        if (asrMergeBatchSlider) {
            const count = currentSettings.asrMergeBatchSize || 15;
            asrMergeBatchSlider.value = String(count);
            if (asrMergeBatchVal) {
                asrMergeBatchVal.textContent = NCW_I18N.getText(
                    'asrMergeBatchVal',
                    l,
                    { count },
                );
            }
        }
        if (asrSilenceThresholdSlider) {
            const count = currentSettings.asrSilenceThresholdMs || 600;
            asrSilenceThresholdSlider.value = String(count);
            if (asrSilenceThresholdVal) {
                asrSilenceThresholdVal.textContent = NCW_I18N.getText(
                    'asrSilenceThresholdVal',
                    l,
                    { count },
                );
            }
        }
        if (subOffsetSlider) {
            subOffsetSlider.value = String(currentSettings.subOffsetBottom);
        }
        if (subOffsetVal) {
            subOffsetVal.textContent = `${currentSettings.subOffsetBottom}px`;
        }
        if (showOriginalSmallerCheckbox) {
            showOriginalSmallerCheckbox.checked =
                currentSettings.showOriginalSmaller !== false;
        }
        if (swapSubtitleOrderCheckbox) {
            swapSubtitleOrderCheckbox.checked = Boolean(
                currentSettings.swapSubtitleOrder,
            );
        }
        if (enableGlassEffectCheckbox) {
            enableGlassEffectCheckbox.checked = Boolean(
                currentSettings.enableGlassEffect,
            );
        }
        if (enableAnimationCheckbox) {
            enableAnimationCheckbox.checked = Boolean(
                currentSettings.enableAnimation,
            );
        }

        if (syncOffsetVal) {
            const offset =
                typeof currentSettings.subSyncOffset === 'number'
                    ? currentSettings.subSyncOffset
                    : 0;
            const sign = offset > 0 ? '+' : '';
            syncOffsetVal.textContent = `${sign}${offset.toFixed(1)}s`;
        }

        // Vocab settings sync
        if (vocabEnabledToggle) {
            vocabEnabledToggle.checked = Boolean(
                currentSettings.vocabExtractorEnabled,
            );
        }
        const vocabProvider =
            currentSettings.vocabExtractorProvider || 'openrouter';
        if (vocabProviderSelect) {
            vocabProviderSelect.value = vocabProvider;
        }
        updateVocabProviderVisibility(vocabProvider);

        if (vocabDifficultySelect) {
            vocabDifficultySelect.value =
                currentSettings.vocabExtractorDifficulty || 'medium';
        }

        if (vocabSourceLangSelect) {
            const currentSrcLang =
                currentSettings.vocabSourceLanguage || 'auto';
            const autoLabel =
                NCW_I18N.getText(
                    'langAuto',
                    currentSettings.uiLanguage || 'en',
                ) || '✨ Auto Detect';
            vocabSourceLangSelect.innerHTML = [
                `<option value="auto">${autoLabel}</option>`,
                ...Language.getAll().map(
                    (l) => `<option value="${l.code}">${l.label}</option>`,
                ),
            ].join('');
            const matched = Language.get(currentSrcLang);
            vocabSourceLangSelect.value = matched
                ? matched.code
                : currentSrcLang === 'auto'
                  ? 'auto'
                  : Language.resolve(currentSrcLang).code;
        }

        if (vocabCustomPromptInput) {
            vocabCustomPromptInput.value =
                currentSettings.vocabExtractorCustomPrompt || '';
        }

        updateVocabStatusHeader();
        applyI18n(currentSettings.uiLanguage || 'en');
    }

    function updateProviderVisibility(provider: string): void {
        const isOllama = provider === 'ollama';
        const isOpenRouter = provider === 'openrouter';
        if (ollamaSettingsGroup)
            ollamaSettingsGroup.style.display = isOllama ? 'block' : 'none';
        if (openrouterSettingsGroup)
            openrouterSettingsGroup.style.display = isOpenRouter
                ? 'block'
                : 'none';

        // When Google Translate is active, supervisor is not needed
        if (provider === 'google') {
            if (supervisorModelGroup)
                supervisorModelGroup.classList.add('disabled');
            if (openrouterSupervisorModelGroup)
                openrouterSupervisorModelGroup.classList.add('disabled');
        }
    }

    function updateVocabProviderVisibility(provider: string): void {
        const isOllama = provider === 'ollama';
        if (vocabOllamaGroup)
            vocabOllamaGroup.style.display = isOllama ? 'block' : 'none';
        if (vocabOpenrouterGroup)
            vocabOpenrouterGroup.style.display = isOllama ? 'none' : 'block';
    }

    function refreshConnectionStatus(): void {
        const provider = currentSettings.aiProvider || 'google';
        const l = currentSettings.uiLanguage || 'en';

        if (provider === 'google') {
            if (statusDot) {
                statusDot.className = 'status-indicator status-connected';
            }
            if (statusTitle) {
                statusTitle.textContent = NCW_I18N.getText('statusGoogle', l);
            }
            if (statusDesc) {
                statusDesc.textContent = NCW_I18N.getText('providerGoogle', l);
            }
            if (btnRefreshModels) {
                btnRefreshModels.style.display = 'none';
            }
        } else if (provider === 'openrouter') {
            if (btnRefreshModels) {
                btnRefreshModels.style.display = 'inline-flex';
            }
            checkOpenRouterStatus();
        } else {
            if (btnRefreshModels) {
                btnRefreshModels.style.display = 'inline-flex';
            }
            checkOllamaStatus();
        }
    }

    function saveSettings(partial: Partial<ExtensionSettings>): void {
        const toSave = { ...partial };
        if (toSave.openrouterApiKey !== undefined) {
            const k = toSave.openrouterApiKey.trim();
            if (k && !k.includes('••')) {
                messageService.saveCredentials({ apiKey: k }).catch(() => {});
            }
            delete toSave.openrouterApiKey;
        }
        currentSettings = { ...currentSettings, ...toSave };
        delete (currentSettings as Partial<ExtensionSettings>).openrouterApiKey;
        storage.set({
            [NCW_STORAGE_KEYS.SETTINGS]: currentSettings,
        });
    }

    async function refreshPopupVaultStatus(): Promise<void> {
        try {
            const status = await messageService.getCredentialStatus();
            if (openrouterApiKeyInput) {
                if (status.hasKey) {
                    openrouterApiKeyInput.placeholder =
                        status.maskedKey || 'sk-or-••••••••';
                    if (
                        !openrouterApiKeyInput.value ||
                        openrouterApiKeyInput.value.includes('••')
                    ) {
                        openrouterApiKeyInput.value = status.maskedKey;
                    }
                    if (btnClearOpenRouterKey)
                        btnClearOpenRouterKey.style.display = 'inline';
                } else {
                    openrouterApiKeyInput.placeholder = 'sk-or-v1-...';
                    openrouterApiKeyInput.value = '';
                    if (btnClearOpenRouterKey)
                        btnClearOpenRouterKey.style.display = 'none';
                }
            }

            if (popupKeyStatus) {
                if (status.hasKey) {
                    if (status.isEncrypted) {
                        popupKeyStatus.textContent = status.isUnlocked
                            ? '🔒 Encrypted (AES-256) · Unlocked'
                            : '🔒 Encrypted (AES-256) · Locked';
                        popupKeyStatus.style.color = status.isUnlocked
                            ? '#46d369'
                            : '#f59e0b';
                    } else {
                        popupKeyStatus.textContent = 'Key configured (Local)';
                        popupKeyStatus.style.color = '#888';
                    }
                } else {
                    popupKeyStatus.textContent = '';
                }
            }

            if (popupVaultCard) {
                if (status.isEncrypted) {
                    popupVaultCard.style.display = 'block';
                    if (status.isUnlocked) {
                        if (popupVaultLockedView)
                            popupVaultLockedView.style.display = 'none';
                        if (popupVaultUnlockedView)
                            popupVaultUnlockedView.style.display = 'flex';
                    } else {
                        if (popupVaultLockedView)
                            popupVaultLockedView.style.display = 'block';
                        if (popupVaultUnlockedView)
                            popupVaultUnlockedView.style.display = 'none';
                        if (popupVaultPwdInput) popupVaultPwdInput.value = '';
                        if (popupVaultError)
                            popupVaultError.style.display = 'none';
                    }
                } else {
                    popupVaultCard.style.display = 'none';
                }
            }
        } catch (err) {
            logger.error(
                'popup',
                'Failed to refresh popup vault status',
                err,
            );
        }
    }

    // 2. Render Show Context & Memory Card
    function renderContext(ctx: ContextDTO | null): void {
        const l = currentSettings.uiLanguage || 'en';
        currentContextDTO = ctx;
        if (ctx) {
            if (ctx.showId && !currentActiveEpisodeId) {
                currentActiveEpisodeId = ctx.showId;
            }
            if (ctx.title || ctx.mainTitle) {
                currentActiveEpisodeTitle = ctx.mainTitle || ctx.title;
            }
            refreshVocabData();
        }

        if (!ctx || (!ctx.title && !ctx.mainTitle && !ctx.isWarmedUp)) {
            if (showTitle)
                showTitle.textContent = NCW_I18N.getText('waitingPlayback', l);
            if (memoryBadge) {
                memoryBadge.className = 'memory-badge badge-neutral';
                memoryBadge.textContent = NCW_I18N.getText('pendingBadge', l);
            }
            if (showSynopsis) showSynopsis.style.display = 'none';
            if (glossaryCount) glossaryCount.textContent = '0';
            if (glossaryTags) {
                glossaryTags.innerHTML = `<span class="empty-hint">${escapeHtml(NCW_I18N.getText('contextEmptyHint', l))}</span>`;
            }
            return;
        }

        const targetLangObj =
            typeof ctx.targetLanguage === 'object' &&
            ctx.targetLanguage !== null
                ? (ctx.targetLanguage as { name?: string; code?: string })
                : null;
        const targetLangName = targetLangObj
            ? targetLangObj.name || targetLangObj.code
            : ctx.targetLanguage;
        const langSuffix = targetLangName ? ` (${targetLangName})` : '';
        if (showTitle) {
            showTitle.textContent =
                (ctx.title ||
                    ctx.mainTitle ||
                    NCW_I18N.getText('waitingPlayback', l)) + langSuffix;
        }

        if (memoryBadge) {
            if (ctx.known) {
                memoryBadge.className = 'memory-badge badge-success';
                memoryBadge.textContent = NCW_I18N.getText(
                    'identifiedBadge',
                    l,
                );
            } else {
                memoryBadge.className = 'memory-badge badge-neutral';
                memoryBadge.textContent = NCW_I18N.getText('recordingBadge', l);
            }
        }

        if (showSynopsis) {
            const activeEpisodeCtx = ctx.episodes?.find(
                (ep) => ep.videoId === currentActiveEpisodeId,
            );
            const effectiveSynopsis = [
                ctx.showSynopsis,
                activeEpisodeCtx?.synopsis,
            ]
                .filter(Boolean)
                .join('\n\n')
                .trim();

            if (effectiveSynopsis) {
                showSynopsis.style.display = 'block';
                showSynopsis.textContent = effectiveSynopsis;
            } else {
                showSynopsis.style.display = 'none';
            }
        }

        // Merge and normalize characters
        function getNormalizeCharacters(
            context: ContextDTO,
        ): [Record<string, CharacterItem>, Record<string, CharacterItem>] {
            const manualSetupCharacters: Record<string, CharacterItem> = {
                ...(context.manualSetupCharacters || {}),
            };
            const characters: Record<string, CharacterItem> = {};

            for (const [name] of Object.entries(manualSetupCharacters)) {
                manualSetupCharacters[name].setByUser = true;
            }
            for (const [name, val] of Object.entries(
                context.characters || {},
            )) {
                if (
                    Object.prototype.hasOwnProperty.call(
                        manualSetupCharacters,
                        name,
                    )
                ) {
                    manualSetupCharacters[name].aliases = Array.from(
                        new Set([
                            ...(manualSetupCharacters[name].aliases || []),
                            ...(val?.aliases || []),
                        ]),
                    );
                    continue;
                }
                characters[name] = { ...val, setByUser: false };
            }
            return [manualSetupCharacters, characters];
        }

        // Merge and normalize terms
        function getNormalizeTerms(
            context: ContextDTO,
        ): [
            Record<string, { trans: string; setByUser: boolean }>,
            Record<string, { trans: string; setByUser: boolean }>,
        ] {
            const manualTerms: Record<
                string,
                { trans: string; setByUser: boolean }
            > = {};
            const autoTerms: Record<
                string,
                { trans: string; setByUser: boolean }
            > = {};

            for (const [term, trans] of Object.entries(
                context.manualSetupTerms || {},
            )) {
                manualTerms[term] = { trans, setByUser: true };
            }
            for (const [term, trans] of Object.entries(context.terms || {})) {
                if (Object.prototype.hasOwnProperty.call(manualTerms, term)) {
                    // User manual term takes precedence; skip auto term so it does not duplicate
                    continue;
                }
                autoTerms[term] = { trans, setByUser: false };
            }
            return [manualTerms, autoTerms];
        }

        const [manualSetupCharacters, characters] = getNormalizeCharacters(ctx);
        const [manualSetupTerms, autoTerms] = getNormalizeTerms(ctx);

        const charEntries = [
            ...Object.entries(manualSetupCharacters || {}),
            ...Object.entries(characters || {}),
        ];
        const termEntries = [
            ...Object.entries(manualSetupTerms || {}),
            ...Object.entries(autoTerms || {}),
        ];

        if (glossaryCount) {
            glossaryCount.textContent = String(
                charEntries.length + termEntries.length,
            );
        }

        if (!glossaryTags) return;

        if (charEntries.length === 0 && termEntries.length === 0) {
            glossaryTags.innerHTML = `<span class="empty-hint">${escapeHtml(NCW_I18N.getText('glossaryEmptyHint', l))}</span>`;
        } else {
            const delTitle = NCW_I18N.getText('deleteItem', l);
            const promoteTitle = NCW_I18N.getText('promoteItem', l);
            const charTagsHtml = charEntries.map(([name, val]) => {
                let canonical = name;
                let aliasesStr = '';
                if (typeof val === 'string') {
                    canonical = val;
                } else if (val && typeof val === 'object') {
                    canonical = val.canonical || name;
                    if (Array.isArray(val.aliases) && val.aliases.length > 0) {
                        const aliasTxt = NCW_I18N.getText('aliasesLabel', l, {
                            aliases: val.aliases.join(', '),
                        });
                        aliasesStr = `<span style="color:#aaa; font-size:10px;">${escapeHtml(aliasTxt)}</span>`;
                    }
                }
                const userSetClass =
                    val && typeof val === 'object' && val.setByUser
                        ? 'is-user-set'
                        : '';
                let result = `
          <div class="glossary-tag ${userSetClass}">
            <span class="tag-orig">${escapeHtml(name)}</span>:
            <span class="tag-trans">${escapeHtml(canonical)}</span>
            ${aliasesStr}
            <span class="tag-del" data-type="character" data-key="${escapeHtml(name)}" title="${escapeHtml(delTitle)}">×</span>
        `;
                if (val && typeof val === 'object' && !val.setByUser) {
                    result += `
          <span class="tag-promote" data-type="character" data-key="${escapeHtml(name)}" data-val="${escapeHtml(canonical)}" title="${escapeHtml(promoteTitle)}">↑</span>
          `;
                }
                return result + '</div>';
            });

            const termTagsHtml = termEntries.map(([term, data]) => {
                const isUserSet = data.setByUser;
                const userSetClass = isUserSet ? 'is-user-set' : '';
                return `
          <div class="glossary-tag ${userSetClass}">
            <span class="tag-orig">${escapeHtml(term)}</span>:
            <span class="tag-trans">${escapeHtml(data.trans)}</span>
            <span class="tag-del" data-type="term" data-key="${escapeHtml(term)}" title="${escapeHtml(delTitle)}">×</span>
            ${!isUserSet ? `<span class="tag-promote" data-type="term" data-key="${escapeHtml(term)}" data-val="${escapeHtml(data.trans)}" title="${escapeHtml(promoteTitle)}">↑</span>` : ''}
          </div>
        `;
            });

            glossaryTags.innerHTML = [...charTagsHtml, ...termTagsHtml].join(
                '',
            );
        }
    }

    function escapeHtml(str: string): string {
        return (str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Handle individual term/character deletion and promotion
    if (glossaryTags) {
        glossaryTags.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (!target) return;

            const itemType = target.getAttribute('data-type') || 'term';

            if (target.classList.contains('tag-del')) {
                const key = target.getAttribute('data-key');
                const showId =
                    currentContextDTO?.showId || currentActiveEpisodeId;
                const targetLang = currentContextDTO?.targetLanguage
                    ? Language.resolve(currentContextDTO.targetLanguage)
                    : currentSettings.targetLanguage || Language.DEFAULT;

                if (key && showId) {
                    const actionPromise =
                        itemType === 'character'
                            ? messageService.deleteCharacter(
                                  showId,
                                  targetLang,
                                  key,
                              )
                            : messageService.deleteTerm(
                                  key,
                                  showId,
                                  targetLang,
                              );

                    actionPromise.then((ctx) => {
                        if (ctx) {
                            renderContext(ctx);
                        }
                    });
                }
            } else if (target.classList.contains('tag-promote')) {
                const key = target.getAttribute('data-key');
                const val = target.getAttribute('data-val');
                const showId =
                    currentContextDTO?.showId || currentActiveEpisodeId;
                const targetLang = currentContextDTO?.targetLanguage
                    ? Language.resolve(currentContextDTO.targetLanguage)
                    : currentSettings.targetLanguage || Language.DEFAULT;

                if (key && val && showId) {
                    const actionPromise =
                        itemType === 'character'
                            ? messageService.updateCharacter(
                                  showId,
                                  targetLang,
                                  key,
                                  val,
                                  [],
                              )
                            : messageService.updateTerm(
                                  key,
                                  val,
                                  showId,
                                  targetLang,
                              );

                    actionPromise.then((ctx) => {
                        if (ctx) {
                            renderContext(ctx);
                        }
                    });
                }
            }
        });
    }

    // Handle opening standalone glossary editor window
    if (btnOpenEditor) {
        btnOpenEditor.addEventListener('click', () => {
            const params = new URLSearchParams();
            const showId = currentContextDTO?.showId || currentActiveEpisodeId;
            if (showId) {
                params.set('showId', showId);
            }
            if (currentActiveEpisodeId) {
                params.set('videoId', currentActiveEpisodeId);
            }
            if (currentActiveEpisodeTitle) {
                params.set('title', currentActiveEpisodeTitle);
            }
            if (currentSettings.targetLanguage) {
                const langCode =
                    typeof currentSettings.targetLanguage === 'object'
                        ? currentSettings.targetLanguage.code
                        : String(currentSettings.targetLanguage);
                params.set('targetLang', langCode);
            }
            if (currentSettings.uiLanguage) {
                params.set('uiLang', currentSettings.uiLanguage);
            }
            const query = params.toString();
            const pathWithQuery = query
                ? `editor/editor.html?${query}`
                : 'editor/editor.html';
            const editorUrl = platform.getURL(pathWithQuery);

            platform.openPopupWindow({
                url: editorUrl,
                width: 780,
                height: 820,
                title: 'AI Subtitle - Glossary Editor',
            });
        });
    }

    // Listen for real-time vocab events pushed from Background VocabService
    messageService.onVocabChanged((vocabData) => {
        if (
            vocabData &&
            (!currentActiveEpisodeId ||
                currentActiveEpisodeId === vocabData.movieId)
        ) {
            if (!currentActiveEpisodeId && vocabData.movieId) {
                currentActiveEpisodeId = vocabData.movieId;
            }
            renderVocabData(vocabData);
        }
    });

    if (btnResetContext) {
        btnResetContext.addEventListener('click', () => {
            const l = currentSettings.uiLanguage || 'en';
            if (confirm(NCW_I18N.getText('resetConfirm', l))) {
                const showId =
                    currentContextDTO?.showId || currentActiveEpisodeId;
                const targetLang = currentContextDTO?.targetLanguage
                    ? Language.resolve(currentContextDTO.targetLanguage)
                    : currentSettings.targetLanguage || Language.DEFAULT;

                if (showId) {
                    messageService
                        .resetGlossaryContext(showId, targetLang)
                        .then(() => {
                            renderContext(null);
                        });
                }
            }
        });
    }

    // Provider connectivity tracking & status badges
    let isOllamaConnected: boolean | null = null;
    let isOpenRouterConnected: boolean | null = null;

    function updateProviderStatusBadges(): void {
        // 1. Subtitles Provider Status
        const subProvider = currentSettings.aiProvider || 'google';
        if (subtitlesProviderStatus) {
            if (subProvider === 'google') {
                subtitlesProviderStatus.className =
                    'provider-status-badge status-ready';
                subtitlesProviderStatus.textContent = '🟢 Free / Ready';
                subtitlesProviderStatus.title =
                    'Google Translate (Ready, click to open AI Services)';
            } else if (subProvider === 'ollama') {
                if (isOllamaConnected === true) {
                    subtitlesProviderStatus.className =
                        'provider-status-badge status-ready';
                    subtitlesProviderStatus.textContent = '🟢 Connected';
                    subtitlesProviderStatus.title =
                        'Ollama connected (click to open AI Services)';
                } else if (isOllamaConnected === false) {
                    subtitlesProviderStatus.className =
                        'provider-status-badge status-offline';
                    subtitlesProviderStatus.textContent = '🔴 Disconnected';
                    subtitlesProviderStatus.title =
                        'Ollama offline (click to configure in AI Services)';
                } else {
                    subtitlesProviderStatus.className =
                        'provider-status-badge status-checking';
                    subtitlesProviderStatus.textContent = '🟡 Checking...';
                    subtitlesProviderStatus.title = 'Checking Ollama status';
                }
            } else if (subProvider === 'openrouter') {
                if (isOpenRouterConnected === true) {
                    subtitlesProviderStatus.className =
                        'provider-status-badge status-ready';
                    subtitlesProviderStatus.textContent = '🟢 Connected';
                    subtitlesProviderStatus.title =
                        'OpenRouter connected (click to open AI Services)';
                } else if (isOpenRouterConnected === false) {
                    subtitlesProviderStatus.className =
                        'provider-status-badge status-offline';
                    subtitlesProviderStatus.textContent = '🔴 Offline / No Key';
                    subtitlesProviderStatus.title =
                        'OpenRouter not configured (click to configure in AI Services)';
                } else {
                    subtitlesProviderStatus.className =
                        'provider-status-badge status-checking';
                    subtitlesProviderStatus.textContent = '🟡 Checking...';
                    subtitlesProviderStatus.title = 'Checking OpenRouter status';
                }
            }
        }

        // 2. Vocabulary Provider Status
        const vocProvider =
            currentSettings.vocabExtractorProvider || 'openrouter';
        if (vocabProviderStatus) {
            if (vocProvider === 'ollama') {
                if (isOllamaConnected === true) {
                    vocabProviderStatus.className =
                        'provider-status-badge status-ready';
                    vocabProviderStatus.textContent = '🟢 Connected';
                    vocabProviderStatus.title =
                        'Ollama connected (click to open AI Services)';
                } else if (isOllamaConnected === false) {
                    vocabProviderStatus.className =
                        'provider-status-badge status-offline';
                    vocabProviderStatus.textContent = '🔴 Disconnected';
                    vocabProviderStatus.title =
                        'Ollama offline (click to configure in AI Services)';
                } else {
                    vocabProviderStatus.className =
                        'provider-status-badge status-checking';
                    vocabProviderStatus.textContent = '🟡 Checking...';
                    vocabProviderStatus.title = 'Checking Ollama status';
                }
            } else {
                if (isOpenRouterConnected === true) {
                    vocabProviderStatus.className =
                        'provider-status-badge status-ready';
                    vocabProviderStatus.textContent = '🟢 Connected';
                    vocabProviderStatus.title =
                        'OpenRouter connected (click to open AI Services)';
                } else if (isOpenRouterConnected === false) {
                    vocabProviderStatus.className =
                        'provider-status-badge status-offline';
                    vocabProviderStatus.textContent = '🔴 Offline / No Key';
                    vocabProviderStatus.title =
                        'OpenRouter not configured (click to configure in AI Services)';
                } else {
                    vocabProviderStatus.className =
                        'provider-status-badge status-checking';
                    vocabProviderStatus.textContent = '🟡 Checking...';
                    vocabProviderStatus.title = 'Checking OpenRouter status';
                }
            }
        }

        // 3. AI Tab Badges
        if (aiTabOllamaStatus) {
            if (isOllamaConnected === true) {
                aiTabOllamaStatus.className =
                    'provider-status-badge status-ready';
                aiTabOllamaStatus.textContent = '🟢 Connected';
            } else if (isOllamaConnected === false) {
                aiTabOllamaStatus.className =
                    'provider-status-badge status-offline';
                aiTabOllamaStatus.textContent = '🔴 Disconnected';
            } else {
                aiTabOllamaStatus.className =
                    'provider-status-badge status-checking';
                aiTabOllamaStatus.textContent = '🟡 Checking...';
            }
        }

        if (aiTabOpenRouterStatus) {
            if (isOpenRouterConnected === true) {
                aiTabOpenRouterStatus.className =
                    'provider-status-badge status-ready';
                aiTabOpenRouterStatus.textContent = '🟢 Connected';
            } else if (isOpenRouterConnected === false) {
                aiTabOpenRouterStatus.className =
                    'provider-status-badge status-offline';
                aiTabOpenRouterStatus.textContent = '🔴 Offline / No Key';
            } else {
                aiTabOpenRouterStatus.className =
                    'provider-status-badge status-checking';
                aiTabOpenRouterStatus.textContent = '🟡 Checking...';
            }
        }
    }

    // 3. Check Ollama status & fetch models
    async function checkOllamaStatus(targetHost?: string): Promise<void> {
        const l = currentSettings.uiLanguage || 'en';
        const host = (
            targetHost ||
            currentSettings.ollamaHost ||
            'http://localhost:11434'
        )
            .trim()
            .replace(/\/+$/, '');
        const isCurrentProvider =
            (currentSettings.aiProvider || 'ollama') === 'ollama';

        if (isCurrentProvider) {
            if (statusDot) statusDot.className = 'status-indicator';
            if (statusTitle)
                statusTitle.textContent = NCW_I18N.getText('checkingConn', l);
            if (statusDesc) statusDesc.textContent = host;
        }

        const loadingTxt = NCW_I18N.getText('loadingModels', l);
        if (translationModelSelect) {
            translationModelSelect.innerHTML = `<option value="" disabled selected>${escapeHtml(loadingTxt)}</option>`;
        }
        if (supervisorModelSelect) {
            supervisorModelSelect.innerHTML = `<option value="" disabled selected>${escapeHtml(loadingTxt)}</option>`;
        }
        if (vocabOllamaModelSelect) {
            vocabOllamaModelSelect.innerHTML = `<option value="" disabled selected>${escapeHtml(loadingTxt)}</option>`;
        }

        const res = await messageService.checkOllama();
        const lang = currentSettings.uiLanguage || 'en';
        const isProvider =
            (currentSettings.aiProvider || 'ollama') === 'ollama';

        if (res && res.success && Array.isArray(res.models)) {
            const models = res.models;
            if (isProvider) {
                if (statusDot)
                    statusDot.className = 'status-indicator connected';
                if (statusTitle) {
                    statusTitle.textContent = NCW_I18N.getText(
                        'connected',
                        lang,
                        { count: models.length },
                    );
                }
                if (statusDesc) statusDesc.textContent = host;
            }

            if (translationModelSelect) translationModelSelect.innerHTML = '';
            if (supervisorModelSelect) supervisorModelSelect.innerHTML = '';
            if (vocabOllamaModelSelect) vocabOllamaModelSelect.innerHTML = '';

            if (models.length === 0) {
                const noModTxt = NCW_I18N.getText('noModelsFound', lang);
                if (translationModelSelect) {
                    translationModelSelect.innerHTML = `<option value="" disabled selected>${escapeHtml(noModTxt)}</option>`;
                }
                if (supervisorModelSelect) {
                    supervisorModelSelect.innerHTML = `<option value="" disabled selected>${escapeHtml(noModTxt)}</option>`;
                }
                if (vocabOllamaModelSelect) {
                    vocabOllamaModelSelect.innerHTML = `<option value="" disabled selected>${escapeHtml(noModTxt)}</option>`;
                }
                return;
            }

            models.forEach((m) => {
                if (translationModelSelect) {
                    const opt1 = document.createElement('option');
                    opt1.value = m.name;
                    opt1.textContent = m.name;
                    translationModelSelect.appendChild(opt1);
                }

                if (supervisorModelSelect) {
                    const opt2 = document.createElement('option');
                    opt2.value = m.name;
                    opt2.textContent = m.name;
                    supervisorModelSelect.appendChild(opt2);
                }

                if (vocabOllamaModelSelect) {
                    const opt3 = document.createElement('option');
                    opt3.value = m.name;
                    opt3.textContent = m.name;
                    vocabOllamaModelSelect.appendChild(opt3);
                }
            });

            // Restore selected Translation Model from actual server models
            const currentTransModel =
                currentSettings.translationModel || currentSettings.ollamaModel;
            if (translationModelSelect) {
                if (models.some((m) => m.name === currentTransModel)) {
                    translationModelSelect.value = currentTransModel;
                } else {
                    const preferredTrans = models.find((m) =>
                        m.name.toLowerCase().includes('translate'),
                    );
                    const selectedTrans = preferredTrans
                        ? preferredTrans.name
                        : models[0].name;
                    translationModelSelect.value = selectedTrans;
                    saveSettings({
                        translationModel: selectedTrans,
                        ollamaModel: selectedTrans,
                    });
                }
            }

            // Restore selected Supervisor Model from actual server models
            const currentSupModel = currentSettings.supervisorModel;
            if (supervisorModelSelect) {
                if (models.some((m) => m.name === currentSupModel)) {
                    supervisorModelSelect.value = currentSupModel;
                } else {
                    const preferredSup = models.find((m) => {
                        const n = m.name.toLowerCase();
                        return (
                            n.includes('gemma') ||
                            n.includes('qwen') ||
                            n.includes('llama')
                        );
                    });
                    const selectedSup = preferredSup
                        ? preferredSup.name
                        : models[0].name;
                    supervisorModelSelect.value = selectedSup;
                    saveSettings({ supervisorModel: selectedSup });
                }
            }

            // Restore selected Vocab Extractor Model from actual server models
            if (vocabOllamaModelSelect) {
                const currentVocabOllamaModel =
                    currentSettings.vocabExtractorOllamaModel;
                if (models.some((m) => m.name === currentVocabOllamaModel)) {
                    vocabOllamaModelSelect.value = currentVocabOllamaModel;
                } else {
                    const preferredVocab = models.find((m) => {
                        const n = m.name.toLowerCase();
                        return (
                            n.includes('qwen') ||
                            n.includes('gemma') ||
                            n.includes('llama')
                        );
                    });
                    const selectedVocab = preferredVocab
                        ? preferredVocab.name
                        : models[0].name;
                    vocabOllamaModelSelect.value = selectedVocab;
                    saveSettings({ vocabExtractorOllamaModel: selectedVocab });
                }
            }
            isOllamaConnected = true;
            updateProviderStatusBadges();
        } else {
            isOllamaConnected = false;
            updateProviderStatusBadges();
            if (isProvider) {
                if (statusDot)
                    statusDot.className = 'status-indicator disconnected';
                if (statusTitle)
                    statusTitle.textContent = NCW_I18N.getText(
                        'disconnected',
                        lang,
                    );
                if (statusDesc)
                    statusDesc.textContent =
                        res?.error ||
                        NCW_I18N.getText('disconnectedHint', lang);
            }

            const errTxt = NCW_I18N.getText('connFailed', lang);
            if (translationModelSelect) {
                translationModelSelect.innerHTML = `<option value="" disabled selected>${escapeHtml(errTxt)}</option>`;
            }
            if (supervisorModelSelect) {
                supervisorModelSelect.innerHTML = `<option value="" disabled selected>${escapeHtml(errTxt)}</option>`;
            }
            if (vocabOllamaModelSelect) {
                vocabOllamaModelSelect.innerHTML = `<option value="" disabled selected>${escapeHtml(errTxt)}</option>`;
            }
        }
    }

    // 3b. OpenRouter model population & connection check
    function populateOpenRouterModelSelects(
        models: OpenRouterModelItem[],
    ): void {
        if (Array.isArray(models) && models.length > 0) {
            cachedOpenRouterModels = models;
        }
        const modelList = cachedOpenRouterModels;
        const l = currentSettings.uiLanguage || 'en';

        const transSelect = openrouterTranslationModelSelect;
        const supSelect = openrouterSupervisorModelSelect;
        if (!transSelect || !supSelect) return;

        transSelect.innerHTML = '';
        supSelect.innerHTML = '';

        const recLabel =
            NCW_I18N.getText('groupRecommended', l) || '⭐ Recommended';
        const allLabel =
            NCW_I18N.getText('groupAllModels', l, {
                count: modelList.length,
            }) || `🌐 All Available Models (${modelList.length})`;
        const customOptionLabel =
            NCW_I18N.getText('customModelOption', l) ||
            '✏️ Enter custom model ID...';

        // 1. Recommended models group
        const recGroupTrans = document.createElement('optgroup');
        recGroupTrans.label = recLabel;
        const recGroupSup = document.createElement('optgroup');
        recGroupSup.label = recLabel;

        RECOMMENDED_OPENROUTER_MODELS.forEach((rm) => {
            const opt1 = document.createElement('option');
            opt1.value = rm.id;
            opt1.textContent = rm.name ? `${rm.name} (${rm.id})` : rm.id;
            recGroupTrans.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = rm.id;
            opt2.textContent = rm.name ? `${rm.name} (${rm.id})` : rm.id;
            recGroupSup.appendChild(opt2);
        });

        transSelect.appendChild(recGroupTrans);
        supSelect.appendChild(recGroupSup);

        // 2. All Models group
        if (modelList.length > 0) {
            const allGroupTrans = document.createElement('optgroup');
            allGroupTrans.label = allLabel;
            const allGroupSup = document.createElement('optgroup');
            allGroupSup.label = allLabel;

            modelList.forEach((m) => {
                if (RECOMMENDED_OPENROUTER_MODELS.some((rm) => rm.id === m.id))
                    return;
                const displayName =
                    m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id;

                const opt1 = document.createElement('option');
                opt1.value = m.id;
                opt1.textContent = displayName;
                allGroupTrans.appendChild(opt1);

                const opt2 = document.createElement('option');
                opt2.value = m.id;
                opt2.textContent = displayName;
                allGroupSup.appendChild(opt2);
            });

            transSelect.appendChild(allGroupTrans);
            supSelect.appendChild(allGroupSup);
        }

        // 3. Custom Model ID option
        const customOptTrans = document.createElement('option');
        customOptTrans.value = '__custom__';
        customOptTrans.textContent = customOptionLabel;
        transSelect.appendChild(customOptTrans);

        const customOptSup = document.createElement('option');
        customOptSup.value = '__custom__';
        customOptSup.textContent = customOptionLabel;
        supSelect.appendChild(customOptSup);

        // Set selection for translation model
        const savedTransModel =
            currentSettings.openrouterTranslationModel ||
            'deepseek/deepseek-chat';
        const transOptions = Array.from(transSelect.querySelectorAll('option'));
        const matchedTrans = transOptions.find(
            (o) => o.value === savedTransModel,
        );
        if (matchedTrans) {
            transSelect.value = savedTransModel;
            if (openrouterCustomTranslationModelInput) {
                openrouterCustomTranslationModelInput.style.display = 'none';
            }
        } else {
            transSelect.value = '__custom__';
            if (openrouterCustomTranslationModelInput) {
                openrouterCustomTranslationModelInput.style.display = 'block';
                openrouterCustomTranslationModelInput.value = savedTransModel;
            }
        }

        // Set selection for supervisor model
        const savedSupModel =
            currentSettings.openrouterSupervisorModel ||
            'google/gemini-2.5-flash';
        const supOptions = Array.from(supSelect.querySelectorAll('option'));
        const matchedSup = supOptions.find((o) => o.value === savedSupModel);
        if (matchedSup) {
            supSelect.value = savedSupModel;
            if (openrouterCustomSupervisorModelInput) {
                openrouterCustomSupervisorModelInput.style.display = 'none';
            }
        } else {
            supSelect.value = '__custom__';
            if (openrouterCustomSupervisorModelInput) {
                openrouterCustomSupervisorModelInput.style.display = 'block';
                openrouterCustomSupervisorModelInput.value = savedSupModel;
            }
        }

        // Set selection for dedicated vocab model
        if (vocabOpenrouterModelSelect) {
            vocabOpenrouterModelSelect.innerHTML = '';
            const recGroupVocab = document.createElement('optgroup');
            recGroupVocab.label = recLabel;
            RECOMMENDED_OPENROUTER_MODELS.forEach((rm) => {
                const opt = document.createElement('option');
                opt.value = rm.id;
                opt.textContent = rm.name ? `${rm.name} (${rm.id})` : rm.id;
                recGroupVocab.appendChild(opt);
            });
            vocabOpenrouterModelSelect.appendChild(recGroupVocab);

            if (modelList.length > 0) {
                const allGroupVocab = document.createElement('optgroup');
                allGroupVocab.label = allLabel;
                modelList.forEach((m) => {
                    if (
                        RECOMMENDED_OPENROUTER_MODELS.some(
                            (rm) => rm.id === m.id,
                        )
                    )
                        return;
                    const displayName =
                        m.name && m.name !== m.id
                            ? `${m.name} (${m.id})`
                            : m.id;
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = displayName;
                    allGroupVocab.appendChild(opt);
                });
                vocabOpenrouterModelSelect.appendChild(allGroupVocab);
            }

            const customOptVocab = document.createElement('option');
            customOptVocab.value = '__custom__';
            customOptVocab.textContent = customOptionLabel;
            vocabOpenrouterModelSelect.appendChild(customOptVocab);

            const savedVocabModel =
                currentSettings.vocabExtractorModel || 'deepseek/deepseek-chat';
            const vocabOptions = Array.from(
                vocabOpenrouterModelSelect.querySelectorAll('option'),
            );
            const matchedVocab = vocabOptions.find(
                (o) => o.value === savedVocabModel,
            );
            if (matchedVocab) {
                vocabOpenrouterModelSelect.value = savedVocabModel;
                if (vocabCustomOpenrouterModelInput) {
                    vocabCustomOpenrouterModelInput.style.display = 'none';
                }
            } else {
                vocabOpenrouterModelSelect.value = '__custom__';
                if (vocabCustomOpenrouterModelInput) {
                    vocabCustomOpenrouterModelInput.style.display = 'block';
                    vocabCustomOpenrouterModelInput.value = savedVocabModel;
                }
            }
        }
    }

    async function checkOpenRouterStatus(
        forceCheck: boolean = false,
    ): Promise<void> {
        const l = currentSettings.uiLanguage || 'en';
        const vaultStatus = await messageService.getCredentialStatus();
        const baseUrl = (
            currentSettings.openrouterBaseUrl || 'https://openrouter.ai/api/v1'
        ).trim();
        const isCurrentProvider =
            (currentSettings.aiProvider || 'ollama') === 'openrouter';

        if (isCurrentProvider) {
            if (statusDot) statusDot.className = 'status-indicator';
            if (statusTitle)
                statusTitle.textContent = NCW_I18N.getText(
                    'checkingOpenRouter',
                    l,
                );
            if (statusDesc) statusDesc.textContent = baseUrl;
        }

        if (!vaultStatus.hasKey) {
            isOpenRouterConnected = false;
            updateProviderStatusBadges();
            if (isCurrentProvider) {
                if (statusDot)
                    statusDot.className = 'status-indicator disconnected';
                if (statusTitle)
                    statusTitle.textContent = NCW_I18N.getText(
                        'disconnected',
                        l,
                    );
                if (statusDesc)
                    statusDesc.textContent = NCW_I18N.getText(
                        'openrouterApiKeyHint',
                        l,
                    );
            }

            const res = await messageService.fetchOpenRouterModels();
            if (
                res &&
                res.success &&
                Array.isArray(res.models) &&
                res.models.length > 0
            ) {
                populateOpenRouterModelSelects(res.models);
            } else {
                populateOpenRouterModelSelects([]);
            }
            return;
        }

        if (vaultStatus.isEncrypted && !vaultStatus.isUnlocked && !forceCheck) {
            isOpenRouterConnected = false;
            updateProviderStatusBadges();
            if (isCurrentProvider) {
                if (statusDot)
                    statusDot.className = 'status-indicator disconnected';
                if (statusTitle)
                    statusTitle.textContent = NCW_I18N.getText(
                        'vaultStatusLocked',
                        l,
                    );
                if (statusDesc)
                    statusDesc.textContent = 'Master Password required to unlock';
            }
            return;
        }

        const res = await messageService.checkOpenRouter();
        await refreshPopupVaultStatus();
        const lang = currentSettings.uiLanguage || 'en';
        const isProvider =
            (currentSettings.aiProvider || 'ollama') === 'openrouter';

        if (res && res.success) {
            isOpenRouterConnected = true;
            updateProviderStatusBadges();
            const models = res.data?.models || [];
            if (isProvider) {
                if (statusDot)
                    statusDot.className = 'status-indicator connected';
                if (statusTitle) {
                    statusTitle.textContent = NCW_I18N.getText(
                        'openrouterConnected',
                        lang,
                        {
                            count: models.length,
                        },
                    );
                }

                const info = res.data?.keyInfo;
                let descText = baseUrl;
                if (info) {
                    const usage =
                        info.usage !== undefined
                            ? `$${Number(info.usage).toFixed(2)}`
                            : null;
                    const limit = info.limit ? `$${info.limit}` : null;
                    if (usage && limit) {
                        descText = `Usage: ${usage} / ${limit}`;
                    } else if (usage) {
                        descText = `Usage: ${usage}`;
                    } else if (info.label) {
                        descText = `Key: ${info.label}`;
                    }
                }
                if (statusDesc) statusDesc.textContent = descText;
            }

            populateOpenRouterModelSelects(models);
        } else {
            isOpenRouterConnected = false;
            updateProviderStatusBadges();
            if (isProvider) {
                if (statusDot)
                    statusDot.className = 'status-indicator disconnected';
                if (statusTitle)
                    statusTitle.textContent = NCW_I18N.getText(
                        'openrouterFailed',
                        lang,
                    );
                if (statusDesc)
                    statusDesc.textContent =
                        res?.error ||
                        NCW_I18N.getText('disconnectedHint', lang);
            }

            const mRes = await messageService.fetchOpenRouterModels();
            if (mRes && mRes.success && Array.isArray(mRes.models)) {
                populateOpenRouterModelSelects(mRes.models);
            }
        }
    }

    // Handle custom Ollama host connection
    function handleHostChange(): void {
        let host = (ollamaHostInput ? ollamaHostInput.value : '').trim();
        if (!host) {
            host = 'http://localhost:11434';
        }
        if (!/^https?:\/\//i.test(host)) {
            host = `http://${host}`;
        }
        host = host.replace(/\/+$/, '');
        if (ollamaHostInput) {
            ollamaHostInput.value = host;
        }
        if (statusDesc) statusDesc.textContent = host;
        saveSettings({ ollamaHost: host });
        checkOllamaStatus(host);
    }

    if (btnSaveHost) {
        btnSaveHost.addEventListener('click', handleHostChange);
    }

    if (ollamaHostInput) {
        ollamaHostInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleHostChange();
            }
        });
    }

    // 4. UI Event Listeners
    if (enabledToggle) {
        enabledToggle.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            const isEnabled = target.checked;
            if (currentDetectedPlatform) {
                const updatedPlatformEnabled = {
                    ...(currentSettings.platformEnabled || {}),
                    [currentDetectedPlatform]: isEnabled,
                };
                saveSettings({
                    platformEnabled: updatedPlatformEnabled,
                });
                messageService.setAiSubEnabled(
                    isEnabled,
                    currentDetectedPlatform,
                );
            } else {
                saveSettings({ enabled: isEnabled });
                messageService.setAiSubEnabled(isEnabled);
            }
        });
    }

    if (aiProviderSelect) {
        aiProviderSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            const provider = target.value as TranslationProvider;
            saveSettings({ aiProvider: provider });
            updateProviderVisibility(provider);
            syncPipelineUI();
            refreshConnectionStatus();
        });
    }

    if (openrouterApiKeyInput) {
        openrouterApiKeyInput.addEventListener('focus', () => {
            if (openrouterApiKeyInput.value.includes('••')) {
                openrouterApiKeyInput.value = '';
            }
        });

        openrouterApiKeyInput.addEventListener('blur', () => {
            if (!openrouterApiKeyInput.value.trim()) {
                refreshPopupVaultStatus().catch(() => {});
            }
        });

        openrouterApiKeyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const target = e.target as HTMLInputElement;
                const val = target.value.trim();
                if (val && !val.includes('••')) {
                    messageService
                        .saveCredentials({ apiKey: val })
                        .then(() => {
                            refreshPopupVaultStatus();
                            checkOpenRouterStatus();
                        })
                        .catch(() => {});
                }
            }
        });
    }

    if (btnClearOpenRouterKey) {
        btnClearOpenRouterKey.addEventListener('click', async () => {
            await messageService.clearCredentials();
            await refreshPopupVaultStatus();
            checkOpenRouterStatus();
        });
    }

    if (btnPopupVaultUnlock && popupVaultPwdInput) {
        btnPopupVaultUnlock.addEventListener('click', async () => {
            const pwd = popupVaultPwdInput.value || '';
            if (!pwd) return;
            const res = await messageService.unlockCredentials(pwd);
            if (res.success) {
                if (popupVaultError) popupVaultError.style.display = 'none';
                await refreshPopupVaultStatus();
                checkOpenRouterStatus();
            } else {
                if (popupVaultError) {
                    popupVaultError.textContent =
                        res.error === 'INVALID_PASSWORD'
                            ? NCW_I18N.getText(
                                  'incorrectPassword',
                                  currentSettings.uiLanguage || 'en',
                              )
                            : res.error || 'Unlock failed';
                    popupVaultError.style.display = 'block';
                }
            }
        });

        popupVaultPwdInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                btnPopupVaultUnlock?.click();
            }
        });
    }

    if (btnPopupVaultLock) {
        btnPopupVaultLock.addEventListener('click', async () => {
            await messageService.lockCredentials();
            await refreshPopupVaultStatus();
            checkOpenRouterStatus();
        });
    }

    if (btnToggleKey && openrouterApiKeyInput) {
        btnToggleKey.addEventListener('click', () => {
            const isPwd = openrouterApiKeyInput.type === 'password';
            openrouterApiKeyInput.type = isPwd ? 'text' : 'password';
            btnToggleKey.textContent = isPwd ? '🙈' : '👁️';
        });
    }

    if (btnTestOpenRouter) {
        btnTestOpenRouter.addEventListener('click', async () => {
            if (openrouterApiKeyInput) {
                const val = openrouterApiKeyInput.value.trim();
                if (val && !val.includes('••')) {
                    await messageService.saveCredentials({ apiKey: val });
                    await refreshPopupVaultStatus();
                }
            }
            await checkOpenRouterStatus(true);
            await refreshPopupVaultStatus();
        });
    }

    if (openrouterTranslationModelSelect) {
        openrouterTranslationModelSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            const val = target.value;
            if (val === '__custom__') {
                if (openrouterCustomTranslationModelInput) {
                    openrouterCustomTranslationModelInput.style.display =
                        'block';
                    openrouterCustomTranslationModelInput.focus();
                }
            } else {
                if (openrouterCustomTranslationModelInput) {
                    openrouterCustomTranslationModelInput.style.display =
                        'none';
                }
                saveSettings({ openrouterTranslationModel: val });
            }
        });
    }

    if (openrouterCustomTranslationModelInput) {
        openrouterCustomTranslationModelInput.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            const val = target.value.trim();
            if (val) {
                saveSettings({ openrouterTranslationModel: val });
            }
        });
    }

    if (openrouterSupervisorModelSelect) {
        openrouterSupervisorModelSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            const val = target.value;
            if (val === '__custom__') {
                if (openrouterCustomSupervisorModelInput) {
                    openrouterCustomSupervisorModelInput.style.display =
                        'block';
                    openrouterCustomSupervisorModelInput.focus();
                }
            } else {
                if (openrouterCustomSupervisorModelInput) {
                    openrouterCustomSupervisorModelInput.style.display = 'none';
                }
                saveSettings({ openrouterSupervisorModel: val });
            }
        });
    }

    if (openrouterCustomSupervisorModelInput) {
        openrouterCustomSupervisorModelInput.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            const val = target.value.trim();
            if (val) {
                saveSettings({ openrouterSupervisorModel: val });
            }
        });
    }

    if (uiLanguageSelect) {
        uiLanguageSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            const selected = target.value as 'en' | 'zh' | 'ja' | 'ko';
            saveSettings({ uiLanguage: selected });
            applyI18n(selected);
            if (currentSettings.aiProvider === 'openrouter') {
                populateOpenRouterModelSelects(cachedOpenRouterModels);
            }
            refreshConnectionStatus();
            if (currentActiveTab?.id !== undefined) {
                messageService
                    .getGlossaryContext(currentActiveTab.id)
                    .then((ctx) => {
                        if (ctx) {
                            renderContext(ctx);
                        }
                    });
            }
        });
    }

    if (translationModelSelect) {
        translationModelSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            saveSettings({
                translationModel: target.value,
                ollamaModel: target.value,
            });
        });
    }

    if (enableSupervisorCheckbox) {
        enableSupervisorCheckbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            const enabled = target.checked;
            saveSettings({ enableSupervisor: enabled });
            if (supervisorModelGroup)
                supervisorModelGroup.classList.toggle('disabled', !enabled);
            if (openrouterSupervisorModelGroup)
                openrouterSupervisorModelGroup.classList.toggle(
                    'disabled',
                    !enabled,
                );
            if (reviewBatchGroup)
                reviewBatchGroup.classList.toggle('disabled', !enabled);
        });
    }

    if (supervisorModelSelect) {
        supervisorModelSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            saveSettings({ supervisorModel: target.value });
        });
    }

    if (targetLanguageSelect) {
        targetLanguageSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            const selectedLang = Language.resolve(target.value);
            saveSettings({ targetLanguage: selectedLang });
            if (currentActiveTab?.id !== undefined) {
                messageService
                    .getGlossaryContext(currentActiveTab.id)
                    .then((ctx) => {
                        if (ctx) {
                            renderContext(ctx);
                        }
                    });
            }
        });
    }

    if (displayModeSelect) {
        displayModeSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            saveSettings({
                displayMode: target.value as
                    'bilingual' | 'translated' | 'original',
            });
        });
    }

    if (preferNativeSubsCheckbox) {
        preferNativeSubsCheckbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            saveSettings({ preferNativeSubtitles: target.checked });
            if (extractNativeTermsGroup) {
                extractNativeTermsGroup.style.display = target.checked
                    ? 'flex'
                    : 'none';
            }
        });
    }

    if (extractNativeTermsCheckbox) {
        extractNativeTermsCheckbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            saveSettings({ extractTermsFromNativeSubtitles: target.checked });
        });
    }

    if (hideNativeSubsCheckbox) {
        hideNativeSubsCheckbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            saveSettings({ hideNativeSubtitles: target.checked });
        });
    }

    if (enableLearningCheckbox) {
        enableLearningCheckbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            saveSettings({ enableSubtitleLearning: target.checked });
        });
    }

    if (minCuesSlider) {
        minCuesSlider.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            const val = parseInt(target.value, 10);
            const l = currentSettings.uiLanguage || 'en';
            if (minCuesVal) {
                minCuesVal.textContent = NCW_I18N.getText('minCuesVal', l, {
                    count: val,
                });
            }
            const provider = currentSettings.aiProvider || 'ollama';
            if (provider === 'openrouter') {
                saveSettings({ openrouterMinTranslateCues: val });
            } else {
                saveSettings({
                    ollamaMinTranslateCues: val,
                    minTranslateCues: val,
                });
            }
        });
    }

    if (maxCuesSlider) {
        maxCuesSlider.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            const val = parseInt(target.value, 10);
            const l = currentSettings.uiLanguage || 'en';
            if (maxCuesVal) {
                maxCuesVal.textContent = NCW_I18N.getText('maxCuesVal', l, {
                    count: val,
                });
            }
            const provider = currentSettings.aiProvider || 'ollama';
            if (provider === 'openrouter') {
                saveSettings({ openrouterMaxTranslateCues: val });
            } else {
                saveSettings({
                    ollamaMaxTranslateCues: val,
                    translateBatchSize: val,
                });
            }
        });
    }

    if (refillSlider) {
        refillSlider.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            const val = parseInt(target.value, 10);
            const l = currentSettings.uiLanguage || 'en';
            if (refillVal) {
                refillVal.textContent = NCW_I18N.getText('refillHint', l, {
                    count: val,
                });
            }
            const provider = currentSettings.aiProvider || 'ollama';
            if (provider === 'openrouter') {
                saveSettings({ openrouterRefillThreshold: val });
            } else {
                saveSettings({
                    ollamaRefillThreshold: val,
                    refillThreshold: val,
                });
            }
        });
    }

    if (reviewBatchSlider) {
        reviewBatchSlider.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            const val = parseInt(target.value, 10);
            const l = currentSettings.uiLanguage || 'en';
            if (reviewBatchVal) {
                reviewBatchVal.textContent = NCW_I18N.getText(
                    'reviewBatchVal',
                    l,
                    { count: val },
                );
            }
            const provider = currentSettings.aiProvider || 'ollama';
            if (provider === 'openrouter') {
                saveSettings({ openrouterReviewBatchSize: val });
            } else {
                saveSettings({
                    ollamaReviewBatchSize: val,
                    reviewBatchSize: val,
                });
            }
        });
    }

    if (enableAutomaticAsrMergingCheckbox) {
        enableAutomaticAsrMergingCheckbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            saveSettings({ enableAutomaticAsrMerging: target.checked });
        });
    }

    if (asrMergeBatchSlider) {
        asrMergeBatchSlider.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            const val = parseInt(target.value, 10);
            const l = currentSettings.uiLanguage || 'en';
            if (asrMergeBatchVal) {
                asrMergeBatchVal.textContent = NCW_I18N.getText(
                    'asrMergeBatchVal',
                    l,
                    { count: val },
                );
            }
            saveSettings({ asrMergeBatchSize: val });
        });
    }

    if (asrSilenceThresholdSlider) {
        asrSilenceThresholdSlider.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            const val = parseInt(target.value, 10);
            const l = currentSettings.uiLanguage || 'en';
            if (asrSilenceThresholdVal) {
                asrSilenceThresholdVal.textContent = NCW_I18N.getText(
                    'asrSilenceThresholdVal',
                    l,
                    { count: val },
                );
            }
            saveSettings({ asrSilenceThresholdMs: val });
        });
    }

    if (fontSizeSlider) {
        fontSizeSlider.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            if (fontSizeVal) fontSizeVal.textContent = `${target.value}px`;
            saveSettings({ fontSize: parseInt(target.value, 10) });
        });
    }

    if (bgOpacitySlider) {
        bgOpacitySlider.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            if (bgOpacityVal) bgOpacityVal.textContent = `${target.value}%`;
            saveSettings({ bgOpacity: parseInt(target.value, 10) / 100 });
        });
    }

    if (transOpacitySlider) {
        transOpacitySlider.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            if (transOpacityVal)
                transOpacityVal.textContent = `${target.value}%`;
            saveSettings({
                translationOpacity: parseInt(target.value, 10) / 100,
            });
        });
    }

    if (subOffsetSlider) {
        subOffsetSlider.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            if (subOffsetVal) subOffsetVal.textContent = `${target.value}px`;
            saveSettings({ subOffsetBottom: parseInt(target.value, 10) });
        });
    }

    if (showOriginalSmallerCheckbox) {
        showOriginalSmallerCheckbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            saveSettings({ showOriginalSmaller: target.checked });
        });
    }

    if (swapSubtitleOrderCheckbox) {
        swapSubtitleOrderCheckbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            saveSettings({ swapSubtitleOrder: target.checked });
        });
    }

    if (enableGlassEffectCheckbox) {
        enableGlassEffectCheckbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            saveSettings({ enableGlassEffect: target.checked });
        });
    }

    if (enableAnimationCheckbox) {
        enableAnimationCheckbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            saveSettings({ enableAnimation: target.checked });
        });
    }

    function updateSyncOffset(val: number): void {
        const rounded = Math.round(val * 10) / 10;
        saveSettings({ subSyncOffset: rounded });
        const sign = rounded > 0 ? '+' : '';
        if (syncOffsetVal)
            syncOffsetVal.textContent = `${sign}${rounded.toFixed(1)}s`;
    }

    if (btnSyncEarlier) {
        btnSyncEarlier.addEventListener('click', () => {
            const cur =
                typeof currentSettings.subSyncOffset === 'number'
                    ? currentSettings.subSyncOffset
                    : 0;
            updateSyncOffset(cur + 0.5);
        });
    }

    if (btnSyncLater) {
        btnSyncLater.addEventListener('click', () => {
            const cur =
                typeof currentSettings.subSyncOffset === 'number'
                    ? currentSettings.subSyncOffset
                    : 0;
            updateSyncOffset(cur - 0.5);
        });
    }

    if (btnSyncReset) {
        btnSyncReset.addEventListener('click', () => {
            updateSyncOffset(0);
        });
    }

    if (enableDomSyncCheckbox) {
        enableDomSyncCheckbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            saveSettings({ enableDomSubtitleSync: target.checked });
        });
    }

    if (btnRefreshModels) {
        btnRefreshModels.addEventListener('click', () => {
            refreshConnectionStatus();
        });
    }

    // 5. Test Translation & Supervision
    if (btnTest) {
        btnTest.addEventListener('click', async () => {
            const text = testInput ? testInput.value.trim() : '';
            if (!text) return;

            const l = currentSettings.uiLanguage || 'en';
            if (testResult) {
                testResult.innerHTML = `<span style="color: #aaa;">${escapeHtml(NCW_I18N.getText('testDrafting', l))}</span>`;
            }
            const startTime = performance.now();

            const activeProvider = currentSettings.aiProvider || 'ollama';
            let supModel = supervisorModelSelect
                ? supervisorModelSelect.value
                : '';

            if (activeProvider === 'openrouter') {
                supModel =
                    openrouterSupervisorModelSelect.value === '__custom__'
                        ? openrouterCustomSupervisorModelInput
                            ? openrouterCustomSupervisorModelInput.value.trim()
                            : ''
                        : openrouterSupervisorModelSelect.value;
                if (!supModel) {
                    supModel =
                        currentSettings.openrouterSupervisorModel ||
                        'google/gemini-2.5-flash';
                }
            }

            const res = await messageService.translateBatch([{ id: 1, text }]);
            const transTime = Math.round(performance.now() - startTime);

            if (res && res.success && res.results && res.results[1]) {
                const rawTrans = res.results[1];
                const transTitle = NCW_I18N.getText('testTransDone', l, {
                    time: transTime,
                });
                const reviewingTxt = NCW_I18N.getText('testReviewing', l, {
                    model: supModel,
                });

                if (currentSettings.enableSupervisor === false) {
                    const disabledMsg = NCW_I18N.getText(
                        'testSupervisorDisabled',
                        l,
                    );
                    if (testResult) {
                        testResult.innerHTML = `
              <div style="color: #4caf50; font-weight: bold; margin-bottom: 3px;">
                ${escapeHtml(transTitle)}
              </div>
              <div style="color: #fff; margin-bottom: 6px;">${escapeHtml(rawTrans)}</div>
              <div style="color: #888; font-size: 11px;">${escapeHtml(disabledMsg)}</div>
            `;
                    }
                    return;
                }

                if (testResult) {
                    testResult.innerHTML = `
            <div style="color: #4caf50; font-weight: bold; margin-bottom: 3px;">
              ${escapeHtml(transTitle)}
            </div>
            <div style="color: #fff; margin-bottom: 6px;">${escapeHtml(rawTrans)}</div>
            <div style="color: #ff9800; font-size: 11px;">${escapeHtml(reviewingTxt)}</div>
          `;
                }

                // Trigger supervisor review on this sample
                const supStartTime = performance.now();
                const supRes = await messageService.supervisorReview([
                    { id: 1, orig: text, trans: rawTrans },
                ]);
                const supTime = Math.round(performance.now() - supStartTime);
                const corrections = supRes?.corrections || {};
                const corrected = corrections[1] || corrections['1'];
                const supDoneTitle = NCW_I18N.getText('testSupervisorDone', l, {
                    time: supTime,
                });
                const noCorrectionTxt = NCW_I18N.getText('testNoCorrection', l);

                if (testResult) {
                    testResult.innerHTML = `
            <div style="color: #4caf50; font-weight: bold; margin-bottom: 2px;">
              ${escapeHtml(transTitle)}
            </div>
            <div style="color: #bbb; margin-bottom: 6px;">${escapeHtml(rawTrans)}</div>
            <div style="color: #2196f3; font-weight: bold; margin-bottom: 2px;">
              ${escapeHtml(supDoneTitle)}
            </div>
            <div style="color: #fff;">${escapeHtml(corrected || noCorrectionTxt)}</div>
          `;
                }
            } else {
                const failMsg = NCW_I18N.getText('testFailed', l, {
                    error: res?.error || 'Unknown error',
                });
                if (testResult) {
                    testResult.innerHTML = `
            <div style="color: #f44336; font-weight: bold;">
              ${escapeHtml(failMsg)}
            </div>
          `;
                }
            }
        });
    }

    // 6. Navigation Tabs & Episode Vocabulary Collector
    function switchTab(targetTabId: string): void {
        const tabs = [
            { id: 'tab-subtitles', btn: tabBtnSubtitles, content: tabSubtitles },
            { id: 'tab-vocab', btn: tabBtnVocab, content: tabVocab },
            { id: 'tab-ai', btn: tabBtnAi, content: tabAi },
        ];
        tabs.forEach((tab) => {
            const isActive = tab.id === targetTabId;
            if (tab.btn) tab.btn.classList.toggle('active', isActive);
            if (tab.content) tab.content.classList.toggle('active', isActive);
        });
        try {
            sessionStorage.setItem('ncw_active_tab', targetTabId);
        } catch {
            // Ignore session storage errors
        }
        if (targetTabId === 'tab-vocab') {
            refreshVocabData();
        }
    }

    if (tabBtnSubtitles) {
        tabBtnSubtitles.addEventListener('click', () =>
            switchTab('tab-subtitles'),
        );
    }
    if (tabBtnVocab) {
        tabBtnVocab.addEventListener('click', () => switchTab('tab-vocab'));
    }
    if (tabBtnAi) {
        tabBtnAi.addEventListener('click', () => switchTab('tab-ai'));
    }
    if (subtitlesProviderStatus) {
        subtitlesProviderStatus.addEventListener('click', () =>
            switchTab('tab-ai'),
        );
    }
    if (vocabProviderStatus) {
        vocabProviderStatus.addEventListener('click', () => switchTab('tab-ai'));
    }

    try {
        const savedTab = sessionStorage.getItem('ncw_active_tab');
        if (savedTab) {
            switchTab(savedTab);
        }
    } catch {
        // Ignore session storage errors
    }

    function updateVocabStatusHeader(): void {
        const l = currentSettings.uiLanguage || 'en';
        if (!vocabStatusDetail) return;
        if (!currentSettings.vocabExtractorEnabled) {
            vocabStatusDetail.textContent = NCW_I18N.getText(
                'vocabStatusIdle',
                l,
            );
            vocabStatusDetail.style.color = '#888';
            return;
        }
        vocabStatusDetail.textContent = NCW_I18N.getText(
            'vocabStatusProcessing',
            l,
        );
        vocabStatusDetail.style.color = '#46d369';
    }

    async function refreshVocabData(): Promise<void> {
        const mid = currentActiveEpisodeId;
        if (!mid) {
            renderVocabData(null);
            return;
        }
        const data = await messageService.getVocabData(mid);
        renderVocabData(data);
    }

    function renderVocabData(data: EpisodeVocabData | null): void {
        currentVocabData = data;
        const l = currentSettings.uiLanguage || 'en';
        const words = data && Array.isArray(data.words) ? data.words : [];
        const count = words.length;

        // Episode title
        if (vocabEpisodeTitle) {
            if (data && data.showTitle) {
                vocabEpisodeTitle.textContent = data.showTitle;
            } else if (currentActiveEpisodeTitle) {
                vocabEpisodeTitle.textContent = currentActiveEpisodeTitle;
            } else if (currentActiveEpisodeId) {
                vocabEpisodeTitle.textContent = `Episode: ${currentActiveEpisodeId}`;
            } else {
                vocabEpisodeTitle.textContent = NCW_I18N.getText(
                    'waitingPlayback',
                    l,
                );
            }
        }

        // Source / Target Language Badge
        if (vocabLangBadge) {
            const srcLang =
                data && data.sourceLanguage
                    ? data.sourceLanguage
                    : currentSettings.vocabSourceLanguage !== 'auto'
                      ? typeof currentSettings.vocabSourceLanguage === 'object'
                          ? currentSettings.vocabSourceLanguage.code
                          : currentSettings.vocabSourceLanguage
                      : '';
            const tgtLang =
                data && data.targetLanguage
                    ? data.targetLanguage
                    : currentSettings.targetLanguage
                      ? typeof currentSettings.targetLanguage === 'object'
                          ? currentSettings.targetLanguage.code
                          : currentSettings.targetLanguage
                      : '';
            if (srcLang) {
                vocabLangBadge.textContent = tgtLang
                    ? `${srcLang} ➔ ${tgtLang}`
                    : srcLang;
                vocabLangBadge.style.display = 'inline-block';
            } else {
                vocabLangBadge.style.display = 'none';
            }
        }

        // Word count badge & preview counter
        if (vocabCountBadge) {
            vocabCountBadge.textContent = NCW_I18N.getText('vocabCount', l, {
                count,
            });
        }
        if (vocabPreviewCount) {
            vocabPreviewCount.textContent = `(${count} items)`;
        }

        // Download CSV button state
        if (btnDownloadVocabCsv) {
            btnDownloadVocabCsv.disabled = count === 0;
        }

        // Preview box
        if (!vocabPreviewBox) return;

        if (count === 0) {
            vocabPreviewBox.innerHTML = `
        <div class="empty-hint" id="vocab-empty-hint">
          ${escapeHtml(NCW_I18N.getText('vocabEmpty', l))}
        </div>
      `;
            return;
        }

        const itemsHtml = words
            .map((w) => {
                const wordStr = escapeHtml(w.word || '');
                const posStr = w.pos
                    ? `<span class="vocab-item-pos">${escapeHtml(w.pos)}</span>`
                    : '';
                const phoStr = w.phonetic
                    ? `<span class="vocab-item-phonetic">${escapeHtml(w.phonetic)}</span>`
                    : '';
                const freqStr =
                    w.frequency && w.frequency > 1
                        ? `<span class="vocab-item-freq">×${w.frequency}</span>`
                        : '';
                const meaningStr = w.meaning
                    ? `<div class="vocab-item-meaning">${escapeHtml(w.meaning)}</div>`
                    : '';

                let sentenceHtml = '';
                if (w.sentence) {
                    const transSub = w.sentenceTranslation
                        ? `<div style="color: #777; font-size: 10.5px; margin-top: 2px;">${escapeHtml(w.sentenceTranslation)}</div>`
                        : '';
                    sentenceHtml = `<div class="vocab-item-sentence">"${escapeHtml(w.sentence)}"${transSub}</div>`;
                }

                return `
        <div class="vocab-item-card">
          <div class="vocab-item-header">
            <span class="vocab-item-word">${wordStr}</span>
            ${posStr}
            ${phoStr}
            ${freqStr}
          </div>
          ${meaningStr}
          ${sentenceHtml}
        </div>
      `;
            })
            .join('');

        vocabPreviewBox.innerHTML = itemsHtml;
    }

    function escapeCsvCell(cell: unknown): string {
        if (cell === null || cell === undefined) return '""';
        const str = String(cell);
        if (/[",\r\n]/.test(str)) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return `"${str}"`;
    }

    function formatTimestamp(seconds?: number): string {
        if (typeof seconds !== 'number' || isNaN(seconds)) return '';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function exportVocabCsv(): void {
        if (
            !currentVocabData ||
            !Array.isArray(currentVocabData.words) ||
            currentVocabData.words.length === 0
        ) {
            return;
        }

        const srcLang =
            (currentVocabData && currentVocabData.sourceLanguage) ||
            (currentSettings.vocabSourceLanguage !== 'auto'
                ? currentSettings.vocabSourceLanguage
                : 'Source');
        const tgtLang =
            (currentVocabData && currentVocabData.targetLanguage) ||
            currentSettings.targetLanguage ||
            'Target';

        const headers = [
            `Word (${srcLang})`,
            'POS',
            'Phonetic',
            `Contextual Meaning (${tgtLang})`,
            `Original Sentence (${srcLang})`,
            `Sentence Translation (${tgtLang})`,
            'Timestamp',
            'Frequency',
        ];

        const rows = currentVocabData.words.map((w) => [
            escapeCsvCell(w.word || ''),
            escapeCsvCell(w.pos || ''),
            escapeCsvCell(w.phonetic || ''),
            escapeCsvCell(w.meaning || ''),
            escapeCsvCell(w.sentence || ''),
            escapeCsvCell(w.sentenceTranslation || ''),
            escapeCsvCell(formatTimestamp(w.timestamp)),
            escapeCsvCell(w.frequency || 1),
        ]);

        const csvContent =
            '\uFEFF' +
            [
                headers.map((h) => `"${h}"`).join(','),
                ...rows.map((r) => r.join(',')),
            ].join('\r\n');
        const blob = new Blob([csvContent], {
            type: 'text/csv;charset=utf-8;',
        });
        const url = URL.createObjectURL(blob);

        const rawTitle =
            currentVocabData.showTitle ||
            currentActiveEpisodeTitle ||
            'cowatcher_vocab';
        const cleanTitle = rawTitle
            .replace(/[^\w\s\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af-]/g, '')
            .trim()
            .replace(/\s+/g, '_');
        const episodeId =
            currentVocabData.movieId || currentActiveEpisodeId || 'episode';
        const filename = `${cleanTitle}_${episodeId}_vocab.csv`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 500);
    }

    if (btnDownloadVocabCsv) {
        btnDownloadVocabCsv.addEventListener('click', exportVocabCsv);
    }

    if (btnResetVocab) {
        btnResetVocab.addEventListener('click', () => {
            const l = currentSettings.uiLanguage || 'en';
            const targetMid =
                currentActiveEpisodeId ||
                (currentVocabData && currentVocabData.movieId);
            if (!targetMid) return;

            if (confirm(NCW_I18N.getText('vocabResetConfirm', l))) {
                messageService.resetVocabData(targetMid).then(() => {
                    const srcCode =
                        typeof currentSettings.vocabSourceLanguage === 'object'
                            ? currentSettings.vocabSourceLanguage.code
                            : currentSettings.vocabSourceLanguage || 'auto';
                    const tgtCode =
                        typeof currentSettings.targetLanguage === 'object'
                            ? currentSettings.targetLanguage.code
                            : currentSettings.targetLanguage || 'en';
                    renderVocabData({
                        movieId: targetMid,
                        showTitle: currentActiveEpisodeTitle || '',
                        sourceLanguage: srcCode,
                        targetLanguage: tgtCode,
                        difficulty:
                            currentSettings.vocabExtractorDifficulty ||
                            'medium',
                        customPrompt:
                            currentSettings.vocabExtractorCustomPrompt || '',
                        model: currentSettings.vocabExtractorModel || '',
                        updatedAt: Date.now(),
                        words: [],
                    });
                });
            }
        });
    }

    if (vocabEnabledToggle) {
        vocabEnabledToggle.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            saveSettings({ vocabExtractorEnabled: target.checked });
            updateVocabStatusHeader();
        });
    }

    if (vocabProviderSelect) {
        vocabProviderSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            const provider = target.value as 'openrouter' | 'ollama';
            saveSettings({ vocabExtractorProvider: provider });
            updateVocabProviderVisibility(provider);
            updateProviderStatusBadges();
        });
    }

    if (vocabOpenrouterModelSelect) {
        vocabOpenrouterModelSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            const val = target.value;
            if (val === '__custom__') {
                if (vocabCustomOpenrouterModelInput) {
                    vocabCustomOpenrouterModelInput.style.display = 'block';
                    vocabCustomOpenrouterModelInput.focus();
                }
            } else {
                if (vocabCustomOpenrouterModelInput) {
                    vocabCustomOpenrouterModelInput.style.display = 'none';
                }
                saveSettings({ vocabExtractorModel: val });
            }
        });
    }

    if (vocabCustomOpenrouterModelInput) {
        vocabCustomOpenrouterModelInput.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            const val = target.value.trim();
            if (val) {
                saveSettings({ vocabExtractorModel: val });
            }
        });
    }

    if (vocabOllamaModelSelect) {
        vocabOllamaModelSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            saveSettings({ vocabExtractorOllamaModel: target.value });
        });
    }

    if (vocabDifficultySelect) {
        vocabDifficultySelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            saveSettings({
                vocabExtractorDifficulty: target.value as
                    'easy' | 'medium' | 'hard',
            });
        });
    }

    if (vocabSourceLangSelect) {
        vocabSourceLangSelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            const val = target.value;
            saveSettings({
                vocabSourceLanguage:
                    val === 'auto' ? 'auto' : Language.resolve(val),
            });
        });
    }

    if (vocabCustomPromptInput) {
        let promptDebounceTimer: ReturnType<typeof setTimeout> | null = null;
        vocabCustomPromptInput.addEventListener('input', (e) => {
            if (promptDebounceTimer) clearTimeout(promptDebounceTimer);
            const target = e.target as HTMLTextAreaElement;
            promptDebounceTimer = setTimeout(() => {
                saveSettings({ vocabExtractorCustomPrompt: target.value });
            }, 300);
        });
    }

    // Donation buttons (Ko-fi)
    const KOFI_URL = 'https://ko-fi.com/sfbb49898';
    function handleDonateClick(e?: Event): void {
        if (e) e.preventDefault();
        platform.createTab(KOFI_URL);
    }

    const btnDonate = document.getElementById('btn-donate');
    const headerDonateLink = document.getElementById('header-donate-link');
    if (btnDonate) {
        btnDonate.addEventListener('click', handleDonateClick);
    }
    if (headerDonateLink) {
        headerDonateLink.addEventListener('click', handleDonateClick);
    }

    // Open Full Options & Cache Dashboard
    const btnOpenOptions = document.getElementById('btn-open-options');
    if (btnOpenOptions) {
        btnOpenOptions.addEventListener('click', () => {
            platform.openOptionsPage();
        });
    }
});
