/**
 * CoWatcher - Content Script Entry
 * Bridges DOM, streaming adapters, ad detector, subtitle synchronization manager, and message services.
 */

import { NCW_CONSTANTS, ExtensionSettings } from '@shared/utils/constants';
import NCW_I18N from '@shared/utils/i18n';
import { SubtitleOverlay } from './presentation/SubtitleOverlay';
import { SubtitleManager, CueItem } from './application/subtitleManager';
import { createSubtitleCue } from '@shared/domain/entities/Subtitle';
import { NetflixAdDetector as AdDetector } from './infrastructure/adapters/netflix/NetflixAdDetector';
import { StreamingAdapterRegistry } from './domain/adapters/StreamingAdapterRegistry';
import { NetflixContentAdapter } from './infrastructure/adapters/netflix/NetflixContentAdapter';
import { TVerContentAdapter } from './infrastructure/adapters/tver/TVerContentAdapter';
import { YouTubeContentAdapter } from './infrastructure/adapters/youtube/YouTubeContentAdapter';
import { BilibiliContentAdapter } from './infrastructure/adapters/bilibili/BilibiliContentAdapter';
import { ContentMessageService } from './application/services/ContentMessageService';
import { SubtitleParser } from './application/utils/parser';
import { BrowserPlatformFactory } from '@shared/infrastructure/platform/BrowserPlatformFactory';
import { Logger } from '@shared/utils/logger';
import { Language, LanguageInfo } from '@shared/domain/value-objects/Language';
import { AiSubState } from '@shared/domain/entities/AiSubState';
import { startTriStatePoll, PollHandle } from './application/utils/pollHelper';
import { PlaybackDatasetHelper } from '@shared/domain/entities/PlaybackDatasetPayload';

const logger: Logger = new Logger('content');

(function () {
    'use strict';

    logger.info('Content', 'Content script initialized.');

    // Fallback injection for browsers/environments where static manifest world: "MAIN" is not available
    function ensureInjectedScript(): void {
        if (typeof document === 'undefined') return;
        if (
            document.documentElement &&
            document.documentElement.getAttribute('data-ncw-injected') ===
                'true'
        ) {
            return;
        }
        try {
            const scriptUrl = BrowserPlatformFactory.getPlatform().getURL(
                'injected/injected.js',
            );
            if (!scriptUrl) return;

            if (
                document.querySelector(
                    'script[data-ncw-injected-script="true"]',
                )
            )
                return;

            const s = document.createElement('script');
            s.src = scriptUrl;
            s.async = false;
            s.setAttribute('data-ncw-injected-script', 'true');
            (document.head || document.documentElement).appendChild(s);
        } catch (e) {
            logger.warn('Content', 'Fallback script injection error:', e);
        }
    }

    ensureInjectedScript();

    // Register platform content adapters
    StreamingAdapterRegistry.register(new NetflixContentAdapter());
    StreamingAdapterRegistry.register(new TVerContentAdapter());
    StreamingAdapterRegistry.register(new YouTubeContentAdapter());
    StreamingAdapterRegistry.register(new BilibiliContentAdapter());

    const adapter =
        StreamingAdapterRegistry.getMatchingAdapter() ||
        new NetflixContentAdapter();
    const messageService = ContentMessageService.getInstance();
    const platform = BrowserPlatformFactory.getPlatform();

    let settings: ExtensionSettings = { ...NCW_CONSTANTS.DEFAULT_SETTINGS };
    const overlay = new SubtitleOverlay();
    overlay.bindContainerResolver(() => adapter.getPlayerContainer());

    const adDetectorOptions = {
        onAdStart: () => {
            overlay.hide(true);
        },
        onAdEnd: () => {
            if (subtitleManager) {
                setTimeout(() => subtitleManager.onSeeked(), 300);
            }
        },
    };

    const adDetector = adapter.createAdDetector
        ? adapter.createAdDetector(adDetectorOptions)
        : new AdDetector(adDetectorOptions);

    const subtitleManager = new SubtitleManager(
        overlay,
        adDetector,
        settings,
        adapter,
    );

    let currentVideoId: string | null = null;
    let currentUrl = window.location.href;
    let retryCount = 0;
    const pendingSubtitlesByMovieId = new Map<
        string,
        { rawText: string; bcp47: string | null }
    >();
    let currentSubtitleLanguage = 'auto';
    let lastParsedCues: CueItem[] | null = null;

    function isExtensionValid(): boolean {
        return platform.isContextValid();
    }

    async function sendHeartbeat(): Promise<void> {
        if (!isExtensionValid()) return;
        const videoId =
            currentVideoId || adapter.extractVideoId() || null;
        const datasetPayload = videoId
            ? PlaybackDatasetHelper.read(videoId)
            : null;
        const showId =
            subtitleManager?.currentShowId ||
            datasetPayload?.showId ||
            null;

        try {
            await messageService.sendHeartbeat({
                showId,
                videoId,
                targetLanguage: settings.targetLanguage,
            });
        } catch {
            // Ignore heartbeat transmission failure
        }
    }

    async function notifyVocabExtractor(
        cuesToFeed: CueItem[],
        movieIdToFeed?: string | null,
        sourceLangToFeed?: string,
    ): Promise<void> {
        if (!isExtensionValid()) return;
        if (!settings.vocabExtractorEnabled) return;
        if (!cuesToFeed || cuesToFeed.length === 0) return;

        // Invariant: Verify entity consistency
        if (
            movieIdToFeed &&
            currentVideoId &&
            movieIdToFeed !== currentVideoId
        ) {
            logger.warn(
                'Content',
                `notifyVocabExtractor dropped cues: movieId ${movieIdToFeed} !== currentVideoId ${currentVideoId}`,
            );
            return;
        }

        const configuredSrcLang =
            settings.vocabSourceLanguage &&
            settings.vocabSourceLanguage !== 'auto'
                ? settings.vocabSourceLanguage
                : null;
        const rawLang =
            configuredSrcLang ||
            sourceLangToFeed ||
            currentSubtitleLanguage ||
            'auto';
        const effectiveMovieId = movieIdToFeed || currentVideoId || '';

        const effectiveLang: LanguageInfo | 'auto' =
            rawLang === 'auto' ? 'auto' : Language.resolve(rawLang);

        const showTitle = subtitleManager?.videoInfo?.mainTitle || '';

        try {
            await messageService.feedVocabCues({
                movieId: effectiveMovieId,
                cues: cuesToFeed,
                sourceLanguage: effectiveLang,
                trackHash: subtitleManager?.currentTrackHash || '',
                showTitle: showTitle,
            });
        } catch {
            // Ignore vocab extraction transmission failure
        }
    }

    let subtitlePollHandle: PollHandle<{ rawText: string; bcp: string }> | null = null;
    let subtitleAbortController: AbortController | null = null;

    function stopSubtitlePolling(): void {
        if (subtitlePollHandle) {
            subtitlePollHandle.stop();
            subtitlePollHandle = null;
        }
        if (subtitleAbortController) {
            subtitleAbortController.abort();
            subtitleAbortController = null;
        }
    }

    async function activateParsedSubtitle(
        rawText: string,
        bcp: string | null | undefined,
        targetVideoId: string,
        description: string,
    ): Promise<boolean> {
        if (!rawText) return false;
        const rawCues = adapter.parseSubtitle(rawText);
        if (!rawCues || rawCues.length === 0) return false;

        const cues = rawCues.map((c) =>
            createSubtitleCue({
                id: c.id,
                startTime: c.start,
                endTime: c.end,
                rawText: c.text,
                position: c.position,
            }),
        );
        lastParsedCues = cues;
        currentSubtitleLanguage =
            bcp || SubtitleParser.detectLanguage(rawText, rawCues);
        logger.info(
            'Content',
            `⚡ ${description} for ${targetVideoId} (${cues.length} cues, lang: ${currentSubtitleLanguage}).`,
        );
        subtitleManager.loadCues(
            cues,
            targetVideoId,
            false,
            currentSubtitleLanguage,
        );
        await notifyVocabExtractor(
            cues,
            targetVideoId,
            currentSubtitleLanguage,
        );
        return true;
    }

    async function fetchAndActivateSubtitle(
        targetVideoId: string,
        sourceDescription = 'proactively fetched',
    ): Promise<boolean> {
        if (!targetVideoId) return false;
        stopSubtitlePolling();

        const abortController = new AbortController();
        subtitleAbortController = abortController;

        const handle = await startTriStatePoll(
            () => adapter.fetchSubttile(targetVideoId),
            {
                immediate: true,
                intervalMs: 1000,
                maxAttempts: 25,
                timeoutMs: 3 * 60 * 1000,
                backoffFactor: 1.1,
                maxIntervalMs: 3000,
                abortSignal: abortController.signal,
                onSuccess: async (result) => {
                    // Entity consistency check: must still be current video
                    if (!isExtensionValid() || currentVideoId !== targetVideoId) {
                        return;
                    }
                    if (result && result.rawText) {
                        await activateParsedSubtitle(
                            result.rawText,
                            result.bcp,
                            targetVideoId,
                            `Background polled ${sourceDescription} subtitle`,
                        );
                    } else if (result === null) {
                        logger.info(
                            'Content',
                            `Confirmed no subtitle available for ${targetVideoId} during polling (status: null).`,
                        );
                    }
                },
                onAbort: (reason) => {
                    logger.debug(
                        'Content',
                        `Subtitle polling for ${targetVideoId} ended: ${reason}`,
                    );
                },
                onError: (err) => {
                    logger.warn(
                        'Content',
                        `Error polling subtitle for ${targetVideoId}:`,
                        err,
                    );
                },
            },
        );

        subtitlePollHandle = handle;

        // If immediate attempt yielded definitive result (T or null), process right away
        if (handle.initialResult !== undefined) {
            if (!isExtensionValid() || currentVideoId !== targetVideoId) {
                return false;
            }
            if (handle.initialResult && handle.initialResult.rawText) {
                return await activateParsedSubtitle(
                    handle.initialResult.rawText,
                    handle.initialResult.bcp,
                    targetVideoId,
                    `Instantly activated ${sourceDescription} subtitle`,
                );
            } else if (handle.initialResult === null) {
                logger.info(
                    'Content',
                    `Confirmed no subtitle available for ${targetVideoId} (status: null).`,
                );
                return false;
            }
        }

        logger.info(
            'Content',
            `Subtitle for ${targetVideoId} is pending (undefined), background polling started.`,
        );
        return false;
    }

    // Handles video/episode transition and manages context, DOM mount, and subtitle resolution
    async function handleEpisodeChange(info: {
        movieId: string;
        url?: string;
    }): Promise<void> {
        const newVideoId = String(info.movieId || '');
        if (!newVideoId || newVideoId === currentVideoId) {
            return;
        }

        logger.info(
            'Content',
            `🔄 Transitioning to episode: ${currentVideoId || 'initial'} -> ${newVideoId}`,
        );
        currentVideoId = newVideoId;
        currentUrl = info.url || window.location.href;
        retryCount = 0;
        lastParsedCues = null;
        stopSubtitlePolling();

        // Reset subtitle manager, ad detector, and overlay for the new episode
        subtitleManager.onEpisodeChange(currentVideoId);
        adDetector.reset();
        overlay.hide(true);
        await sendHeartbeat();

        // Re-scan and re-mount to fresh player DOM
        await scanAndAttachVideo();
        overlay.mountToPlayer(adapter.getPlayerContainer());
        applyNativeSubtitleVisibility();

        // 1. Check if we have a staged preloaded subtitle by movie ID
        if (pendingSubtitlesByMovieId.has(currentVideoId)) {
            const item = pendingSubtitlesByMovieId.get(currentVideoId);
            pendingSubtitlesByMovieId.delete(currentVideoId);
            try {
                if (item?.rawText) {
                    const activated = await activateParsedSubtitle(
                        item.rawText,
                        item.bcp47,
                        currentVideoId,
                        'Instantly activated staged preloaded subtitle',
                    );
                    if (activated) return;
                }
            } catch (e) {
                logger.warn(
                    'Content',
                    'Failed parsing staged subtitle by movieId:',
                    e,
                );
            }
        }

        // 2. Proactively fetch subtitle from adapter
        const activated = await fetchAndActivateSubtitle(
            currentVideoId,
            'proactively fetched',
        );
        if (activated) return;

        logger.info(
            'Content',
            `No staged preloaded subtitle found for ${currentVideoId}.`,
        );
    }

    async function handleUrlChange(newUrl: string): Promise<void> {
        if (!newUrl || newUrl === currentUrl) return;
        currentUrl = newUrl;
        logger.info('Content', `Page route changed: ${newUrl}`);

        const newVid = adapter.extractVideoId(newUrl) || null;
        if (!newVid) {
            currentVideoId = null;
            retryCount = 0;
            lastParsedCues = null;
            stopSubtitlePolling();
            subtitleManager.onEpisodeChange(null);
            overlay.hide(true);
            await sendHeartbeat();
        } else if (newVid && newVid !== currentVideoId) {
            await handleEpisodeChange({ movieId: newVid, url: newUrl });
        }

        // Re-check player DOM and controls for the new page route
        scheduleScanAndAttachVideo();
        injectPlayerControlButton();
    }

    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    function showToast(message: string): void {
        let toast = document.getElementById('ncw-toast');
        const playerTarget = adapter.getPlayerContainer() || document.body;

        if (!playerTarget) return;

        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'ncw-toast';
            toast.className = 'ncw-toast';
            playerTarget.appendChild(toast);
        } else if (toast.parentElement !== playerTarget) {
            playerTarget.appendChild(toast);
        }

        toast.textContent = message;
        toast.classList.add('ncw-toast-show');
        if (toastTimer) {
            clearTimeout(toastTimer);
        }
        toastTimer = setTimeout(() => {
            toast?.classList.remove('ncw-toast-show');
        }, 1800);
    }

    async function toggleEnabledState(showNotification = true): Promise<void> {
        if (!isExtensionValid()) {
            showToast(
                NCW_I18N.getText('extensionUpdatedReload', settings.uiLanguage),
            );
            return;
        }

        const nextState = !settings.enabled;
        settings.enabled = nextState;
        if (adapter && adapter.platformName) {
            if (!settings.platformEnabled) settings.platformEnabled = {};
            settings.platformEnabled[adapter.platformName] = nextState;
        }
        logger.info(
            'Content',
            `Subtitle translation toggled for ${adapter.platformName}: ${nextState ? 'ON' : 'OFF'}`,
        );

        // Update authoritative state in Background via ContentMessageService
        try {
            await messageService.setAiSubEnabled(
                nextState,
                adapter.platformName,
            );
        } catch (err) {
            logger.warn(
                'Content',
                'Failed to set AI Sub state in background:',
                err,
            );
        }

        // Persist via background message service
        try {
            if (isExtensionValid()) {
                const updatedPlatformEnabled = {
                    ...(settings.platformEnabled || {}),
                    [adapter.platformName]: nextState,
                };
                await messageService.saveSettings({
                    enabled: nextState,
                    platformEnabled: updatedPlatformEnabled,
                });
            }
        } catch (e) {
            logger.warn('Content', 'Settings persistence failed:', e);
        }

        if (nextState) {
            await scanAndAttachVideo();
            overlay.mountToPlayer(adapter.getPlayerContainer());
            if (
                currentVideoId &&
                (!subtitleManager.cues || subtitleManager.cues.length === 0)
            ) {
                await fetchAndActivateSubtitle(
                    currentVideoId,
                    'subtitle upon enabling translation',
                );
            }
        }

        subtitleManager.updateSettings({ enabled: nextState });
        updatePlayerControlButtonState();
        applyNativeSubtitleVisibility();

        if (showNotification) {
            const msg = nextState
                ? NCW_I18N.getText('toastEnabled', settings.uiLanguage)
                : NCW_I18N.getText('toastDisabled', settings.uiLanguage);
            showToast(msg);
        }
    }

    function applyNativeSubtitleVisibility(): void {
        const shouldHide =
            settings.enabled !== false &&
            settings.hideNativeSubtitles !== false;
        if (shouldHide) {
            document.body.classList.add('ncw-hide-native-subs');
        } else {
            document.body.classList.remove('ncw-hide-native-subs');
        }
    }

    let isBtnHovered = false;
    let btnFadeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastUserActivityTime = 0;
    const BTN_FADE_TIMEOUT_MS = 2500;

    function showPlayerControlButton(): void {
        const btn = document.getElementById('ncw-player-toggle-btn');
        if (!btn) return;

        if (btn.classList.contains('ncw-faded')) {
            btn.classList.remove('ncw-faded');
        }

        scheduleButtonFade();
    }

    function scheduleButtonFade(): void {
        if (btnFadeTimer) {
            clearTimeout(btnFadeTimer);
            btnFadeTimer = null;
        }

        if (isBtnHovered) return;
        if (!adapter.isPlaybackPage()) return;

        btnFadeTimer = setTimeout(() => {
            btnFadeTimer = null;
            if (isBtnHovered) return;
            const btn = document.getElementById('ncw-player-toggle-btn');
            if (btn && !btn.classList.contains('ncw-faded')) {
                btn.classList.add('ncw-faded');
            }
        }, BTN_FADE_TIMEOUT_MS);
    }

    function onPlayerUserActivity(): void {
        if (!adapter.isPlaybackPage()) return;
        const now = Date.now();
        if (now - lastUserActivityTime < 100) return;
        lastUserActivityTime = now;
        showPlayerControlButton();
    }

    window.addEventListener('mousemove', onPlayerUserActivity, {
        capture: true,
        passive: true,
    });
    window.addEventListener('pointermove', onPlayerUserActivity, {
        capture: true,
        passive: true,
    });
    window.addEventListener('keydown', onPlayerUserActivity, {
        capture: true,
        passive: true,
    });
    window.addEventListener('touchstart', onPlayerUserActivity, {
        capture: true,
        passive: true,
    });
    document.addEventListener(
        'mouseleave',
        () => {
            isBtnHovered = false;
            scheduleButtonFade();
        },
        { capture: true, passive: true },
    );

    function injectPlayerControlButton(): void {
        if (!adapter.isPlaybackPage()) {
            const existing = document.getElementById('ncw-player-toggle-btn');
            if (existing) existing.remove();
            if (btnFadeTimer) {
                clearTimeout(btnFadeTimer);
                btnFadeTimer = null;
            }
            return;
        }

        const playerTarget = adapter.getPlayerContainer();
        if (!playerTarget || playerTarget === document.body) return;

        let btn = document.getElementById('ncw-player-toggle-btn');
        if (!btn) {
            btn = document.createElement('div');
            btn.id = 'ncw-player-toggle-btn';
            btn.className = 'ncw-player-toggle-btn';
            btn.setAttribute('role', 'button');
            btn.setAttribute('tabindex', '0');
            btn.setAttribute(
                'title',
                NCW_I18N.getText('btnPlayerTitle', settings.uiLanguage),
            );

            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                await toggleEnabledState();
                showPlayerControlButton();
            });

            btn.addEventListener('mouseenter', () => {
                isBtnHovered = true;
                if (btnFadeTimer) {
                    clearTimeout(btnFadeTimer);
                    btnFadeTimer = null;
                }
                btn?.classList.remove('ncw-faded');
            });

            btn.addEventListener('mouseleave', () => {
                isBtnHovered = false;
                scheduleButtonFade();
            });

            playerTarget.appendChild(btn);
            updatePlayerControlButtonState();
            scheduleButtonFade();
        } else if (btn.parentElement !== playerTarget) {
            playerTarget.appendChild(btn);
        }
    }

    function updatePlayerControlButtonState(): void {
        const btn = document.getElementById('ncw-player-toggle-btn');
        if (!btn) return;

        const isEnabled = settings.enabled !== false;
        const currentState = btn.getAttribute('data-enabled');
        const currentLang = btn.getAttribute('data-lang');
        const newState = isEnabled ? 'true' : 'false';

        btn.setAttribute(
            'title',
            NCW_I18N.getText('btnPlayerTitle', settings.uiLanguage),
        );

        if (currentState === newState && currentLang === settings.uiLanguage)
            return;
        btn.setAttribute('data-enabled', newState);
        btn.setAttribute('data-lang', settings.uiLanguage || 'en');

        const onText = NCW_I18N.getText('btnPlayerOn', settings.uiLanguage);
        const offText = NCW_I18N.getText('btnPlayerOff', settings.uiLanguage);

        if (isEnabled) {
            btn.innerHTML = `<span class="ncw-badge-icon">AI</span><span class="ncw-btn-text">${onText}</span>`;
            btn.classList.add('ncw-active');
            btn.classList.remove('ncw-inactive');
        } else {
            btn.innerHTML = `<span class="ncw-badge-icon">AI</span><span class="ncw-btn-text">${offText}</span>`;
            btn.classList.add('ncw-inactive');
            btn.classList.remove('ncw-active');
        }

        showPlayerControlButton();
    }

    // Keyboard shortcuts
    window.addEventListener('keydown', async (e) => {
        const activeEl = document.activeElement;
        if (
            activeEl &&
            (activeEl.tagName === 'INPUT' ||
                activeEl.tagName === 'TEXTAREA' ||
                (activeEl as HTMLElement).isContentEditable)
        ) {
            return;
        }

        if (e.altKey && (e.key === 't' || e.key === 'T')) {
            e.preventDefault();
            await toggleEnabledState();
        } else if (
            (e.key === '[' || (e.altKey && e.code === 'BracketLeft')) &&
            !e.ctrlKey &&
            !e.metaKey
        ) {
            e.preventDefault();
            await adjustSubtitleOffset(0.5);
        } else if (
            (e.key === ']' || (e.altKey && e.code === 'BracketRight')) &&
            !e.ctrlKey &&
            !e.metaKey
        ) {
            e.preventDefault();
            await adjustSubtitleOffset(-0.5);
        } else if (
            (e.key === '\\' || (e.altKey && e.code === 'Backslash')) &&
            !e.ctrlKey &&
            !e.metaKey
        ) {
            e.preventDefault();
            await resetSubtitleOffset();
        }
    });

    async function adjustSubtitleOffset(delta: number): Promise<void> {
        if (!isExtensionValid()) {
            showToast(
                NCW_I18N.getText('extensionUpdatedReload', settings.uiLanguage),
            );
            return;
        }
        const current =
            typeof settings.subSyncOffset === 'number'
                ? settings.subSyncOffset
                : 0;
        const updated = Math.round((current + delta) * 10) / 10;
        settings.subSyncOffset = updated;
        subtitleManager.updateSettings({ subSyncOffset: updated });
        try {
            if (isExtensionValid()) {
                await messageService.saveSettings({ subSyncOffset: updated });
            }
        } catch (e) {
            logger.warn('Content', 'Settings sync failed:', e);
        }

        const sign = updated > 0 ? '+' : '';
        const msg = NCW_I18N.getText('toastSyncOffset', settings.uiLanguage, {
            offset: `${sign}${updated.toFixed(1)}`,
        });
        showToast(msg);
    }

    async function resetSubtitleOffset(): Promise<void> {
        if (!isExtensionValid()) {
            showToast(
                NCW_I18N.getText('extensionUpdatedReload', settings.uiLanguage),
            );
            return;
        }
        settings.subSyncOffset = 0;
        subtitleManager.updateSettings({ subSyncOffset: 0 });
        try {
            if (isExtensionValid()) {
                await messageService.saveSettings({ subSyncOffset: 0 });
            }
        } catch (e) {
            logger.warn('Content', 'Settings reset failed:', e);
        }

        const msg = NCW_I18N.getText('toastSyncOffset', settings.uiLanguage, {
            offset: '0.0',
        });
        showToast(msg);
    }

    // 1. Initial State Sync: Fetch authoritative state from Background service
    async function initAiSubState(): Promise<void> {
        try {
            const state: AiSubState | null =
                await messageService.fetchAiSubState();
            if (state) {
                const isPlatformOn =
                    typeof state.isPlatformEnabled === 'function'
                        ? state.isPlatformEnabled(adapter.platformName)
                        : ((
                              state.platformEnabled as
                                  Record<string, boolean> | undefined
                          )?.[adapter.platformName] ??
                          state.enabled ??
                          true);
                settings.enabled = isPlatformOn;
                subtitleManager.updateSettings({ enabled: isPlatformOn });
                updatePlayerControlButtonState();
                applyNativeSubtitleVisibility();
            }
        } catch (err) {
            logger.warn('Content', 'Could not fetch initial AiSubState:', err);
        }
    }
    initAiSubState();

    // 2. Push Listener: Listen to AI Sub state push events from Background service
    messageService.onAiSubStateChanged((state) => {
        if (state) {
            const isPlatformOn =
                typeof state.isPlatformEnabled === 'function'
                    ? state.isPlatformEnabled(adapter.platformName)
                    : ((
                          state.platformEnabled as
                              Record<string, boolean> | undefined
                      )?.[adapter.platformName] ??
                      state.enabled ??
                      true);
            if (settings.enabled !== isPlatformOn) {
                logger.info(
                    'Content',
                    `Received AiSubState push for ${adapter.platformName}: enabled=${isPlatformOn}`,
                );
                settings.enabled = isPlatformOn;
                subtitleManager.updateSettings({ enabled: isPlatformOn });
                updatePlayerControlButtonState();
                applyNativeSubtitleVisibility();
            }
        }
    });

    // 3. Load initial settings from background service
    async function loadInitialSettings(): Promise<void> {
        if (isExtensionValid()) {
            try {
                const remoteSettings = await messageService.fetchSettings();
                if (!isExtensionValid()) return;
                if (remoteSettings) {
                    settings = {
                        ...settings,
                        ...remoteSettings,
                    };
                    if (
                        settings.platformEnabled &&
                        typeof settings.platformEnabled[
                            adapter.platformName
                        ] === 'boolean'
                    ) {
                        settings.enabled =
                            settings.platformEnabled[adapter.platformName]!;
                    }
                    overlay.init(settings);
                    subtitleManager.updateSettings(settings);
                } else {
                    overlay.init(settings);
                }
                updatePlayerControlButtonState();
                applyNativeSubtitleVisibility();
            } catch {
                overlay.init(settings);
                updatePlayerControlButtonState();
            }
        } else {
            overlay.init(settings);
            updatePlayerControlButtonState();
        }
    }
    loadInitialSettings();

    // 4. Listen to settings changes from popup/options via ContentMessageService
    if (isExtensionValid()) {
        messageService.onSettingsChanged(async (newSettings) => {
            if (!isExtensionValid() || !newSettings) return;
            const oldVocabEnabled = settings.vocabExtractorEnabled;
            settings = { ...settings, ...newSettings };
            if (
                settings.platformEnabled &&
                typeof settings.platformEnabled[adapter.platformName] ===
                    'boolean'
            ) {
                settings.enabled =
                    settings.platformEnabled[adapter.platformName]!;
            }
            subtitleManager.updateSettings(settings);
            updatePlayerControlButtonState();
            applyNativeSubtitleVisibility();

            if (
                !oldVocabEnabled &&
                settings.vocabExtractorEnabled &&
                lastParsedCues
            ) {
                await notifyVocabExtractor(
                    lastParsedCues,
                    currentVideoId,
                    currentSubtitleLanguage,
                );
            }
            await sendHeartbeat();
        });
    }

    // 5. Connect streaming adapter hooks
    adapter.onEpisodeChange(async (newEpisodeId) => {
        await handleEpisodeChange({ movieId: newEpisodeId });
    });

    adapter.onSubtitleData(async (data) => {
        // Invariant: Verify entity consistency
        if (data.movieId && currentVideoId && data.movieId !== currentVideoId) {
            logger.warn(
                'Content',
                `Dropped stale onSubtitleData for ${data.movieId} because currentVideoId is ${currentVideoId}.`,
            );
            return;
        }

        const cues: CueItem[] = data.cues.map((c) =>
            createSubtitleCue({
                id: c.id,
                startTime: c.start,
                endTime: c.end,
                rawText: c.text,
                position: c.position,
            }),
        );
        if (cues.length > 0) {
            lastParsedCues = cues;
            currentSubtitleLanguage = data.language;
            const effectiveMid = data.movieId || currentVideoId || '';
            if (data.movieId && !currentVideoId) {
                currentVideoId = data.movieId;
            }
            subtitleManager.loadCues(
                cues,
                effectiveMid,
                Boolean(data.isAsr),
                currentSubtitleLanguage,
            );
            await notifyVocabExtractor(
                cues,
                effectiveMid,
                currentSubtitleLanguage,
            );
        }
    });

    if (typeof adapter.onSubtitleOff === 'function') {
        adapter.onSubtitleOff((offMovieId?: string) => {
            if (offMovieId && currentVideoId && offMovieId !== currentVideoId) {
                logger.warn(
                    'Content',
                    `Ignored SUBTITLE_OFF for ${offMovieId} because currentVideoId is ${currentVideoId}.`,
                );
                return;
            }
            logger.info(
                'Content',
                `Subtitle OFF event received for ${offMovieId || currentVideoId || 'current video'}.`,
            );
            lastParsedCues = null;
            subtitleManager.clearCues();
        });
    }

    // 6. Connect adapter platform-specific hooks
    if (typeof adapter.onMetadataLoaded === 'function') {
        adapter.onMetadataLoaded(async (meta) => {
            if (!isExtensionValid()) return;
            if (meta.videoId && currentVideoId && meta.videoId !== currentVideoId) {
                logger.warn(
                    'Content',
                    `Dropped stale onMetadataLoaded for ${meta.videoId} because currentVideoId is ${currentVideoId}.`,
                );
                return;
            }
            logger.info(
                'Content',
                `Metadata loaded event received for: ${meta.mainTitle} (showId=${meta.showId || 'N/A'}, ep=${meta.episodeTitle})`,
            );
            if (meta.videoId && !currentVideoId) {
                currentVideoId = meta.videoId;
            }
            if (subtitleManager) {
                subtitleManager.onMetadataLoaded(meta);
            }
            await sendHeartbeat();
        });
    }

    adapter.onUrlChange(async (url) => {
        if (!isExtensionValid()) return;
        await handleUrlChange(url);
    });

    adapter.onTimeSync(({ movieId, cadmiumOffset, adOffset }) => {
        if (!isExtensionValid()) return;
        if (movieId && currentVideoId && movieId !== currentVideoId) {
            return;
        }
        if (typeof cadmiumOffset === 'number') {
            subtitleManager.setCadmiumOffset(cadmiumOffset);
        } else if (typeof adOffset === 'number') {
            subtitleManager.setCadmiumOffset(-adOffset);
        }
    });

    adapter.onSubtitlePreload(({ movieId, rawText, bcp47 }) => {
        if (!isExtensionValid()) return;
        if (movieId) {
            pendingSubtitlesByMovieId.set(String(movieId), {
                rawText,
                bcp47: bcp47 || null,
            });
            logger.info(
                'Content',
                `📦 Staged preloaded subtitle in content script for episode ${movieId}`,
            );
        }
    });

    // 7. Start ad detector
    adDetector.startMonitoring();

    // 8. Watch for video element appearance / changes
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function scanAndAttachVideo(): Promise<void> {
        if (!isExtensionValid()) {
            if (bodyObserver) bodyObserver.disconnect();
            if (intervalId) clearInterval(intervalId);
            adDetector.stopMonitoring();
            return;
        }

        if (window.location.href !== currentUrl) {
            await handleUrlChange(window.location.href);
        }

        const video = adapter.getVideoElement();
        if (video) {
            subtitleManager.attachVideo(video);
            overlay.mountToPlayer(adapter.getPlayerContainer());
            injectPlayerControlButton();

            if (
                currentVideoId &&
                subtitleManager.cues.length === 0 &&
                !subtitlePollHandle &&
                !video.paused &&
                video.currentTime > 1
            ) {
                retryCount++;
                if (retryCount <= 10 && retryCount % 2 === 0) {
                    logger.info(
                        'Content',
                        'Subtitle cues not yet caught during playback. Triggering adapter fetch retry...',
                    );
                    fetchAndActivateSubtitle(currentVideoId).catch(() => {});
                }
            }
        }
    }

    let scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleScanAndAttachVideo(): void {
        if (scanDebounceTimer) return;
        scanDebounceTimer = setTimeout(async () => {
            scanDebounceTimer = null;
            await scanAndAttachVideo();
        }, 250);
    }

    scanAndAttachVideo();

    // Bootstrap initial playback episode if starting directly on a video page
    const initialVid = adapter.extractVideoId();
    if (initialVid) {
        logger.info(
            'Content',
            `Bootstrapping initial episode from page route: ${initialVid}`,
        );
        handleEpisodeChange({ movieId: initialVid }).catch(() => {});
    }

    const bodyObserver = new MutationObserver((mutations) => {
        const isInternalMutation = mutations.every((m) => {
            const t = m.target as HTMLElement | null;
            return (
                t &&
                (t.id === 'ncw-subtitle-container' ||
                    t.id === 'ncw-player-toggle-btn' ||
                    t.id === 'ncw-toast' ||
                    t.closest?.('#ncw-subtitle-container') ||
                    t.closest?.('#ncw-player-toggle-btn') ||
                    t.closest?.('#ncw-toast'))
            );
        });

        if (!isInternalMutation) {
            scheduleScanAndAttachVideo();
        }
    });

    bodyObserver.observe(document.body, {
        childList: true,
        subtree: true,
    });

    // Periodic heartbeat (every 20s) to keep SW alive and sync active showId
    setInterval(sendHeartbeat, 20000);
    sendHeartbeat();

    intervalId = setInterval(scanAndAttachVideo, 1500);
})();
