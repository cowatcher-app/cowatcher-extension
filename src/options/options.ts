/**
 * CoWatcher - Options & Dashboard Controller
 */

import { NCW_CONSTANTS, ExtensionSettings } from '@shared/utils/constants';
import { TrackCacheRepositoryFactory } from '../background/infrastructure/cache/TrackCacheRepositoryFactory';
import { OptionsMessageService } from './application/OptionsMessageService';
import {
    TrackCacheRecord,
    EpisodeVocabData,
    WatchSession,
    ShowWatchSummary,
    WatchHistoryStats,
    DailyWatchStat,
} from '@shared/types/Messages';
import { ContextDTO } from '@shared/domain/entities/Context';
import { VocabWordItem } from '@shared/domain/entities/Vocabulary';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { BrowserPlatformFactory } from '@shared/infrastructure/platform/BrowserPlatformFactory';
import { NCW_STORAGE_KEYS } from '@shared/domain/constants/StorageKeys';
import { Language } from '@shared/domain/value-objects/Language';
import { Logger } from '@shared/utils/logger';
import { TranslationProvider } from '@shared/domain/entities/PipelineTypes';
import { AnkiService } from './anki/ankiService';
import { AnkiExportModal } from './anki/AnkiExportModal';
import { VocabExportItem } from './anki/ankiTypes';
import { VocabCurationService } from './application/VocabCurationService';
import {
    VocabCurationSession,
    CuratedVocabWord,
} from './application/VocabCurationSession';
import { VocabPreviewEditorModal } from './presentation/VocabPreviewEditorModal';
import { TtsAudioService } from '@shared/infrastructure/audio/TtsAudioService';
import { parseVocabCsv } from '@shared/utils/csvParser';
import { NCW_I18N } from '@shared/utils/i18n';
import {
    FrictionScreenType,
    FrictionUnlockDifficulty,
} from '@shared/domain/entities/ViewingFriction';
import { StreamingPlatformId } from '@shared/domain/constants/StreamingPlatforms';
import contributorsMarkdown from '../../CONTRIBUTORS.md';
import creditsMarkdown from '../../CREDITS.md';

const logger = new Logger('options');

interface CachedContextItem extends ContextDTO {
    storageKey: string;
}

document.addEventListener('DOMContentLoaded', async () => {
    const messageService = OptionsMessageService.getInstance();
    const storage = BrowserStorageFactory.getStorage();
    const cacheRepository = TrackCacheRepositoryFactory.getRepository();

    let cachedTracks: TrackCacheRecord[] = [];
    let cachedVocabList: EpisodeVocabData[] = [];
    let cachedContextList: CachedContextItem[] = [];
    let currentSettings: ExtensionSettings = {
        ...NCW_CONSTANTS.DEFAULT_SETTINGS,
    };

    // Accordion and batch selection state
    const expandedCacheGroups = new Set<string>();
    const expandedVocabGroups = new Set<string>();
    const selectedVocabEpisodeIds = new Set<string>();

    // DOM Elements - Navigation
    const navTabs =
        document.querySelectorAll<HTMLButtonElement>('.nav-tab-btn');
    const tabPanes = document.querySelectorAll<HTMLElement>('.tab-pane');
    const navCacheCount = document.getElementById('nav-cache-count');
    const navVocabCount = document.getElementById('nav-vocab-count');
    const navContextCount = document.getElementById('nav-context-count');
    const uiLanguageSelect = document.getElementById(
        'options-ui-language',
    ) as HTMLSelectElement | null;
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
    }


    // DOM Elements - Subtitle Cache Pane
    const btnRefreshCache = document.getElementById('btn-refresh-cache');
    const btnClearAllCache = document.getElementById('btn-clear-all-cache');
    const btnCleanExpiredCache = document.getElementById(
        'btn-clean-expired-cache',
    );
    const cacheRetentionSelect = document.getElementById(
        'cache-retention-select',
    ) as HTMLSelectElement | null;
    const cacheSearchInput = document.getElementById(
        'cache-search',
    ) as HTMLInputElement | null;
    const cacheTableBody = document.getElementById('cache-table-body');
    const statCacheTracks = document.getElementById('stat-cache-tracks');
    const statCacheCues = document.getElementById('stat-cache-cues');
    const statCacheReviewedRaw = document.getElementById(
        'stat-cache-reviewed-raw',
    );
    const cacheListCount = document.getElementById('cache-list-count');

    // DOM Elements - Vocabulary Pane
    const btnRefreshVocab = document.getElementById('btn-refresh-vocab');
    const btnClearAllVocab = document.getElementById('btn-clear-all-vocab');
    const vocabSearchInput = document.getElementById(
        'vocab-search',
    ) as HTMLInputElement | null;
    const vocabCardsGrid = document.getElementById('vocab-cards-grid');
    const vocabSelectAllCheckbox = document.getElementById(
        'vocab-select-all',
    ) as HTMLInputElement | null;
    const btnExportSelectedVocab = document.getElementById(
        'btn-export-selected-vocab',
    ) as HTMLButtonElement | null;
    const btnExportAnki = document.getElementById(
        'btn-export-anki',
    ) as HTMLButtonElement | null;
    const vocabSourceFilter = document.getElementById(
        'vocab-source-filter',
    ) as HTMLSelectElement | null;
    const btnExportUserVocab = document.getElementById('btn-export-user-vocab');
    const statVocabEpisodes = document.getElementById('stat-vocab-episodes');
    const statVocabWords = document.getElementById('stat-vocab-words');
    const vocabListCount = document.getElementById('vocab-list-count');

    // DOM Elements - Show Context Pane
    const btnRefreshContext = document.getElementById('btn-refresh-context');
    const btnClearAllContext = document.getElementById('btn-clear-all-context');
    const contextSearchInput = document.getElementById(
        'context-search',
    ) as HTMLInputElement | null;
    const contextCardsGrid = document.getElementById('context-cards-grid');
    const statContextShows = document.getElementById('stat-context-shows');
    const statContextChars = document.getElementById('stat-context-chars');
    const statContextTerms = document.getElementById('stat-context-terms');
    const contextListCount = document.getElementById('context-list-count');

    // DOM Elements - Watch History Pane
    const btnRefreshHistory = document.getElementById('btn-refresh-history');
    const btnExportHistoryCsv = document.getElementById(
        'btn-export-history-csv',
    );
    const btnClearAllHistory = document.getElementById('btn-clear-all-history');
    const statHistoryTime = document.getElementById('stat-history-time');
    const statHistoryShows = document.getElementById('stat-history-shows');
    const statHistoryEpisodes = document.getElementById(
        'stat-history-episodes',
    );
    const statHistorySessions = document.getElementById(
        'stat-history-sessions',
    );
    const historyHeatmapContainer = document.getElementById(
        'history-heatmap-container',
    );
    const heatmapTooltip = document.getElementById('heatmap-tooltip');
    const historyTrendCanvas = document.getElementById(
        'history-trend-canvas',
    ) as HTMLCanvasElement | null;
    const historySearchInput = document.getElementById(
        'history-search',
    ) as HTMLInputElement | null;
    const historyPlatformFilter = document.getElementById(
        'history-platform-filter',
    ) as HTMLSelectElement | null;
    const historyListCount = document.getElementById('history-list-count');
    const historyCardsGrid = document.getElementById('history-cards-grid');
    const navHistoryCount = document.getElementById('nav-history-count');

    // DOM Elements - Settings Pane
    const btnSaveSettings = document.getElementById('btn-save-settings');
    const cfgAiProvider = document.getElementById(
        'cfg-ai-provider',
    ) as HTMLSelectElement | null;
    const cfgOllamaSection = document.getElementById('cfg-ollama-section');
    const cfgOpenrouterSection = document.getElementById(
        'cfg-openrouter-section',
    );
    const cfgOllamaHost = document.getElementById(
        'cfg-ollama-host',
    ) as HTMLInputElement | null;
    const cfgTranslationModel = document.getElementById(
        'cfg-translation-model',
    ) as HTMLInputElement | null;
    const cfgSupervisorModel = document.getElementById(
        'cfg-supervisor-model',
    ) as HTMLInputElement | null;
    const cfgOpenrouterKey = document.getElementById(
        'cfg-openrouter-key',
    ) as HTMLInputElement | null;
    const cfgBtnClearKey = document.getElementById(
        'cfg-btn-clear-key',
    ) as HTMLButtonElement | null;
    const cfgKeyStatusHint = document.getElementById(
        'cfg-key-status-hint',
    ) as HTMLDivElement | null;
    const cfgEnableMasterPwd = document.getElementById(
        'cfg-enable-master-pwd',
    ) as HTMLInputElement | null;
    const cfgMasterPwdSetupRow = document.getElementById(
        'cfg-master-pwd-setup-row',
    ) as HTMLDivElement | null;
    const cfgMasterPwdInput = document.getElementById(
        'cfg-master-pwd-input',
    ) as HTMLInputElement | null;
    const cfgMasterPwdConfirm = document.getElementById(
        'cfg-master-pwd-confirm',
    ) as HTMLInputElement | null;
    const cfgBtnSaveMasterPwd = document.getElementById(
        'cfg-btn-save-master-pwd',
    ) as HTMLButtonElement | null;
    const cfgMasterPwdMsg = document.getElementById(
        'cfg-master-pwd-msg',
    ) as HTMLDivElement | null;
    const cfgMasterPwdUnlockRow = document.getElementById(
        'cfg-master-pwd-unlock-row',
    ) as HTMLDivElement | null;
    const cfgVaultBadge = document.getElementById(
        'cfg-vault-badge',
    ) as HTMLDivElement | null;
    const cfgVaultUnlockInput = document.getElementById(
        'cfg-vault-unlock-input',
    ) as HTMLInputElement | null;
    const cfgBtnVaultUnlock = document.getElementById(
        'cfg-btn-vault-unlock',
    ) as HTMLButtonElement | null;
    const cfgBtnVaultLock = document.getElementById(
        'cfg-btn-vault-lock',
    ) as HTMLButtonElement | null;
    const cfgOpenrouterTransModel = document.getElementById(
        'cfg-openrouter-trans-model',
    ) as HTMLSelectElement | null;
    const cfgOpenrouterSupModel = document.getElementById(
        'cfg-openrouter-sup-model',
    ) as HTMLSelectElement | null;
    const cfgEnableSupervisor = document.getElementById(
        'cfg-enable-supervisor',
    ) as HTMLInputElement | null;
    const cfgTargetLang = document.getElementById(
        'cfg-target-lang',
    ) as HTMLInputElement | null;
    const cfgDisplayMode = document.getElementById(
        'cfg-display-mode',
    ) as HTMLSelectElement | null;
    const cfgPreferNativeSubtitles = document.getElementById(
        'cfg-prefer-native-subtitles',
    ) as HTMLInputElement | null;
    const cfgExtractNativeTerms = document.getElementById(
        'cfg-extract-native-terms',
    ) as HTMLInputElement | null;
    const cfgHideNative = document.getElementById(
        'cfg-hide-native',
    ) as HTMLInputElement | null;
    const cfgEnableDomSync = document.getElementById(
        'cfg-enable-dom-sync',
    ) as HTMLInputElement | null;
    const cfgEnableLearning = document.getElementById(
        'cfg-enable-learning',
    ) as HTMLInputElement | null;
    const cfgAutoPauseLearning = document.getElementById(
        'cfg-auto-pause-learning',
    ) as HTMLInputElement | null;
    const cfgChinesePhoneticSystem = document.getElementById(
        'cfg-chinese-phonetic-system',
    ) as HTMLSelectElement | null;
    const cfgKoreanPhoneticSystem = document.getElementById(
        'cfg-korean-phonetic-system',
    ) as HTMLSelectElement | null;
    const cfgVocabEnabled = document.getElementById(
        'cfg-vocab-enabled',
    ) as HTMLInputElement | null;
    const cfgRecordVocabAsLemma = document.getElementById(
        'cfg-record-vocab-as-lemma',
    ) as HTMLInputElement | null;
    const cfgVocabProvider = document.getElementById(
        'cfg-vocab-provider',
    ) as HTMLSelectElement | null;
    const cfgVocabOpenrouterGroup = document.getElementById(
        'cfg-vocab-openrouter-group',
    ) as HTMLElement | null;
    const cfgVocabOpenrouterModel = document.getElementById(
        'cfg-vocab-openrouter-model',
    ) as HTMLSelectElement | null;
    const cfgVocabOllamaGroup = document.getElementById(
        'cfg-vocab-ollama-group',
    ) as HTMLElement | null;
    const cfgVocabOllamaModel = document.getElementById(
        'cfg-vocab-ollama-model',
    ) as HTMLSelectElement | null;
    const cfgVocabDifficulty = document.getElementById(
        'cfg-vocab-difficulty',
    ) as HTMLSelectElement | null;
    const cfgVocabSourceLang = document.getElementById(
        'cfg-vocab-source-lang',
    ) as HTMLInputElement | null;
    const cfgVocabCustomPrompt = document.getElementById(
        'cfg-vocab-custom-prompt',
    ) as HTMLTextAreaElement | null;
    const cfgCacheRetention = document.getElementById(
        'cfg-cache-retention',
    ) as HTMLSelectElement | null;

    // DOM Elements - Mindful Viewing & Static Friction
    const cfgFrictionEnabled = document.getElementById(
        'cfg-friction-enabled',
    ) as HTMLInputElement | null;
    const cfgFrictionDetailGroup = document.getElementById(
        'cfg-friction-detail-group',
    );
    const cfgFrictionInterval = document.getElementById(
        'cfg-friction-interval',
    ) as HTMLSelectElement | null;
    const cfgFrictionDailyLimit = document.getElementById(
        'cfg-friction-daily-limit',
    ) as HTMLSelectElement | null;
    const cfgFrictionCurfewEnabled = document.getElementById(
        'cfg-friction-curfew-enabled',
    ) as HTMLInputElement | null;
    const cfgFrictionCurfewTimeGroup = document.getElementById(
        'cfg-friction-curfew-time-group',
    );
    const cfgFrictionCurfewTime = document.getElementById(
        'cfg-friction-curfew-time',
    ) as HTMLInputElement | null;
    const cfgFrictionScreenType = document.getElementById(
        'cfg-friction-screen-type',
    ) as HTMLSelectElement | null;
    const cfgFrictionBreakDuration = document.getElementById(
        'cfg-friction-break-duration',
    ) as HTMLSelectElement | null;
    const cfgFrictionAutoResume = document.getElementById(
        'cfg-friction-auto-resume',
    ) as HTMLInputElement | null;
    const cfgFrictionUnlockDiff = document.getElementById(
        'cfg-friction-unlock-difficulty',
    ) as HTMLSelectElement | null;
    const cfgFrictionLlmAdvice = document.getElementById(
        'cfg-friction-llm-advice',
    ) as HTMLInputElement | null;
    const chkFrictionExcludePlatforms = document.querySelectorAll<HTMLInputElement>(
        '.chk-friction-exclude-platform',
    );
    const cfgFrictionLockGroup = document.getElementById(
        'cfg-friction-lock-group',
    );
    const cfgFrictionLockEnabled = document.getElementById(
        'cfg-friction-lock-enabled',
    ) as HTMLInputElement | null;
    const cfgFrictionLockStatus = document.getElementById(
        'cfg-friction-lock-status',
    );
    const cfgFrictionLockConfirmBox = document.getElementById(
        'cfg-friction-lock-confirm-box',
    );
    const cfgFrictionLockPledgeDisplay = document.getElementById(
        'cfg-friction-lock-pledge-display',
    );
    const cfgFrictionLockInput = document.getElementById(
        'cfg-friction-lock-input',
    ) as HTMLInputElement | null;
    const cfgFrictionLockError = document.getElementById(
        'cfg-friction-lock-error',
    );
    const btnFrictionLockConfirm = document.getElementById(
        'btn-friction-lock-confirm',
    ) as HTMLButtonElement | null;
    const btnFrictionLockCancel = document.getElementById(
        'btn-friction-lock-cancel',
    ) as HTMLButtonElement | null;

    // DOM Elements - Modal & Toast
    const toastNotify = document.getElementById('toast-notify');

    // DOM Elements - Range Invalidate Modal
    const cacheRangeModal = document.getElementById('cache-range-modal');
    const rangeModalShowTitle = document.getElementById(
        'range-modal-show-title',
    );
    const rangeModalTrackHash = document.getElementById(
        'range-modal-track-hash',
    );
    const rangeStartText = document.getElementById(
        'range-start-text',
    ) as HTMLInputElement | null;
    const rangeEndText = document.getElementById(
        'range-end-text',
    ) as HTMLInputElement | null;
    const rangeSliderStart = document.getElementById(
        'range-slider-start',
    ) as HTMLInputElement | null;
    const rangeSliderEnd = document.getElementById(
        'range-slider-end',
    ) as HTMLInputElement | null;
    const rangeSliderStartVal = document.getElementById(
        'range-slider-start-val',
    );
    const rangeSliderEndVal = document.getElementById('range-slider-end-val');
    const rangeSliderMaxLabel = document.getElementById(
        'range-slider-max-label',
    );
    const rangePreviewCount = document.getElementById('range-preview-count');
    const btnRangeModalClose = document.getElementById('btn-range-modal-close');
    const btnRangeModalCancel = document.getElementById(
        'btn-range-modal-cancel',
    );
    const btnRangeModalConfirm = document.getElementById(
        'btn-range-modal-confirm',
    );

    let activeRangeTrack: TrackCacheRecord | null = null;

    // 1. Tab Switching
    function switchTab(tabId?: string): void {
        if (!tabId) return;
        navTabs.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        tabPanes.forEach((pane) => {
            pane.classList.toggle('active', pane.id === `pane-${tabId}`);
        });
        sessionStorage.setItem('ncw_options_active_tab', tabId);

        if (tabId === 'history') {
            loadWatchHistory();
        }
    }

    navTabs.forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    const savedTab = sessionStorage.getItem('ncw_options_active_tab');
    if (savedTab) {
        switchTab(savedTab);
    }

    // Dynamic Markdown Document Renderer for Single-Source Contributors & Credits
    function renderMarkdownDocument(md: string): string {
        const lines = md.split('\n');
        const html: string[] = [];
        let inList = false;
        let inBlockquote = false;
        let blockquoteLines: string[] = [];

        const formatInline = (text: string): string => {
            return text
                .replace(
                    /\[([^\]]+)\]\(([^)]+)\)/g,
                    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
                )
                .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
                .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                .replace(/\*([^*]+)\*/g, '<em>$1</em>')
                .replace(/_([^_]+)_/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code>$1</code>');
        };

        const flushBlockquote = () => {
            if (!inBlockquote) return;
            const joined = blockquoteLines.join('\n');
            const isWarning =
                joined.includes('[!IMPORTANT]') || joined.includes('⚠️');
            const alertClass = isWarning
                ? 'md-alert md-alert-warning'
                : 'md-alert md-alert-info';
            const cleanContent = blockquoteLines
                .map((l) => l.replace(/^>\s?/, ''))
                .filter((l) => !l.match(/^\[!(IMPORTANT|NOTE|TIP|WARNING)\]/))
                .map((l) => {
                    const t = l.trim();
                    if (t.startsWith('### ')) {
                        return `<h3 class="md-h3">${formatInline(t.substring(4))}</h3>`;
                    }
                    return formatInline(t);
                })
                .filter((l) => l.length > 0)
                .join('<br />');

            html.push(`<div class="${alertClass}">${cleanContent}</div>`);
            blockquoteLines = [];
            inBlockquote = false;
        };

        const flushList = () => {
            if (inList) {
                html.push('</ul>');
                inList = false;
            }
        };

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            const trimmed = rawLine.trim();

            if (trimmed.startsWith('>')) {
                flushList();
                inBlockquote = true;
                blockquoteLines.push(trimmed);
                continue;
            } else if (inBlockquote) {
                flushBlockquote();
            }

            if (trimmed.startsWith('# ')) {
                flushList();
                html.push(
                    `<h1 class="md-h1">${formatInline(trimmed.substring(2))}</h1>`,
                );
            } else if (trimmed.startsWith('## ')) {
                flushList();
                html.push(
                    `<h2 class="md-h2">${formatInline(trimmed.substring(3))}</h2>`,
                );
            } else if (trimmed.startsWith('### ')) {
                flushList();
                html.push(
                    `<h3 class="md-h3">${formatInline(trimmed.substring(4))}</h3>`,
                );
            } else if (trimmed === '---' || trimmed === '***') {
                flushList();
                html.push('<hr class="md-hr" />');
            } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                if (!inList) {
                    html.push('<ul class="md-ul">');
                    inList = true;
                }
                html.push(
                    `<li class="md-li">${formatInline(trimmed.substring(2))}</li>`,
                );
            } else if (
                rawLine.startsWith('  - ') ||
                rawLine.startsWith('    - ')
            ) {
                if (!inList) {
                    html.push('<ul class="md-ul">');
                    inList = true;
                }
                html.push(
                    `<li class="md-li" style="margin-left: 1.25rem;">${formatInline(trimmed.substring(2))}</li>`,
                );
            } else if (trimmed.length === 0) {
                flushList();
            } else {
                flushList();
                html.push(`<p class="md-p">${formatInline(trimmed)}</p>`);
            }
        }

        flushList();
        flushBlockquote();
        return html.join('\n');
    }

    const contributorsView = document.getElementById('contributors-md-view');
    if (contributorsView) {
        contributorsView.innerHTML =
            renderMarkdownDocument(contributorsMarkdown);
    }
    const creditsView = document.getElementById('credits-md-view');
    if (creditsView) {
        creditsView.innerHTML = renderMarkdownDocument(creditsMarkdown);
    }

    // Toast Helper
    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    function showToast(message: string): void {
        if (!toastNotify) return;
        toastNotify.textContent = message;
        toastNotify.classList.add('show');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toastNotify.classList.remove('show');
        }, 2400);
    }

    const ankiService = new AnkiService();
    const ankiModal = new AnkiExportModal(ankiService, (msg) => showToast(msg));
    const vocabCurationService = new VocabCurationService(
        messageService,
        storage,
    );
    const vocabEditorModal = new VocabPreviewEditorModal(
        vocabCurationService,
        ankiModal,
        (msg) => showToast(msg),
        (episode, words) => {
            exportVocabCsv(episode, words);
        },
    );

    function escapeHtml(str: string): string {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatRelativeTime(ts?: number): string {
        if (!ts) return 'Never';
        const diff = Date.now() - ts;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    // ==========================================
    // TAB 1: SUBTITLE CACHE CONTROLLER
    // ==========================================
    async function loadSubtitleCaches(): Promise<void> {
        try {
            const retention = currentSettings.cacheRetention || '1m';
            await cacheRepository.cleanExpiredRecords(retention).catch(() => 0);
            const records = await cacheRepository.getAllTrackCaches();
            cachedTracks = records || [];
            renderSubtitleCaches();
        } catch (e) {
            logger.warn('options', 'Failed loading caches:', e);
        }
    }

    function renderSubtitleCaches(): void {
        const query = (cacheSearchInput?.value || '').trim().toLowerCase();
        const filtered = cachedTracks.filter((t) => {
            if (!query) return true;
            return (
                (t.showTitle && t.showTitle.toLowerCase().includes(query)) ||
                (t.movieId && t.movieId.toLowerCase().includes(query)) ||
                (t.trackHash && t.trackHash.toLowerCase().includes(query)) ||
                (t.translationModel &&
                    t.translationModel.toLowerCase().includes(query)) ||
                (t.targetLanguage &&
                    t.targetLanguage.toLowerCase().includes(query))
            );
        });

        const totalTracks = cachedTracks.length;
        let totalCues = 0;
        let totalReviewed = 0;
        let totalRaw = 0;

        cachedTracks.forEach((t) => {
            const cuesCount = Object.keys(t.cues || {}).length;
            totalCues += cuesCount;
            const rev = t.reviewedCount || 0;
            totalReviewed += rev;
            totalRaw += Math.max(0, cuesCount - rev);
        });

        if (statCacheTracks) statCacheTracks.textContent = String(totalTracks);
        if (statCacheCues) statCacheCues.textContent = String(totalCues);
        if (statCacheReviewedRaw)
            statCacheReviewedRaw.textContent = `${totalReviewed} / ${totalRaw}`;
        if (navCacheCount) navCacheCount.textContent = String(totalTracks);
        if (cacheListCount)
            cacheListCount.textContent = `Showing ${filtered.length} of ${totalTracks} tracks`;

        if (!cacheTableBody) return;

        if (filtered.length === 0) {
            cacheTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state" style="text-align: center; padding: 40px; color: #888;">
            ${cachedTracks.length === 0 ? 'No persistent subtitle caches found yet. Watch any video with translation enabled to populate the cache.' : 'No matching subtitle tracks found.'}
          </td>
        </tr>
      `;
            return;
        }

        // Group filtered tracks by show title (or movie ID if no title)
        const groupsMap = new Map<
            string,
            {
                groupId: string;
                showTitle: string;
                tracks: TrackCacheRecord[];
                totalCues: number;
                reviewedCues: number;
                rawCues: number;
                latestUpdated: number;
            }
        >();

        filtered.forEach((t) => {
            const rawTitle = (t.showTitle || '').trim();
            const groupId = rawTitle
                ? rawTitle.toLowerCase()
                : `movie_${t.movieId || 'unknown'}`;
            const showTitle = rawTitle || `Episode ${t.movieId || 'Unknown'}`;
            const cuesCount = Object.keys(t.cues || {}).length;
            const rev = t.reviewedCount || 0;
            const raw = Math.max(0, cuesCount - rev);
            const updatedAt = t.updatedAt || 0;

            let group = groupsMap.get(groupId);
            if (!group) {
                group = {
                    groupId,
                    showTitle,
                    tracks: [],
                    totalCues: 0,
                    reviewedCues: 0,
                    rawCues: 0,
                    latestUpdated: updatedAt,
                };
                groupsMap.set(groupId, group);
            }
            group.tracks.push(t);
            group.totalCues += cuesCount;
            group.reviewedCues += rev;
            group.rawCues += raw;
            if (updatedAt > group.latestUpdated) {
                group.latestUpdated = updatedAt;
            }
        });

        const groups = Array.from(groupsMap.values()).sort(
            (a, b) => b.latestUpdated - a.latestUpdated,
        );

        let html = '';
        groups.forEach((g) => {
            const isExpanded = expandedCacheGroups.has(g.groupId);
            html += `
        <tr class="cache-group-header-row" data-group-id="${escapeHtml(g.groupId)}">
          <td colspan="7">
            <div class="cache-group-header">
              <div class="cache-group-title-area">
                <span class="cache-group-toggle-btn">
                  <span class="toggle-icon ${isExpanded ? 'expanded' : ''}">▶</span>
                  <span class="cache-group-title">${escapeHtml(g.showTitle)}</span>
                </span>
                <span class="badge badge-neutral">${g.tracks.length} ${g.tracks.length > 1 ? 'episodes' : 'episode'}</span>
              </div>
              <div class="cache-group-stats">
                <span style="color: #46d369; font-weight: 600;">${g.reviewedCues}</span>
                <span style="color: #666;"> / </span>
                <span style="color: #e5a00d;">${g.rawCues}</span>
                <span style="font-size: 11px; color: #777;"> (${g.totalCues} cues)</span>
                <span class="cache-group-hint">${isExpanded ? 'Click to collapse ▲' : 'Click to expand episodes ▼'}</span>
              </div>
            </div>
          </td>
        </tr>
      `;

            g.tracks
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                .forEach((t) => {
                    const cuesCount = Object.keys(t.cues || {}).length;
                    const reviewed = t.reviewedCount || 0;
                    const raw = Math.max(0, cuesCount - reviewed);
                    const hashDisplay = escapeHtml(
                        (t.trackHash || '').slice(0, 10),
                    );
                    const modelDisplay = escapeHtml(
                        `${t.provider || 'ollama'} : ${t.translationModel || ''}`,
                    );
                    const langDisplay = escapeHtml(
                        t.targetLanguage || 'English',
                    );

                    html += `
            <tr class="cache-child-row" data-parent-group="${escapeHtml(g.groupId)}" style="${isExpanded ? '' : 'display: none;'}">
              <td>
                <div style="font-weight: 600; color: #fff;">Episode ID: ${escapeHtml(t.movieId || 'N/A')}</div>
                <div style="font-size: 11px; color: #888;">${escapeHtml(t.showTitle || '')}</div>
              </td>
              <td><code>${hashDisplay}...</code></td>
              <td><span class="badge badge-neutral">${langDisplay}</span></td>
              <td><span style="font-size: 12px; color: #aaa;">${modelDisplay}</span></td>
              <td>
                <span style="font-weight: 600; color: #46d369;">${reviewed}</span>
                <span style="color: #666;"> / </span>
                <span style="color: #e5a00d;">${raw}</span>
                <span style="font-size: 11px; color: #777;"> (${cuesCount} total)</span>
              </td>
              <td style="font-size: 12px; color: #888;">${formatRelativeTime(t.updatedAt)}</td>
              <td style="white-space: nowrap;">
                <button class="btn-secondary btn-sm btn-range-stale" data-key="${escapeHtml(t.cacheKey)}" style="margin-right: 6px;">
                  ⏱️ Invalidate Range
                </button>
                <button class="btn-danger btn-sm btn-delete-cache" data-key="${escapeHtml(t.cacheKey)}">
                  🗑️ Delete
                </button>
              </td>
            </tr>
          `;
                });
        });

        cacheTableBody.innerHTML = html;
    }

    // --- Range Invalidate Modal Handlers ---

    function formatSecondsToTime(sec: number): string {
        const s = Math.max(0, Math.floor(sec));
        const m = Math.floor(s / 60);
        const remainingS = s % 60;
        const h = Math.floor(m / 60);
        const remainingM = m % 60;
        if (h > 0) {
            return `${String(h).padStart(2, '0')}:${String(remainingM).padStart(2, '0')}:${String(remainingS).padStart(2, '0')}`;
        }
        return `${String(remainingM).padStart(2, '0')}:${String(remainingS).padStart(2, '0')}`;
    }

    function parseTimeToSeconds(str: string): number {
        const parts = str
            .trim()
            .split(':')
            .map((p) => parseInt(p, 10));
        if (parts.some((p) => isNaN(p))) return 0;
        if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        } else if (parts.length === 1) {
            return parts[0];
        }
        return 0;
    }

    function updateRangePreview(): void {
        if (!activeRangeTrack || !rangeSliderStart || !rangeSliderEnd) return;
        let startSec = parseInt(rangeSliderStart.value, 10) || 0;
        let endSec = parseInt(rangeSliderEnd.value, 10) || 0;

        if (startSec > endSec) {
            endSec = startSec;
            rangeSliderEnd.value = String(endSec);
        }

        if (rangeSliderStartVal)
            rangeSliderStartVal.textContent = formatSecondsToTime(startSec);
        if (rangeSliderEndVal)
            rangeSliderEndVal.textContent = formatSecondsToTime(endSec);
        if (rangeStartText && document.activeElement !== rangeStartText) {
            rangeStartText.value = formatSecondsToTime(startSec);
        }
        if (rangeEndText && document.activeElement !== rangeEndText) {
            rangeEndText.value = formatSecondsToTime(endSec);
        }

        const cues = Object.values(activeRangeTrack.cues || {});
        const count = cues.filter((c) => {
            const cStart = c.startTime ?? 0;
            const cEnd = c.endTime ?? cStart + 5;
            return cStart <= endSec && cEnd >= startSec && c.status !== 'stale';
        }).length;

        if (rangePreviewCount) {
            rangePreviewCount.innerHTML = `<strong>${count}</strong> cues match this range (${formatSecondsToTime(startSec)} - ${formatSecondsToTime(endSec)}) and will be marked stale.`;
        }
    }

    function openRangeModal(track: TrackCacheRecord): void {
        activeRangeTrack = track;
        if (rangeModalShowTitle) {
            rangeModalShowTitle.textContent = `${track.showTitle || 'Unknown Show'} (${track.movieId || 'N/A'})`;
        }
        if (rangeModalTrackHash) {
            rangeModalTrackHash.textContent = `Track Hash: ${track.trackHash} | Provider: ${track.provider} (${track.translationModel})`;
        }

        const cues = Object.values(track.cues || {});
        let maxSec = 3600;
        cues.forEach((c) => {
            if (c.endTime && c.endTime > maxSec) maxSec = Math.ceil(c.endTime);
            else if (c.startTime && c.startTime + 10 > maxSec)
                maxSec = Math.ceil(c.startTime + 10);
        });

        if (rangeSliderStart && rangeSliderEnd) {
            rangeSliderStart.max = String(maxSec);
            rangeSliderEnd.max = String(maxSec);
            rangeSliderStart.value = '0';
            rangeSliderEnd.value = String(Math.min(600, maxSec));
        }
        if (rangeSliderMaxLabel) {
            rangeSliderMaxLabel.textContent = formatSecondsToTime(maxSec);
        }

        updateRangePreview();

        if (cacheRangeModal) {
            cacheRangeModal.style.display = 'flex';
        }
    }

    function closeRangeModal(): void {
        activeRangeTrack = null;
        if (cacheRangeModal) {
            cacheRangeModal.style.display = 'none';
        }
    }

    // Handle Cache Table Actions (Delete, Invalidate Range, & Accordion Toggle)
    cacheTableBody?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;

        const groupRow = target?.closest(
            '.cache-group-header-row',
        ) as HTMLElement | null;
        if (groupRow && !target?.closest('button')) {
            const gid = groupRow.dataset.groupId;
            if (gid) {
                if (expandedCacheGroups.has(gid)) {
                    expandedCacheGroups.delete(gid);
                } else {
                    expandedCacheGroups.add(gid);
                }
                renderSubtitleCaches();
                return;
            }
        }

        const rangeBtn = target?.closest(
            '.btn-range-stale',
        ) as HTMLButtonElement | null;
        if (rangeBtn) {
            const cacheKey = rangeBtn.dataset.key;
            const track = cachedTracks.find((t) => t.cacheKey === cacheKey);
            if (track) openRangeModal(track);
            return;
        }

        const delBtn = target?.closest(
            '.btn-delete-cache',
        ) as HTMLButtonElement | null;
        if (delBtn) {
            const cacheKey = delBtn.dataset.key;
            if (!cacheKey) return;
            if (
                confirm(
                    'Are you sure you want to delete this cached subtitle track?',
                )
            ) {
                cacheRepository.deleteTrackCache(cacheKey).then(() => {
                    showToast('Cached subtitle track deleted');
                    loadSubtitleCaches();
                });
            }
        }
    });

    btnRangeModalClose?.addEventListener('click', closeRangeModal);
    btnRangeModalCancel?.addEventListener('click', closeRangeModal);
    cacheRangeModal?.addEventListener('click', (e) => {
        if (e.target === cacheRangeModal) closeRangeModal();
    });

    rangeSliderStart?.addEventListener('input', () => {
        if (rangeSliderStart && rangeSliderEnd) {
            if (
                parseInt(rangeSliderStart.value, 10) >
                parseInt(rangeSliderEnd.value, 10)
            ) {
                rangeSliderEnd.value = rangeSliderStart.value;
            }
        }
        updateRangePreview();
    });

    rangeSliderEnd?.addEventListener('input', () => {
        if (rangeSliderStart && rangeSliderEnd) {
            if (
                parseInt(rangeSliderEnd.value, 10) <
                parseInt(rangeSliderStart.value, 10)
            ) {
                rangeSliderStart.value = rangeSliderEnd.value;
            }
        }
        updateRangePreview();
    });

    rangeStartText?.addEventListener('change', () => {
        if (!rangeStartText || !rangeSliderStart) return;
        const sec = parseTimeToSeconds(rangeStartText.value);
        rangeSliderStart.value = String(sec);
        if (rangeSliderEnd && parseInt(rangeSliderEnd.value, 10) < sec) {
            rangeSliderEnd.value = String(sec);
        }
        updateRangePreview();
    });

    rangeEndText?.addEventListener('change', () => {
        if (!rangeEndText || !rangeSliderEnd) return;
        const sec = parseTimeToSeconds(rangeEndText.value);
        rangeSliderEnd.value = String(sec);
        if (rangeSliderStart && parseInt(rangeSliderStart.value, 10) > sec) {
            rangeSliderStart.value = String(sec);
        }
        updateRangePreview();
    });

    btnRangeModalConfirm?.addEventListener('click', async () => {
        if (!activeRangeTrack || !rangeSliderStart || !rangeSliderEnd) return;
        const startSec = parseInt(rangeSliderStart.value, 10) || 0;
        const endSec = parseInt(rangeSliderEnd.value, 10) || 0;

        btnRangeModalConfirm.setAttribute('disabled', 'true');
        btnRangeModalConfirm.textContent = 'Invalidating...';

        try {
            const res = await messageService.markCuesStale({
                cacheKey: activeRangeTrack.cacheKey,
                trackHash: activeRangeTrack.trackHash,
                startTime: startSec,
                endTime: endSec,
            });

            if (res && res.success) {
                showToast(
                    `Marked ${res.invalidatedCount} cues as stale [${formatSecondsToTime(startSec)} - ${formatSecondsToTime(endSec)}]`,
                );
                closeRangeModal();
                await loadSubtitleCaches();
            } else {
                alert(
                    `Failed to invalidate cues: ${res?.error || 'Unknown error'}`,
                );
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            alert(`Error invalidating cues: ${msg}`);
        } finally {
            btnRangeModalConfirm.removeAttribute('disabled');
            btnRangeModalConfirm.textContent = '⚠️ Mark Range Stale';
        }
    });

    btnClearAllCache?.addEventListener('click', () => {
        if (confirm('⚠️ Clear ALL indexedDB subtitle translation caches?')) {
            cacheRepository.clearAllTrackCaches().then(() => {
                showToast('All subtitle caches cleared');
                loadSubtitleCaches();
            });
        }
    });

    btnCleanExpiredCache?.addEventListener('click', async () => {
        const retention = currentSettings.cacheRetention || '1m';
        const cleaned = await cacheRepository.cleanExpiredRecords(retention);
        showToast(
            cleaned > 0
                ? `Cleaned ${cleaned} expired subtitle cache(s).`
                : 'No expired subtitle caches found.',
        );
        loadSubtitleCaches();
    });

    cacheRetentionSelect?.addEventListener('change', async () => {
        const val = (cacheRetentionSelect.value || '1m') as
            | '1w'
            | '1m'
            | '1y';
        currentSettings.cacheRetention = val;
        if (cfgCacheRetention) {
            cfgCacheRetention.value = val;
        }
        await storage.set({
            [NCW_CONSTANTS.STORAGE_KEYS.SETTINGS]: currentSettings,
        });
        const cleaned = await cacheRepository.cleanExpiredRecords(val);
        showToast(
            cleaned > 0
                ? `Retention set to ${val}. Cleaned ${cleaned} expired cache(s).`
                : `Retention set to ${val}.`,
        );
        loadSubtitleCaches();
    });

    cfgCacheRetention?.addEventListener('change', () => {
        if (cacheRetentionSelect && cfgCacheRetention) {
            cacheRetentionSelect.value = cfgCacheRetention.value;
            cacheRetentionSelect.dispatchEvent(new Event('change'));
        }
    });

    btnRefreshCache?.addEventListener('click', loadSubtitleCaches);
    cacheSearchInput?.addEventListener('input', renderSubtitleCaches);

    // ==========================================
    // TAB 2: VOCABULARY CONTROLLER
    // ==========================================
    function loadVocabBank(): void {
        storage.get<EpisodeVocabData>(null).then((all) => {
            cachedVocabList = [];
            if (all) {
                for (const [key, val] of Object.entries(all)) {
                    if (
                        key.startsWith(NCW_STORAGE_KEYS.VOCAB_PREFIX) &&
                        val &&
                        Array.isArray((val as EpisodeVocabData).words)
                    ) {
                        cachedVocabList.push(val as EpisodeVocabData);
                    }
                }
            }
            cachedVocabList.sort(
                (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
            );
            renderVocabBank();
        });
    }

    function renderVocabBank(): void {
        const query = (vocabSearchInput?.value || '').trim().toLowerCase();
        const sourceFilter = vocabSourceFilter
            ? vocabSourceFilter.value
            : 'all';

        const processedList = cachedVocabList.map((v) => {
            let words = v.words;
            if (sourceFilter === 'user') {
                words = words.filter((w) => w.source === 'user');
            } else if (sourceFilter === 'ai') {
                words = words.filter((w) => w.source !== 'user');
            }
            return { ...v, words };
        });

        const filtered = processedList.filter((v) => {
            if (sourceFilter !== 'all' && v.words.length === 0) return false;
            if (!query) return true;
            const titleMatch =
                (v.showTitle && v.showTitle.toLowerCase().includes(query)) ||
                (v.movieId && v.movieId.toLowerCase().includes(query));
            if (titleMatch) return true;
            return v.words.some(
                (w) =>
                    (w.word && w.word.toLowerCase().includes(query)) ||
                    (w.meaning && w.meaning.toLowerCase().includes(query)),
            );
        });

        const totalEpisodes = cachedVocabList.length;
        let totalWords = 0;
        cachedVocabList.forEach((v) => {
            totalWords += v.words.length;
        });

        if (statVocabEpisodes)
            statVocabEpisodes.textContent = String(totalEpisodes);
        if (statVocabWords) statVocabWords.textContent = String(totalWords);
        if (navVocabCount) navVocabCount.textContent = String(totalWords);
        if (vocabListCount)
            vocabListCount.textContent = `Showing ${filtered.length} of ${totalEpisodes} episodes`;

        // Update Select All Checkbox and Batch Export Button
        const allFilteredEpisodeIds = filtered.map((v) => v.movieId);
        const selectedCountInFiltered = allFilteredEpisodeIds.filter((id) =>
            selectedVocabEpisodeIds.has(id),
        ).length;

        if (vocabSelectAllCheckbox) {
            if (
                allFilteredEpisodeIds.length > 0 &&
                selectedCountInFiltered === allFilteredEpisodeIds.length
            ) {
                vocabSelectAllCheckbox.checked = true;
                vocabSelectAllCheckbox.indeterminate = false;
            } else if (selectedCountInFiltered > 0) {
                vocabSelectAllCheckbox.checked = false;
                vocabSelectAllCheckbox.indeterminate = true;
            } else {
                vocabSelectAllCheckbox.checked = false;
                vocabSelectAllCheckbox.indeterminate = false;
            }
        }

        if (btnExportSelectedVocab) {
            const totalSelected = selectedVocabEpisodeIds.size;
            btnExportSelectedVocab.disabled = totalSelected === 0;
            btnExportSelectedVocab.textContent = `⬇️ Export Selected (${totalSelected})`;
        }

        if (btnExportAnki) {
            const totalSelected = selectedVocabEpisodeIds.size;
            btnExportAnki.disabled = totalSelected === 0;
            btnExportAnki.textContent = `🎴 Export to Anki (${totalSelected})`;
        }

        if (!vocabCardsGrid) return;

        if (filtered.length === 0) {
            vocabCardsGrid.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 40px; color: #888;">
          ${cachedVocabList.length === 0 ? 'No vocabulary collected yet. Enable AI Vocabulary Extractor in settings to start collecting difficult words while watching.' : 'No matching vocabulary found.'}
        </div>
      `;
            return;
        }

        // Group filtered vocabulary by show title (or movie ID if no title)
        const groupsMap = new Map<
            string,
            {
                groupId: string;
                showTitle: string;
                episodes: EpisodeVocabData[];
                totalWords: number;
                latestUpdated: number;
            }
        >();

        filtered.forEach((v) => {
            const rawTitle = (v.showTitle || '').trim();
            const groupId = rawTitle
                ? rawTitle.toLowerCase()
                : `movie_${v.movieId || 'unknown'}`;
            const showTitle = rawTitle || `Episode ${v.movieId || 'Unknown'}`;
            const wordCount = v.words.length;
            const updatedAt = v.updatedAt || 0;

            let group = groupsMap.get(groupId);
            if (!group) {
                group = {
                    groupId,
                    showTitle,
                    episodes: [],
                    totalWords: 0,
                    latestUpdated: updatedAt,
                };
                groupsMap.set(groupId, group);
            }
            group.episodes.push(v);
            group.totalWords += wordCount;
            if (updatedAt > group.latestUpdated) {
                group.latestUpdated = updatedAt;
            }
        });

        const groups = Array.from(groupsMap.values()).sort(
            (a, b) => b.latestUpdated - a.latestUpdated,
        );

        let html = '';
        groups.forEach((g) => {
            const isExpanded = expandedVocabGroups.has(g.groupId);
            const groupEpisodeIds = g.episodes.map((e) => e.movieId);
            const allGroupSelected =
                groupEpisodeIds.length > 0 &&
                groupEpisodeIds.every((id) => selectedVocabEpisodeIds.has(id));
            const someGroupSelected =
                !allGroupSelected &&
                groupEpisodeIds.some((id) => selectedVocabEpisodeIds.has(id));

            html += `
        <div class="vocab-show-group ${isExpanded ? 'expanded' : ''}" data-group-id="${escapeHtml(g.groupId)}">
          <div class="vocab-show-header">
            <div class="vocab-show-info">
              <input type="checkbox" class="chk-show-select" data-group-id="${escapeHtml(g.groupId)}" ${allGroupSelected ? 'checked' : ''} ${someGroupSelected ? 'data-indeterminate="true"' : ''} title="Select all episodes of this show">
              <div class="vocab-show-toggle" data-toggle="${escapeHtml(g.groupId)}">
                <span class="toggle-icon ${isExpanded ? 'expanded' : ''}">▶</span>
                <span class="vocab-show-title">${escapeHtml(g.showTitle)}</span>
              </div>
              <span class="badge badge-neutral">${g.episodes.length} ${g.episodes.length > 1 ? 'episodes' : 'episode'}</span>
              <span class="badge badge-green">${g.totalWords} words</span>
            </div>
            <div class="vocab-show-actions">
              <button class="btn-secondary btn-sm btn-export-show" data-group-id="${escapeHtml(g.groupId)}">
                ⬇️ Export Entire Show (CSV)
              </button>
              <button class="btn-secondary btn-sm btn-anki btn-anki-show" data-group-id="${escapeHtml(g.groupId)}" title="Export entire show to Anki">
                🎴 Anki
              </button>
              <button class="btn-secondary btn-sm btn-toggle-vocab-group" data-group-id="${escapeHtml(g.groupId)}">
                ${isExpanded ? 'Collapse ▲' : 'Expand ▼'}
              </button>
            </div>
          </div>
          <div class="vocab-episodes-container" style="${isExpanded ? '' : 'display: none;'}">
            ${g.episodes
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                .map((v) => {
                    const count = v.words.length;
                    const isEpSelected = selectedVocabEpisodeIds.has(v.movieId);
                    const wordPreview = v.words
                        .slice(0, 6)
                        .map((w) => {
                            const isUser = w.source === 'user';
                            return `<span class="word-chip ${isUser ? 'word-chip-user' : ''}" style="${isUser ? 'background: rgba(212,175,55,0.18); border-color: rgba(212,175,55,0.6); color: #ffd700;' : ''}">${isUser ? '⭐ ' : ''}${escapeHtml(w.word)}</span>`;
                        })
                        .join('');

                    return `
                  <div class="vocab-episode-card">
                    <div>
                      <div class="vocab-episode-header">
                        <div class="vocab-episode-title-area">
                          <input type="checkbox" class="chk-episode-select" data-id="${escapeHtml(v.movieId)}" ${isEpSelected ? 'checked' : ''}>
                          <div>
                            <div class="vocab-episode-id">Episode ID: ${escapeHtml(v.movieId)}</div>
                            <div style="font-size: 11px; color: #888;">${escapeHtml(v.showTitle || '')}</div>
                          </div>
                        </div>
                        <span class="badge badge-green">${count} words</span>
                      </div>
                      <div class="vocab-episode-body">
                        <div style="font-size: 11px; color:#888; margin-bottom: 6px;">Collected Words Preview:</div>
                        <div class="tags-cloud">${wordPreview || '<span style="color:#666; font-size: 11px;">No words yet</span>'}</div>
                      </div>
                    </div>
                    <div class="vocab-episode-footer">
                      <span style="font-size: 11px; color:#777;">${formatRelativeTime(v.updatedAt)}</span>
                      <div style="display: flex; gap: 6px;">
                        <button class="btn-secondary btn-sm btn-preview-vocab" data-id="${escapeHtml(v.movieId)}">
                          👁️ View
                        </button>
                        <button class="btn-primary btn-sm btn-export-single-vocab" data-id="${escapeHtml(v.movieId)}">
                          ⬇️ Export
                        </button>
                        <button class="btn-secondary btn-sm btn-anki btn-anki-single-vocab" data-id="${escapeHtml(v.movieId)}" title="Export this episode to Anki">
                          🎴 Anki
                        </button>
                        <button class="btn-danger btn-sm btn-delete-vocab" data-id="${escapeHtml(v.movieId)}">
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                `;
                })
                .join('')}
          </div>
        </div>
      `;
        });

        vocabCardsGrid.innerHTML = html;

        // Apply indeterminate property to show checkboxes
        vocabCardsGrid
            .querySelectorAll<HTMLInputElement>(
                '.chk-show-select[data-indeterminate="true"]',
            )
            .forEach((cb) => {
                cb.indeterminate = true;
            });
    }

    // Handle Vocab Actions
    vocabCardsGrid?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;

        // Episode Checkbox Toggle
        const chkEp = target?.closest(
            '.chk-episode-select',
        ) as HTMLInputElement | null;
        if (chkEp) {
            const mid = chkEp.dataset.id;
            if (mid) {
                if (chkEp.checked) {
                    selectedVocabEpisodeIds.add(mid);
                } else {
                    selectedVocabEpisodeIds.delete(mid);
                }
                renderVocabBank();
            }
            return;
        }

        // Show Checkbox Toggle
        const chkShow = target?.closest(
            '.chk-show-select',
        ) as HTMLInputElement | null;
        if (chkShow) {
            const gid = chkShow.dataset.groupId;
            if (gid) {
                const isChecked = chkShow.checked;
                const matchingEps = cachedVocabList.filter((v) => {
                    const rawTitle = (v.showTitle || '').trim();
                    const g = rawTitle
                        ? rawTitle.toLowerCase()
                        : `movie_${v.movieId || 'unknown'}`;
                    return g === gid;
                });
                matchingEps.forEach((v) => {
                    if (isChecked) {
                        selectedVocabEpisodeIds.add(v.movieId);
                    } else {
                        selectedVocabEpisodeIds.delete(v.movieId);
                    }
                });
                renderVocabBank();
            }
            return;
        }

        // Expand / Collapse Show Group
        const toggleTarget = target?.closest(
            '.vocab-show-toggle, .btn-toggle-vocab-group',
        ) as HTMLElement | null;
        if (toggleTarget) {
            const gid =
                toggleTarget.dataset.groupId || toggleTarget.dataset.toggle;
            if (gid) {
                if (expandedVocabGroups.has(gid)) {
                    expandedVocabGroups.delete(gid);
                } else {
                    expandedVocabGroups.add(gid);
                }
                renderVocabBank();
                return;
            }
        }

        // Export Entire Show
        const exportShowBtn = target?.closest(
            '.btn-export-show',
        ) as HTMLButtonElement | null;
        if (exportShowBtn) {
            const gid = exportShowBtn.dataset.groupId;
            if (gid) {
                const matchingEps = cachedVocabList.filter((v) => {
                    const rawTitle = (v.showTitle || '').trim();
                    const g = rawTitle
                        ? rawTitle.toLowerCase()
                        : `movie_${v.movieId || 'unknown'}`;
                    return g === gid;
                });
                const totalWords = matchingEps.reduce(
                    (acc, ep) => acc + ep.words.length,
                    0,
                );
                if (matchingEps.length === 0 || totalWords === 0) {
                    showToast('No vocabulary found for this show.');
                    return;
                }
                const showTitle = matchingEps[0].showTitle || 'show';
                const cleanTitle = showTitle
                    .replace(
                        /[^\w\s\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af-]/g,
                        '',
                    )
                    .trim()
                    .replace(/\s+/g, '_');
                const filename = `${cleanTitle}_full_show_vocab.csv`;

                const session = VocabCurationSession.fromMultipleEpisodes(
                    matchingEps,
                    {
                        title: `${showTitle} · Full Show Vocab Export Confirmation (${matchingEps.length} episodes)`,
                        intent: 'csv',
                        onUpdate: () => loadVocabBank(),
                        onExportCsv: (curatedWords) => {
                            exportMergedVocabCsv(
                                matchingEps,
                                filename,
                                curatedWords,
                            );
                        },
                        onExportAnki: (curatedWords) => {
                            const items = collectCuratedAnkiItems(
                                curatedWords,
                                showTitle,
                            );
                            ankiModal.show(items, getVocabLanguage());
                        },
                    },
                );
                vocabEditorModal.open(session);
            }
            return;
        }

        // Export Entire Show to Anki
        const ankiShowBtn = target?.closest(
            '.btn-anki-show',
        ) as HTMLButtonElement | null;
        if (ankiShowBtn) {
            const gid = ankiShowBtn.dataset.groupId;
            if (gid) {
                const matchingEps = cachedVocabList.filter((v) => {
                    const rawTitle = (v.showTitle || '').trim();
                    const g = rawTitle
                        ? rawTitle.toLowerCase()
                        : `movie_${v.movieId || 'unknown'}`;
                    return g === gid;
                });
                const totalWords = matchingEps.reduce(
                    (acc, ep) => acc + ep.words.length,
                    0,
                );
                if (matchingEps.length === 0 || totalWords === 0) {
                    showToast('No vocabulary found for this show.');
                    return;
                }
                const showTitle = matchingEps[0].showTitle || 'show';
                const cleanTitle = showTitle
                    .replace(
                        /[^\w\s\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af-]/g,
                        '',
                    )
                    .trim()
                    .replace(/\s+/g, '_');
                const filename = `${cleanTitle}_full_show_vocab.csv`;

                const session = VocabCurationSession.fromMultipleEpisodes(
                    matchingEps,
                    {
                        title: `${showTitle} · Full Show Anki Export Confirmation (${matchingEps.length} episodes)`,
                        intent: 'anki',
                        onUpdate: () => loadVocabBank(),
                        onExportCsv: (curatedWords) => {
                            exportMergedVocabCsv(
                                matchingEps,
                                filename,
                                curatedWords,
                            );
                        },
                        onExportAnki: (curatedWords) => {
                            const items = collectCuratedAnkiItems(
                                curatedWords,
                                showTitle,
                            );
                            ankiModal.show(items, getVocabLanguage());
                        },
                    },
                );
                vocabEditorModal.open(session);
            }
            return;
        }

        // Export Single Episode
        const exportSingleBtn = target?.closest(
            '.btn-export-single-vocab',
        ) as HTMLButtonElement | null;
        if (exportSingleBtn) {
            const mid = exportSingleBtn.dataset.id;
            const found = cachedVocabList.find((v) => v.movieId === mid);
            if (found) {
                if (found.words.length === 0) {
                    showToast('No vocabulary items in this episode to export.');
                    return;
                }
                const session = VocabCurationSession.fromSingleEpisode(found, {
                    intent: 'csv',
                    onUpdate: () => loadVocabBank(),
                    onExportCsv: (curatedWords) => {
                        exportVocabCsv(found, curatedWords);
                    },
                    onExportAnki: (curatedWords) => {
                        const items = collectCuratedAnkiItems(
                            curatedWords,
                            found.showTitle,
                            found.movieId,
                        );
                        ankiModal.show(items, getVocabLanguage());
                    },
                });
                vocabEditorModal.open(session);
            }
            return;
        }

        // Export Single Episode to Anki
        const ankiSingleBtn = target?.closest(
            '.btn-anki-single-vocab',
        ) as HTMLButtonElement | null;
        if (ankiSingleBtn) {
            const mid = ankiSingleBtn.dataset.id;
            const found = cachedVocabList.find((v) => v.movieId === mid);
            if (found) {
                if (found.words.length === 0) {
                    showToast('No vocabulary items in this episode to export.');
                    return;
                }
                const session = VocabCurationSession.fromSingleEpisode(found, {
                    intent: 'anki',
                    onUpdate: () => loadVocabBank(),
                    onExportCsv: (curatedWords) => {
                        exportVocabCsv(found, curatedWords);
                    },
                    onExportAnki: (curatedWords) => {
                        const items = collectCuratedAnkiItems(
                            curatedWords,
                            found.showTitle,
                            found.movieId,
                        );
                        ankiModal.show(items, getVocabLanguage());
                    },
                });
                vocabEditorModal.open(session);
            }
            return;
        }

        // Preview Vocab Modal (Review & in-place curation editor)
        const viewBtn = target?.closest(
            '.btn-preview-vocab',
        ) as HTMLButtonElement | null;
        if (viewBtn) {
            const mid = viewBtn.dataset.id;
            const found = cachedVocabList.find((v) => v.movieId === mid);
            if (found) openVocabPreviewModal(found);
            return;
        }

        // Delete Episode Vocab
        const deleteBtn = target?.closest(
            '.btn-delete-vocab',
        ) as HTMLButtonElement | null;
        if (deleteBtn) {
            const mid = deleteBtn.dataset.id;
            if (
                mid &&
                confirm('Delete collected vocabulary for this episode?')
            ) {
                messageService.resetVocabData(mid).then(() => {
                    selectedVocabEpisodeIds.delete(mid);
                    showToast('Episode vocabulary deleted');
                    loadVocabBank();
                });
            }
        }
    });

    // Select All Checkbox Handler
    vocabSelectAllCheckbox?.addEventListener('change', () => {
        const isChecked = vocabSelectAllCheckbox.checked;
        const query = (vocabSearchInput?.value || '').trim().toLowerCase();
        const filtered = cachedVocabList.filter((v) => {
            if (!query) return true;
            const titleMatch =
                (v.showTitle && v.showTitle.toLowerCase().includes(query)) ||
                (v.movieId && v.movieId.toLowerCase().includes(query));
            if (titleMatch) return true;
            return v.words.some(
                (w) =>
                    (w.word && w.word.toLowerCase().includes(query)) ||
                    (w.meaning && w.meaning.toLowerCase().includes(query)),
            );
        });

        filtered.forEach((v) => {
            if (isChecked) {
                selectedVocabEpisodeIds.add(v.movieId);
            } else {
                selectedVocabEpisodeIds.delete(v.movieId);
            }
        });
        renderVocabBank();
    });

    // Export Selected Button Handler
    btnExportSelectedVocab?.addEventListener('click', () => {
        const selectedEpisodes = cachedVocabList.filter((v) =>
            selectedVocabEpisodeIds.has(v.movieId),
        );
        if (selectedEpisodes.length === 0) {
            alert('Please select at least one episode to export.');
            return;
        }
        const totalWords = selectedEpisodes.reduce(
            (acc, ep) => acc + ep.words.length,
            0,
        );
        if (totalWords === 0) {
            showToast('No vocabulary items found in selected episodes.');
            return;
        }
        const filename = `cowatcher_selected_vocab_${selectedEpisodes.length}_episodes.csv`;
        const session = VocabCurationSession.fromMultipleEpisodes(
            selectedEpisodes,
            {
                title: `Batch Export Confirmation · ${selectedEpisodes.length} Episodes`,
                intent: 'csv',
                onUpdate: () => loadVocabBank(),
                onExportCsv: (curatedWords) => {
                    exportMergedVocabCsv(
                        selectedEpisodes,
                        filename,
                        curatedWords,
                    );
                },
                onExportAnki: (curatedWords) => {
                    const items = collectCuratedAnkiItems(curatedWords);
                    ankiModal.show(items, getVocabLanguage());
                },
            },
        );
        vocabEditorModal.open(session);
    });

    // Export Selected to Anki Handler
    btnExportAnki?.addEventListener('click', () => {
        const selectedEpisodes = cachedVocabList.filter((v) =>
            selectedVocabEpisodeIds.has(v.movieId),
        );
        if (selectedEpisodes.length === 0) {
            alert('Please select at least one episode to export to Anki.');
            return;
        }
        const totalWords = selectedEpisodes.reduce(
            (acc, ep) => acc + ep.words.length,
            0,
        );
        if (totalWords === 0) {
            showToast('No vocabulary items found in selected episodes.');
            return;
        }
        const filename = `cowatcher_selected_vocab_${selectedEpisodes.length}_episodes.csv`;
        const session = VocabCurationSession.fromMultipleEpisodes(
            selectedEpisodes,
            {
                title: `Batch Anki Export Confirmation · ${selectedEpisodes.length} Episodes`,
                intent: 'anki',
                onUpdate: () => loadVocabBank(),
                onExportCsv: (curatedWords) => {
                    exportMergedVocabCsv(
                        selectedEpisodes,
                        filename,
                        curatedWords,
                    );
                },
                onExportAnki: (curatedWords) => {
                    const items = collectCuratedAnkiItems(curatedWords);
                    ankiModal.show(items, getVocabLanguage());
                },
            },
        );
        vocabEditorModal.open(session);
    });

    const btnImportExternal = document.getElementById(
        'btn-import-external-csv',
    ) as HTMLButtonElement | null;
    const externalFileInput = document.getElementById(
        'external-csv-file-input',
    ) as HTMLInputElement | null;

    btnImportExternal?.addEventListener('click', () => {
        if (externalFileInput) {
            externalFileInput.value = '';
            externalFileInput.click();
        }
    });

    externalFileInput?.addEventListener('change', async (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (!files || files.length === 0) return;
        const file = files[0];
        try {
            const text = await file.text();
            const srcLang = getVocabLanguage();
            const parsed = parseVocabCsv(text, {
                sourceLang: srcLang,
                defaultShowTitle: file.name.replace(/\.[^/.]+$/, ''),
            });

            if (!parsed.success || parsed.words.length === 0) {
                showToast(`❌ ${parsed.error || 'Import failed'}`);
                return;
            }

            const session = VocabCurationSession.fromImportedCsv(
                parsed.words,
                {
                    title: `Imported CSV: ${file.name}`,
                    sourceLang: srcLang,
                    intent: 'review',
                    onExportAnki: (curatedWords) => {
                        const items = collectCuratedAnkiItems(
                            curatedWords,
                            file.name,
                        );
                        ankiModal.show(items, srcLang);
                    },
                },
            );

            vocabEditorModal.open(session);
            showToast(
                `🎉 Successfully imported ${parsed.words.length} vocabulary items! (Fields other than word can be left blank; use [✨ Auto Enrich All] to enrich)`,
            );
        } catch {
            showToast('❌ Failed to read CSV file');
        }
    });

    btnExportUserVocab?.addEventListener('click', () => {
        const userWordsExist = cachedVocabList.some((ep) =>
            ep.words.some((w) => w.source === 'user'),
        );
        if (!userWordsExist) {
            showToast('No user-marked vocabulary found to export.');
            return;
        }
        const session = VocabCurationSession.fromUserMarked(cachedVocabList, {
            intent: 'csv',
            onUpdate: () => loadVocabBank(),
            onExportCsv: (curatedWords) => {
                exportUserMarkedVocabCsv(cachedVocabList, curatedWords);
            },
            onExportAnki: (curatedWords) => {
                const items = collectCuratedAnkiItems(curatedWords);
                ankiModal.show(items, getVocabLanguage());
            },
        });
        vocabEditorModal.open(session);
    });

    vocabSourceFilter?.addEventListener('change', () => {
        renderVocabBank();
    });

    btnClearAllVocab?.addEventListener('click', async () => {
        if (confirm('⚠️ Clear ALL collected vocabulary across all episodes?')) {
            const all = await storage.get<Record<string, unknown>>(null);
            const toRemove = Object.keys(all || {}).filter((k) =>
                k.startsWith('ncw_vocab_'),
            );
            if (toRemove.length > 0) {
                await storage.remove(toRemove);
                selectedVocabEpisodeIds.clear();
                showToast('All vocabulary cleared');
                loadVocabBank();
            }
        }
    });

    btnRefreshVocab?.addEventListener('click', loadVocabBank);
    vocabSearchInput?.addEventListener('input', renderVocabBank);

    // Vocab Modal Preview & Curation Editor
    function openVocabPreviewModal(data: EpisodeVocabData): void {
        const session = VocabCurationSession.fromSingleEpisode(data, {
            intent: 'review',
            onUpdate: () => loadVocabBank(),
            onExportCsv: (curatedWords) => {
                exportVocabCsv(data, curatedWords);
            },
            onExportAnki: (curatedWords) => {
                const items = collectCuratedAnkiItems(
                    curatedWords,
                    data.showTitle,
                    data.movieId,
                );
                ankiModal.show(items, getVocabLanguage());
            },
        });
        vocabEditorModal.open(session);
    }

    function getVocabLanguage(): string {
        const src = currentSettings.vocabSourceLanguage;
        if (src && src !== 'auto') {
            const resolved = Language.resolve(src);
            if (resolved) return resolved.code;
        }
        return 'ja_JP';
    }

    function collectCuratedAnkiItems(
        words: CuratedVocabWord[],
        defaultShowTitle?: string,
        defaultMovieId?: string,
    ): VocabExportItem[] {
        return words.map((w) => ({
            word: w,
            episodeInfo: {
                showTitle: w.originShowTitle || defaultShowTitle,
                movieId: w.originEpisodeId || defaultMovieId,
            },
        }));
    }

    function formatMergedMeaning(w: {
        dictMeaning?: string;
        meaning?: string;
    }): string {
        const dictM = (w.dictMeaning || '').trim();
        const ctxM = (w.meaning || '').trim();
        if (dictM && ctxM && dictM !== ctxM) {
            return `${dictM} (Context: ${ctxM})`;
        }
        return dictM || ctxM || '';
    }

    function resolveTtsAudioTag(
        word: string,
        lang?: string,
        precomputed?: string,
    ): string {
        if (precomputed !== undefined && precomputed !== '') return precomputed;
        const isTtsEnabled =
            localStorage.getItem('ncw_anki_tts_master') !== 'false';
        if (!isTtsEnabled) return '';
        const mode = localStorage.getItem('ncw_anki_tts_mode') || 'edge';
        if (mode === 'awesome') return '';
        const cleanWord = (word || '').trim();
        if (!cleanWord) return '';
        const cleanLang = (lang || 'ja').trim();
        if (mode === 'native') {
            return `[tts:${cleanLang}]${cleanWord}[/tts]`;
        }
        if (mode === 'edge') {
            return TtsAudioService.getAudioUrl(cleanWord, cleanLang);
        }
        return '';
    }

    function exportUserMarkedVocabCsv(
        episodes: EpisodeVocabData[],
        wordsOverride?: CuratedVocabWord[],
    ): void {
        if (!episodes || episodes.length === 0) {
            showToast('No vocabulary data available to export.');
            return;
        }

        const headers = [
            'Word',
            'POS',
            'Phonetic',
            'Contextual Meaning',
            'Example Sentence',
            'Sentence Translation',
            'Audio / TTS',
            'Timestamp',
            'Episode ID',
            'Show Title',
            'Date Added',
        ];

        const escapeCsv = (str: string | number): string => {
            const s = String(str || '');
            return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : `"${s}"`;
        };

        const rows: string[][] = [];
        if (wordsOverride) {
            wordsOverride.forEach((w) => {
                const dateStr = w.createdAt
                    ? new Date(w.createdAt).toLocaleString()
                    : '';
                const wordLang =
                    w.sourceLang ||
                    (episodes[0] && episodes[0].sourceLanguage) ||
                    'ja';
                rows.push([
                    escapeCsv(w.word || ''),
                    escapeCsv(w.pos || ''),
                    escapeCsv(w.phonetic || ''),
                    escapeCsv(formatMergedMeaning(w)),
                    escapeCsv(w.sentence || ''),
                    escapeCsv(w.sentenceTranslation || ''),
                    escapeCsv(
                        resolveTtsAudioTag(
                            w.word,
                            wordLang,
                            (w as CuratedVocabWord).audio,
                        ),
                    ),
                    escapeCsv(
                            typeof w.timestamp === 'number'
                            ? `${Math.floor(w.timestamp / 60)}:${String(Math.floor(w.timestamp % 60)).padStart(2, '0')}`
                            : '',
                    ),
                    escapeCsv(w.originEpisodeId || ''),
                    escapeCsv(w.originShowTitle || ''),
                    escapeCsv(dateStr),
                ]);
            });
        } else {
            episodes.forEach((ep) => {
                const epTitle = ep.showTitle || '';
                const epMid = ep.movieId || '';
                ep.words.forEach((w) => {
                    if (w.source === 'user') {
                        const dateStr = w.createdAt
                            ? new Date(w.createdAt).toLocaleString()
                            : '';
                        rows.push([
                            escapeCsv(w.word || ''),
                            escapeCsv(w.pos || ''),
                            escapeCsv(w.phonetic || ''),
                            escapeCsv(formatMergedMeaning(w)),
                            escapeCsv(w.sentence || ''),
                            escapeCsv(w.sentenceTranslation || ''),
                            escapeCsv(
                                resolveTtsAudioTag(
                                    w.word,
                                    ep.sourceLanguage || 'ja',
                                ),
                            ),
                            escapeCsv(
                                typeof w.timestamp === 'number'
                                    ? `${Math.floor(w.timestamp / 60)}:${String(Math.floor(w.timestamp % 60)).padStart(2, '0')}`
                                    : '',
                            ),
                            escapeCsv(epMid),
                            escapeCsv(epTitle),
                            escapeCsv(dateStr),
                        ]);
                    }
                });
            });
        }

        if (rows.length === 0) {
            showToast('No user-marked vocabulary found to export.');
            return;
        }

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

        const a = document.createElement('a');
        a.href = url;
        a.download = `user_marked_vocabulary_${rows.length}_words.csv`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 500);

        showToast(`Exported ${rows.length} user-marked vocabulary words!`);
    }

    function exportMergedVocabCsv(
        episodes: EpisodeVocabData[],
        filename: string,
        wordsOverride?: CuratedVocabWord[],
    ): void {
        if (!episodes || episodes.length === 0) return;
        const headers = [
            'Word',
            'Source',
            'POS',
            'Phonetic',
            'Contextual Meaning',
            'Original Sentence',
            'Sentence Translation',
            'Audio / TTS',
            'Timestamp',
            'Frequency',
            'Episode ID',
            'Show Title',
        ];

        const escapeCsv = (str: string | number): string => {
            const s = String(str || '');
            return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : `"${s}"`;
        };

        const rows: string[][] = [];
        if (wordsOverride) {
            wordsOverride.forEach((w) => {
                rows.push([
                    escapeCsv(w.word || ''),
                    escapeCsv(
                        w.source === 'user' ? 'User Marked' : 'AI Extracted',
                    ),
                    escapeCsv(w.pos || ''),
                    escapeCsv(w.phonetic || ''),
                    escapeCsv(formatMergedMeaning(w)),
                    escapeCsv(w.sentence || ''),
                    escapeCsv(w.sentenceTranslation || ''),
                    escapeCsv(
                        resolveTtsAudioTag(
                            w.word,
                            w.sourceLang ||
                                (episodes[0] && episodes[0].sourceLanguage) ||
                                'ja',
                            (w as CuratedVocabWord).audio,
                        ),
                    ),
                    escapeCsv(
                        typeof w.timestamp === 'number'
                            ? `${Math.floor(w.timestamp / 60)}:${String(Math.floor(w.timestamp % 60)).padStart(2, '0')}`
                            : '',
                    ),
                    escapeCsv(w.frequency || 1),
                    escapeCsv(w.originEpisodeId || ''),
                    escapeCsv(w.originShowTitle || ''),
                ]);
            });
        } else {
            episodes.forEach((ep) => {
                const epTitle = ep.showTitle || '';
                const epMid = ep.movieId || '';
                ep.words.forEach((w) => {
                    rows.push([
                        escapeCsv(w.word || ''),
                        escapeCsv(
                            w.source === 'user' ? 'User Marked' : 'AI Extracted',
                        ),
                        escapeCsv(w.pos || ''),
                        escapeCsv(w.phonetic || ''),
                        escapeCsv(formatMergedMeaning(w)),
                        escapeCsv(w.sentence || ''),
                        escapeCsv(w.sentenceTranslation || ''),
                        escapeCsv(
                            resolveTtsAudioTag(
                                w.word,
                                ep.sourceLanguage || 'ja',
                            ),
                        ),
                        escapeCsv(
                            typeof w.timestamp === 'number'
                                ? `${Math.floor(w.timestamp / 60)}:${String(Math.floor(w.timestamp % 60)).padStart(2, '0')}`
                                : '',
                        ),
                        escapeCsv(w.frequency || 1),
                        escapeCsv(epMid),
                        escapeCsv(epTitle),
                    ]);
                });
            });
        }

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

    function exportVocabCsv(
        data: EpisodeVocabData,
        wordsOverride?: VocabWordItem[],
    ): void {
        const words = wordsOverride || data?.words;
        if (!data || !Array.isArray(words) || words.length === 0)
            return;

        const srcLang = data.sourceLanguage || 'Source';
        const tgtLang = data.targetLanguage || 'Target';

        const headers = [
            `Word (${srcLang})`,
            'Source',
            'POS',
            'Phonetic',
            `Contextual Meaning (${tgtLang})`,
            `Original Sentence (${srcLang})`,
            `Sentence Translation (${tgtLang})`,
            'Timestamp',
            'Frequency',
        ];

        const escapeCsv = (str: string | number): string => {
            const s = String(str || '');
            return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : `"${s}"`;
        };

        const rows = words.map((w) => [
            escapeCsv(w.word || ''),
            escapeCsv(w.source === 'user' ? 'User Marked' : 'AI Extracted'),
            escapeCsv(w.pos || ''),
            escapeCsv(w.phonetic || ''),
            escapeCsv(formatMergedMeaning(w)),
            escapeCsv(w.sentence || ''),
            escapeCsv(w.sentenceTranslation || ''),
            escapeCsv(
                typeof w.timestamp === 'number'
                    ? `${Math.floor(w.timestamp / 60)}:${String(Math.floor(w.timestamp % 60)).padStart(2, '0')}`
                    : '',
            ),
            escapeCsv(w.frequency || 1),
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

        const rawTitle = data.showTitle || `episode_${data.movieId}`;
        const cleanTitle = rawTitle
            .replace(/[^\w\s\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af-]/g, '')
            .trim()
            .replace(/\s+/g, '_');
        const filename = `${cleanTitle}_${data.movieId}_vocab.csv`;

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

    // ==========================================
    // TAB 3: SHOW CONTEXT & MEMORY CONTROLLER
    // ==========================================
    async function loadShowContexts(): Promise<void> {
        const all = await storage.get<Record<string, unknown>>(null);
        cachedContextList = [];
        if (all) {
            for (const [key, val] of Object.entries(all)) {
                // Only load show-level memory from ncw_show_ keys
                if (key.startsWith('ncw_show_') && val) {
                    const dto = val as unknown as ContextDTO;
                    const langCode = (
                        Language.resolve(dto.targetLanguage)?.code || 'en'
                    ).toLowerCase();
                    const showIdentifier = (
                        dto.showId ||
                        dto.mainTitle ||
                        dto.title ||
                        ''
                    )
                        .trim()
                        .toLowerCase();
                    if (!showIdentifier) continue;

                    const existingIndex = cachedContextList.findIndex((c) => {
                        const cLangCode = (
                            Language.resolve(c.targetLanguage)?.code || 'en'
                        ).toLowerCase();
                        if (cLangCode !== langCode) return false;
                        if (dto.showId && c.showId)
                            return c.showId === dto.showId;
                        const cShowIdentifier = (
                            c.showId ||
                            c.mainTitle ||
                            c.title ||
                            ''
                        )
                            .trim()
                            .toLowerCase();
                        return cShowIdentifier === showIdentifier;
                    });

                    if (existingIndex >= 0) {
                        if (
                            (dto.updatedAt || 0) >
                            (cachedContextList[existingIndex].updatedAt || 0)
                        ) {
                            cachedContextList[existingIndex] = {
                                ...dto,
                                storageKey: key,
                            };
                        }
                    } else {
                        cachedContextList.push({ ...dto, storageKey: key });
                    }
                }
            }
        }
        cachedContextList.sort(
            (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
        );
        renderShowContexts();
    }

    function renderShowContexts(): void {
        const query = (contextSearchInput?.value || '').trim().toLowerCase();
        const filtered = cachedContextList.filter((c) => {
            if (!query) return true;
            const titleMatch =
                (c.title && c.title.toLowerCase().includes(query)) ||
                (c.mainTitle && c.mainTitle.toLowerCase().includes(query));
            if (titleMatch) return true;
            const charMatch = Object.keys(c.characters || {}).some((k) =>
                k.toLowerCase().includes(query),
            );
            const termMatch = Object.keys(c.terms || {}).some((k) =>
                k.toLowerCase().includes(query),
            );
            return charMatch || termMatch;
        });

        const totalShows = cachedContextList.length;
        let totalChars = 0;
        let totalTerms = 0;
        cachedContextList.forEach((c) => {
            totalChars += Object.keys(c.characters || {}).length;
            totalTerms += Object.keys(c.terms || {}).length;
        });

        if (statContextShows) statContextShows.textContent = String(totalShows);
        if (statContextChars) statContextChars.textContent = String(totalChars);
        if (statContextTerms) statContextTerms.textContent = String(totalTerms);
        if (navContextCount) navContextCount.textContent = String(totalShows);
        if (contextListCount)
            contextListCount.textContent = `Showing ${filtered.length} of ${totalShows} shows`;

        if (!contextCardsGrid) return;

        if (filtered.length === 0) {
            contextCardsGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #888;">
          ${cachedContextList.length === 0 ? 'No show context memory initialized yet. The supervisor model will automatically identify shows and character glossaries during playback.' : 'No matching show memory found.'}
        </div>
      `;
            return;
        }

        contextCardsGrid.innerHTML = filtered
            .map((c) => {
                const titleStr = escapeHtml(
                    c.mainTitle || c.title || 'Unknown Show',
                );
                const charEntries = Object.entries(c.characters || {});
                const termEntries = Object.entries(c.terms || {});
                const synopsisStr = c.showSynopsis
                    ? `<p style="font-size: 12px; color: #aaa; margin-bottom: 8px;">${escapeHtml(c.showSynopsis.slice(0, 140))}${c.showSynopsis.length > 140 ? '...' : ''}</p>`
                    : '';

                const charTags = charEntries
                    .slice(0, 8)
                    .map(([name, val]) => {
                        const trans =
                            typeof val === 'string'
                                ? val
                                : val?.canonical || name;
                        return `<span class="term-tag"><strong>${escapeHtml(name)}</strong>: ${escapeHtml(trans)}</span>`;
                    })
                    .join('');

                const termTags = termEntries
                    .slice(0, 6)
                    .map(([term, trans]) => {
                        return `<span class="term-tag" style="background:#1e293b;">${escapeHtml(term)} ➔ ${escapeHtml(trans)}</span>`;
                    })
                    .join('');

                const langDisplay = escapeHtml(
                    typeof c.targetLanguage === 'object'
                        ? c.targetLanguage?.label ||
                              c.targetLanguage?.name ||
                              'English'
                        : c.targetLanguage || 'English',
                );
                const resolvedLangCode =
                    Language.resolve(c.targetLanguage)?.code || 'en';

                return `
          <div class="card-item">
            <div>
              <div class="card-item-header">
                <div>
                  <div class="card-item-title">${titleStr}</div>
                  <div class="card-item-id">Lang: ${langDisplay}</div>
                </div>
                <span class="badge ${c.known ? 'badge-green' : 'badge-neutral'}">${c.known ? 'IDENTIFIED' : 'PENDING'}</span>
              </div>

              ${synopsisStr}

              <div class="card-item-body">
                <div style="font-size: 11px; color:#888; margin-bottom: 4px;">Characters & Aliases (${charEntries.length}):</div>
                <div class="tags-cloud">${charTags || '<span style="color:#666; font-size: 11px;">None discovered yet</span>'}</div>

                ${
                    termEntries.length > 0
                        ? `
                  <div style="font-size: 11px; color:#888; margin-top: 10px; margin-bottom: 4px;">Glossary Terms (${termEntries.length}):</div>
                  <div class="tags-cloud">${termTags}</div>
                `
                        : ''
                }
              </div>
            </div>

            <div class="card-item-footer">
              <span style="font-size: 11px; color:#777;">${formatRelativeTime(c.updatedAt)}</span>
              <div style="display: flex; gap: 8px;">
                <button class="btn-primary btn-sm btn-open-glossary-editor"
                  data-showid="${escapeHtml(c.showId || '')}"
                  data-title="${escapeHtml(c.mainTitle || c.title || '')}"
                  data-lang="${escapeHtml(resolvedLangCode)}">
                  ✏️ Open Glossary Editor
                </button>
                <button class="btn-danger btn-sm btn-delete-context"
                  data-key="${escapeHtml(c.storageKey)}"
                  data-showid="${escapeHtml(c.showId || '')}"
                  data-lang="${escapeHtml(resolvedLangCode)}">
                  🗑️
                </button>
              </div>
            </div>
          </div>
        `;
            })
            .join('');
    }

    // Handle Context Actions (Open Glossary Editor & Delete)
    contextCardsGrid?.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement | null;

        // Handle Open Standalone Glossary Editor
        const editorBtn = target?.closest(
            '.btn-open-glossary-editor',
        ) as HTMLButtonElement | null;
        if (editorBtn) {
            const showId = editorBtn.dataset.showid || '';
            const title = editorBtn.dataset.title || '';
            const langCode = editorBtn.dataset.lang || 'en';

            const params = new URLSearchParams();
            if (showId) params.set('showId', showId);
            if (title) params.set('title', title);
            if (langCode) params.set('targetLang', langCode);
            if (currentSettings.uiLanguage)
                params.set('uiLang', currentSettings.uiLanguage);

            const pathWithQuery = `editor/editor.html?${params.toString()}`;
            const platform = BrowserPlatformFactory.getPlatform();
            const editorUrl = platform.getURL(pathWithQuery);

            try {
                platform.openPopupWindow({
                    url: editorUrl,
                    width: 780,
                    height: 820,
                    title: 'CoWatcher - Glossary Editor',
                });
            } catch {
                window.open(editorUrl, '_blank', 'width=780,height=820');
            }
            return;
        }

        // Handle Context Delete
        const btn = target?.closest(
            '.btn-delete-context',
        ) as HTMLButtonElement | null;
        if (!btn) return;
        const key = btn.dataset.key;
        if (!key) return;

        if (
            confirm(
                'Are you sure you want to clear memory for this show? The supervisor will rebuild character context on next playback.',
            )
        ) {
            await storage.remove([key]);
            const showId = btn.dataset.showid;
            const langCode = btn.dataset.lang;
            if (showId && langCode) {
                messageService
                    .resetGlossaryContext(showId, Language.resolve(langCode))
                    .catch(() => {});
            }
            showToast('Show context memory cleared');
            loadShowContexts();
        }
    });

    btnClearAllContext?.addEventListener('click', async () => {
        if (confirm('⚠️ Clear ALL show context and supervisor memories?')) {
            const all = await storage.get<Record<string, unknown>>(null);
            const toRemove = Object.keys(all || {}).filter((k) =>
                k.startsWith('ncw_show_'),
            );
            if (toRemove.length > 0) {
                await storage.remove(toRemove);
                showToast('All show context memory cleared');
                loadShowContexts();
            }
        }
    });

    btnRefreshContext?.addEventListener('click', loadShowContexts);
    contextSearchInput?.addEventListener('input', renderShowContexts);

    // ==========================================
    // TAB 4: WATCH HISTORY & ANALYTICS CONTROLLER
    // ==========================================
    let cachedHistoryShows: ShowWatchSummary[] = [];
    let cachedHistorySessions: WatchSession[] = [];
    let cachedHistoryStats: WatchHistoryStats | null = null;
    const expandedHistoryShows = new Set<string>();

    function formatHoursMinutes(totalSeconds: number): string {
        const s = Math.max(0, Math.floor(totalSeconds));
        const hours = Math.floor(s / 3600);
        const minutes = Math.floor((s % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    function formatDurationDetailed(seconds: number): string {
        const s = Math.max(0, Math.floor(seconds));
        const m = Math.floor(s / 60);
        const remS = s % 60;
        if (m >= 60) {
            const h = Math.floor(m / 60);
            const remM = m % 60;
            return `${h}h ${remM}m ${remS}s`;
        }
        if (m > 0) {
            return `${m}m ${remS}s`;
        }
        return `${remS}s`;
    }

    async function loadWatchHistory(): Promise<void> {
        try {
            const res = await messageService.getWatchHistory();
            if (res && res.success) {
                cachedHistoryShows = res.shows || [];
                cachedHistorySessions = res.recentSessions || [];
                cachedHistoryStats = res.stats || null;
            } else {
                cachedHistoryShows = [];
                cachedHistorySessions = [];
                cachedHistoryStats = null;
            }
            renderWatchHistory();
        } catch (e) {
            logger.warn('options', 'Failed loading watch history:', e);
        }
    }

    function renderWatchHistory(): void {
        const stats = cachedHistoryStats || {
            totalWatchSeconds: 0,
            totalShows: 0,
            totalEpisodes: 0,
            totalSessions: 0,
            dailyStats: [],
        };

        if (statHistoryTime) {
            statHistoryTime.textContent = formatHoursMinutes(
                stats.totalWatchSeconds,
            );
        }
        if (statHistoryShows) {
            statHistoryShows.textContent = String(stats.totalShows);
        }
        if (statHistoryEpisodes) {
            statHistoryEpisodes.textContent = String(stats.totalEpisodes);
        }
        if (statHistorySessions) {
            statHistorySessions.textContent = String(stats.totalSessions);
        }
        if (navHistoryCount) {
            navHistoryCount.textContent = String(stats.totalShows);
        }

        renderImmersionHeatmap(stats.dailyStats);
        renderTrendCanvas(stats.dailyStats);
        renderHistoryShowsList();
    }

    function renderImmersionHeatmap(dailyStats: DailyWatchStat[]): void {
        if (!historyHeatmapContainer) return;

        const statsMap = new Map<string, { seconds: number; count: number }>();
        dailyStats.forEach((d) => {
            statsMap.set(d.date, {
                seconds: d.watchSeconds,
                count: d.sessionsCount,
            });
        });

        const now = new Date();
        const todayDayOfWeek = now.getDay(); // 0 (Sun) .. 6 (Sat)
        const totalWeeks = 26;
        const startDate = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - ((totalWeeks - 1) * 7 + todayDayOfWeek),
        );

        let weeksHtml = '';
        const nowTime = now.getTime();

        for (let w = 0; w < totalWeeks; w++) {
            let daysHtml = '';
            for (let d = 0; d < 7; d++) {
                const cellDate = new Date(
                    startDate.getFullYear(),
                    startDate.getMonth(),
                    startDate.getDate() + (w * 7 + d),
                );
                const isFuture = cellDate.getTime() > nowTime;
                const year = cellDate.getFullYear();
                const month = String(cellDate.getMonth() + 1).padStart(2, '0');
                const day = String(cellDate.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;

                if (isFuture) {
                    daysHtml +=
                        '<div class="heatmap-cell" style="opacity: 0.15; cursor: default;"></div>';
                } else {
                    const entry = statsMap.get(dateStr);
                    const seconds = entry ? entry.seconds : 0;
                    const count = entry ? entry.count : 0;

                    let level = 0;
                    if (seconds > 5400)
                        level = 4; // > 90m
                    else if (seconds > 2700)
                        level = 3; // 45m - 90m
                    else if (seconds > 900)
                        level = 2; // 15m - 45m
                    else if (seconds > 0) level = 1; // 1s - 15m

                    daysHtml += `<div class="heatmap-cell level-${level}" data-date="${dateStr}" data-seconds="${seconds}" data-sessions="${count}"></div>`;
                }
            }
            weeksHtml += `<div class="heatmap-week-col">${daysHtml}</div>`;
        }

        historyHeatmapContainer.innerHTML = `
      <div class="heatmap-wrapper">
        <div class="heatmap-calendar-body">
          <div class="heatmap-day-labels">
            <div class="heatmap-day-label"></div>
            <div class="heatmap-day-label">Mon</div>
            <div class="heatmap-day-label"></div>
            <div class="heatmap-day-label">Wed</div>
            <div class="heatmap-day-label"></div>
            <div class="heatmap-day-label">Fri</div>
            <div class="heatmap-day-label"></div>
          </div>
          <div class="heatmap-weeks-container">
            ${weeksHtml}
          </div>
        </div>
      </div>
    `;
    }

    function renderTrendCanvas(dailyStats: DailyWatchStat[]): void {
        if (!historyTrendCanvas) return;
        const canvas = historyTrendCanvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Handle high DPI cleanly
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const width = rect.width || 360;
        const height = 130;
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        ctx.clearRect(0, 0, width, height);

        const statsMap = new Map<string, number>();
        dailyStats.forEach((d) => {
            statsMap.set(d.date, d.watchSeconds);
        });

        const now = new Date();
        const daysData: Array<{
            dateStr: string;
            label: string;
            minutes: number;
            isToday: boolean;
        }> = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() - i,
            );
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            const sec = statsMap.get(dateStr) || 0;
            daysData.push({
                dateStr,
                label: `${d.getMonth() + 1}/${d.getDate()}`,
                minutes: Math.round(sec / 60),
                isToday: i === 0,
            });
        }

        const paddingLeft = 14;
        const paddingRight = 14;
        const paddingTop = 22;
        const paddingBottom = 22;
        const chartWidth = width - paddingLeft - paddingRight;
        const chartHeight = height - paddingTop - paddingBottom;

        const maxMinutes = Math.max(30, ...daysData.map((d) => d.minutes));

        // Horizontal grid line at 50%
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(paddingLeft, paddingTop + chartHeight * 0.5);
        ctx.lineTo(paddingLeft + chartWidth, paddingTop + chartHeight * 0.5);
        ctx.stroke();

        // Baseline
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        ctx.moveTo(paddingLeft, paddingTop + chartHeight);
        ctx.lineTo(paddingLeft + chartWidth, paddingTop + chartHeight);
        ctx.stroke();

        const barSlotWidth = chartWidth / daysData.length;
        const barWidth = Math.max(6, Math.min(16, barSlotWidth * 0.62));

        daysData.forEach((d, idx) => {
            const xCenter = paddingLeft + idx * barSlotWidth + barSlotWidth / 2;
            const x = xCenter - barWidth / 2;
            const barHeight =
                d.minutes > 0
                    ? Math.max(3, (d.minutes / maxMinutes) * chartHeight)
                    : 2;
            const y = paddingTop + chartHeight - barHeight;

            if (d.minutes > 0) {
                // Red Netflix gradient
                const grad = ctx.createLinearGradient(x, y, x, y + barHeight);
                grad.addColorStop(0, '#e50914');
                grad.addColorStop(1, '#831843');
                ctx.fillStyle = grad;

                // Rounded top rect
                const radius = Math.min(3, barWidth / 2);
                ctx.beginPath();
                ctx.moveTo(x, y + barHeight);
                ctx.lineTo(x, y + radius);
                ctx.quadraticCurveTo(x, y, x + radius, y);
                ctx.lineTo(x + barWidth - radius, y);
                ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
                ctx.lineTo(x + barWidth, y + barHeight);
                ctx.closePath();
                ctx.fill();

                // Minutes text above bar
                ctx.fillStyle = d.isToday ? '#ffffff' : '#d1d5db';
                ctx.font =
                    '600 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`${d.minutes}m`, xCenter, y - 4);
            } else {
                ctx.fillStyle = '#26262d';
                ctx.fillRect(x, paddingTop + chartHeight - 2, barWidth, 2);
            }

            // Day label below baseline
            ctx.fillStyle = d.isToday ? '#e50914' : '#6b7280';
            ctx.font = d.isToday
                ? '700 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
                : '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(d.label, xCenter, paddingTop + chartHeight + 14);
        });
    }

    function renderHistoryShowsList(): void {
        const query = (historySearchInput?.value || '').trim().toLowerCase();
        const platformFilter = historyPlatformFilter?.value || 'all';

        const filtered = cachedHistoryShows.filter((s) => {
            if (
                platformFilter !== 'all' &&
                s.platform.toLowerCase() !== platformFilter
            ) {
                return false;
            }
            if (!query) return true;
            const matchTitle = (s.showTitle || '')
                .toLowerCase()
                .includes(query);
            const matchId = (s.showId || '').toLowerCase().includes(query);
            const matchPlatform = (s.platform || '')
                .toLowerCase()
                .includes(query);
            const matchEp = s.lastEpisode?.episodeTitle
                ?.toLowerCase()
                .includes(query);
            return matchTitle || matchId || matchPlatform || matchEp;
        });

        if (historyListCount) {
            historyListCount.textContent = `Showing ${filtered.length} of ${cachedHistoryShows.length} shows`;
        }

        if (!historyCardsGrid) return;

        if (filtered.length === 0) {
            historyCardsGrid.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 40px; color: #888;">
          ${cachedHistoryShows.length === 0 ? 'No viewing history recorded yet. Watch any video on Netflix, YouTube, or TVer to start tracking playback immersion.' : 'No matching shows found.'}
        </div>
      `;
            return;
        }

        historyCardsGrid.innerHTML = filtered
            .map((show) => {
                const isExpanded = expandedHistoryShows.has(show.showId);
                const platformClass = (
                    show.platform || 'unknown'
                ).toLowerCase();
                const showSessions = cachedHistorySessions
                    .filter((sess) => sess.showId === show.showId)
                    .sort((a, b) => b.startedAt - a.startedAt);

                // Group sessions by episode/video
                const epGroupsMap = new Map<
                    string,
                    {
                        epKey: string;
                        seasonNum?: number;
                        episodeNum?: number;
                        episodeTitle?: string;
                        videoId: string;
                        totalSeconds: number;
                        sessions: WatchSession[];
                    }
                >();

                showSessions.forEach((sess) => {
                    const epKey =
                        sess.videoId ||
                        `${sess.seasonNum || 1}_${sess.episodeNum || 1}`;
                    let ep = epGroupsMap.get(epKey);
                    if (!ep) {
                        ep = {
                            epKey,
                            seasonNum: sess.seasonNum,
                            episodeNum: sess.episodeNum,
                            episodeTitle: sess.episodeTitle,
                            videoId: sess.videoId,
                            totalSeconds: 0,
                            sessions: [],
                        };
                        epGroupsMap.set(epKey, ep);
                    }
                    ep.totalSeconds += sess.effectiveWatchSeconds;
                    ep.sessions.push(sess);
                });

                const epGroups = Array.from(epGroupsMap.values());

                const episodesHtml = epGroups
                    .map((ep) => {
                        const epLabel =
                            ep.seasonNum !== undefined &&
                            ep.episodeNum !== undefined
                                ? `S${ep.seasonNum}:E${ep.episodeNum}`
                                : ep.episodeNum !== undefined
                                  ? `E${ep.episodeNum}`
                                  : '';
                        const epFullTitle = [
                            epLabel,
                            ep.episodeTitle || ep.videoId,
                        ]
                            .filter(Boolean)
                            .join(' - ');

                        const sessionItemsHtml = ep.sessions
                            .map((sess) => {
                                const startStr = formatSecondsToTime(
                                    sess.fromContentTime,
                                );
                                const endStr = formatSecondsToTime(
                                    sess.toContentTime,
                                );
                                const durationStr = formatDurationDetailed(
                                    sess.effectiveWatchSeconds,
                                );
                                const dateStr = new Date(
                                    sess.startedAt,
                                ).toLocaleString();

                                return `
                  <div class="history-session-item">
                    <div>
                      <span class="history-session-interval">⏱️ ${startStr} ➔ ${endStr}</span>
                      <span class="history-session-duration">(${durationStr})</span>
                    </div>
                    <span class="history-session-date">${dateStr}</span>
                  </div>
                `;
                            })
                            .join('');

                        return `
              <div class="history-ep-row">
                <div class="history-ep-header">
                  <span class="history-ep-title">${escapeHtml(epFullTitle)}</span>
                  <span class="history-ep-time">${formatHoursMinutes(ep.totalSeconds)}</span>
                </div>
                <div class="history-session-logs">
                  ${sessionItemsHtml}
                </div>
              </div>
            `;
                    })
                    .join('');

                return `
          <div class="history-show-card ${isExpanded ? 'expanded' : ''}" data-show-id="${escapeHtml(show.showId)}">
            <div class="history-show-header" data-show-id="${escapeHtml(show.showId)}">
              <div class="history-show-left">
                <span class="history-show-toggle">
                  <span class="toggle-icon ${isExpanded ? 'expanded' : ''}">▶</span>
                  <span class="platform-badge ${platformClass}">${escapeHtml(show.platform)}</span>
                  <span class="history-show-title">${escapeHtml(show.showTitle || show.showId)}</span>
                </span>
                <div class="history-show-meta">
                  <span>📺 ${show.episodesCount} ep</span>
                  <span>🔄 ${show.sessionsCount} sessions</span>
                  <span style="color: var(--accent-green); font-weight: 600;">⏱️ ${formatHoursMinutes(show.totalWatchSeconds)}</span>
                  <span>🕒 Last: ${formatRelativeTime(show.lastWatchedAt)}</span>
                </div>
              </div>
              <div class="history-show-right">
                <button class="btn-sm btn-danger btn-delete-show" data-show-id="${escapeHtml(show.showId)}" data-title="${escapeHtml(show.showTitle)}" title="Delete this show history">
                  🗑️
                </button>
              </div>
            </div>
            ${isExpanded ? `<div class="history-episodes-list">${episodesHtml || '<div style="font-size: 12px; color: #777;">No session intervals recorded.</div>'}</div>` : ''}
          </div>
        `;
            })
            .join('');
    }

    // Heatmap Tooltip Interactions
    historyHeatmapContainer?.addEventListener('mouseover', (e) => {
        const target = (e.target as HTMLElement)?.closest(
            '.heatmap-cell',
        ) as HTMLElement | null;
        if (!target || !heatmapTooltip) return;
        const date = target.dataset.date;
        const seconds = parseInt(target.dataset.seconds || '0', 10);
        const count = parseInt(target.dataset.sessions || '0', 10);
        if (date) {
            const formatted = formatHoursMinutes(seconds);
            const dateFormatted = new Date(
                date + 'T00:00:00',
            ).toLocaleDateString(undefined, {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
            });
            heatmapTooltip.innerHTML = `<span style="color: #fff; font-weight: 600;">${dateFormatted}</span>: ${formatted === '0m' && seconds === 0 ? 'No viewing activity' : `<strong>${formatted}</strong> watched (${count} sessions)`}`;
        }
    });

    historyHeatmapContainer?.addEventListener('mouseleave', () => {
        if (heatmapTooltip) {
            heatmapTooltip.textContent =
                'Hover over a day to view watch details.';
        }
    });

    // History Show Card Actions (Accordion & Delete Show)
    historyCardsGrid?.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement | null;

        // Delete Show
        const deleteBtn = target?.closest(
            '.btn-delete-show',
        ) as HTMLButtonElement | null;
        if (deleteBtn) {
            const showId =
                deleteBtn.dataset.showId ||
                deleteBtn.getAttribute('data-show-id');
            const title = deleteBtn.dataset.title || showId || 'this show';
            if (!showId) return;
            if (
                confirm(
                    `Are you sure you want to delete all viewing history for "${title}"?`,
                )
            ) {
                await messageService.deleteShowHistory(showId);
                showToast('Show viewing history deleted');
                loadWatchHistory();
            }
            return;
        }

        // Toggle Card Accordion
        const header = target?.closest(
            '.history-show-header',
        ) as HTMLElement | null;
        if (header) {
            const showId =
                header.dataset.showId || header.getAttribute('data-show-id');
            if (showId) {
                if (expandedHistoryShows.has(showId)) {
                    expandedHistoryShows.delete(showId);
                } else {
                    expandedHistoryShows.add(showId);
                }
                renderHistoryShowsList();
            }
        }
    });

    // Filter & Search
    historySearchInput?.addEventListener('input', () =>
        renderHistoryShowsList(),
    );
    historyPlatformFilter?.addEventListener('change', () =>
        renderHistoryShowsList(),
    );

    // Window resize to redraw trend chart
    window.addEventListener('resize', () => {
        if (cachedHistoryStats) {
            renderTrendCanvas(cachedHistoryStats.dailyStats);
        }
    });

    // Buttons
    btnRefreshHistory?.addEventListener('click', async () => {
        btnRefreshHistory.textContent = '🔄 Refreshing...';
        await loadWatchHistory();
        btnRefreshHistory.textContent = '🔄 Refresh';
        showToast('Viewing history refreshed');
    });

    btnClearAllHistory?.addEventListener('click', async () => {
        if (
            confirm(
                '⚠️ Are you sure you want to permanently clear ALL watch history logs? This action cannot be undone.',
            )
        ) {
            await messageService.clearWatchHistory();
            showToast('All watch history logs cleared');
            loadWatchHistory();
        }
    });

    btnExportHistoryCsv?.addEventListener('click', () => {
        if (cachedHistorySessions.length === 0) {
            showToast('No viewing sessions to export.');
            return;
        }
        const headers = [
            'Session ID',
            'Platform',
            'Show ID',
            'Show Title',
            'Season',
            'Episode',
            'Episode Title',
            'Video ID',
            'Started At (ISO)',
            'Ended At (ISO)',
            'From Content Time (s)',
            'From Timecode',
            'To Content Time (s)',
            'To Timecode',
            'Video Duration (s)',
            'Effective Watch Time (s)',
            'Effective Watch Time (min)',
        ];

        const rows = cachedHistorySessions.map((s) => [
            s.id,
            s.platform,
            s.showId,
            s.showTitle,
            s.seasonNum ?? '',
            s.episodeNum ?? '',
            s.episodeTitle ?? '',
            s.videoId,
            new Date(s.startedAt).toISOString(),
            new Date(s.endedAt).toISOString(),
            s.fromContentTime,
            formatSecondsToTime(s.fromContentTime),
            s.toContentTime,
            formatSecondsToTime(s.toContentTime),
            s.videoDuration,
            s.effectiveWatchSeconds,
            (s.effectiveWatchSeconds / 60).toFixed(1),
        ]);

        const csvContent =
            '\uFEFF' +
            [headers, ...rows]
                .map((row) =>
                    row
                        .map((cell) => {
                            const val = String(cell ?? '');
                            if (
                                val.includes(',') ||
                                val.includes('"') ||
                                val.includes('\n')
                            ) {
                                return `"${val.replace(/"/g, '""')}"`;
                            }
                            return val;
                        })
                        .join(','),
                )
                .join('\n');

        const blob = new Blob([csvContent], {
            type: 'text/csv;charset=utf-8;',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = `cowatcher-viewing-history-${dateStr}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(
            `Exported ${cachedHistorySessions.length} viewing sessions to CSV!`,
        );
    });

    // ==========================================
    // TAB 5: SETTINGS CONTROLLER
    // ==========================================
    async function loadSettings(): Promise<void> {
        const res = await storage.get<Record<string, unknown>>([
            NCW_CONSTANTS.STORAGE_KEYS.SETTINGS,
        ]);
        if (res && res[NCW_CONSTANTS.STORAGE_KEYS.SETTINGS]) {
            currentSettings = {
                ...NCW_CONSTANTS.DEFAULT_SETTINGS,
                ...(res[
                    NCW_CONSTANTS.STORAGE_KEYS.SETTINGS
                ] as Partial<ExtensionSettings>),
            };
        }
        syncSettingsUI();
    }

    function syncSettingsUI(): void {
        if (cfgAiProvider)
            cfgAiProvider.value = currentSettings.aiProvider || 'google';
        toggleProviderVisibility(currentSettings.aiProvider || 'google');

        if (cfgOllamaHost)
            cfgOllamaHost.value =
                currentSettings.ollamaHost || 'http://localhost:11434';
        if (cfgTranslationModel)
            cfgTranslationModel.value =
                currentSettings.translationModel || 'translategemma:4b';
        if (cfgSupervisorModel)
            cfgSupervisorModel.value =
                currentSettings.supervisorModel || 'translategemma:4b';

        refreshVaultStatus().catch(() => {});
        if (cfgEnableSupervisor)
            cfgEnableSupervisor.checked =
                currentSettings.enableSupervisor !== false;
        if (cfgTargetLang) {
            cfgTargetLang.innerHTML = Language.getAll()
                .map((l) => `<option value="${l.code}">${l.label}</option>`)
                .join('');
            const currentLang = Language.resolve(
                currentSettings.targetLanguage,
            );
            cfgTargetLang.value = currentLang.code;
        }
        if (cfgDisplayMode)
            cfgDisplayMode.value = currentSettings.displayMode || 'bilingual';
        if (cfgPreferNativeSubtitles)
            cfgPreferNativeSubtitles.checked =
                currentSettings.preferNativeSubtitles !== false;
        if (cfgExtractNativeTerms)
            cfgExtractNativeTerms.checked = Boolean(
                currentSettings.extractTermsFromNativeSubtitles,
            );
        if (cfgHideNative)
            cfgHideNative.checked =
                currentSettings.hideNativeSubtitles !== false;
        if (cfgEnableDomSync)
            cfgEnableDomSync.checked = Boolean(
                currentSettings.enableDomSubtitleSync,
            );
        if (cfgEnableLearning)
            cfgEnableLearning.checked = Boolean(
                currentSettings.enableSubtitleLearning,
            );
        if (cfgAutoPauseLearning)
            cfgAutoPauseLearning.checked =
                currentSettings.autoPauseOnTokenClick !== false;
        if (cfgChinesePhoneticSystem)
            cfgChinesePhoneticSystem.value =
                currentSettings.chinesePhoneticSystem || 'pinyin';
        if (cfgKoreanPhoneticSystem)
            cfgKoreanPhoneticSystem.value =
                currentSettings.koreanPhoneticSystem || 'default';

        if (cfgVocabEnabled)
            cfgVocabEnabled.checked = Boolean(
                currentSettings.vocabExtractorEnabled,
            );
        if (cfgRecordVocabAsLemma)
            cfgRecordVocabAsLemma.checked =
                currentSettings.recordVocabAsLemma !== false;
        if (cfgVocabProvider) {
            cfgVocabProvider.value =
                currentSettings.vocabExtractorProvider || 'openrouter';
            updateVocabProviderVisibility(cfgVocabProvider.value);
        }
        if (cfgVocabDifficulty)
            cfgVocabDifficulty.value =
                currentSettings.vocabExtractorDifficulty || 'medium';
        if (cfgVocabSourceLang) {
            const currentSrc = currentSettings.vocabSourceLanguage || 'auto';
            cfgVocabSourceLang.innerHTML = [
                '<option value="auto">✨ Auto Detect</option>',
                ...Language.getAll().map(
                    (l) => `<option value="${l.code}">${l.label}</option>`,
                ),
            ].join('');
            const matched = Language.get(currentSrc);
            cfgVocabSourceLang.value = matched
                ? matched.code
                : currentSrc === 'auto'
                  ? 'auto'
                  : Language.resolve(currentSrc).code;
        }
        if (cfgVocabCustomPrompt)
            cfgVocabCustomPrompt.value =
                currentSettings.vocabExtractorCustomPrompt || '';
        if (uiLanguageSelect)
            uiLanguageSelect.value = currentSettings.uiLanguage || 'en';
        if (cacheRetentionSelect)
            cacheRetentionSelect.value = currentSettings.cacheRetention || '1m';
        if (cfgCacheRetention)
            cfgCacheRetention.value = currentSettings.cacheRetention || '1m';

        // Static friction
        if (cfgFrictionEnabled) {
            cfgFrictionEnabled.checked = Boolean(
                currentSettings.staticFrictionEnabled,
            );
            if (cfgFrictionDetailGroup) {
                cfgFrictionDetailGroup.style.display = cfgFrictionEnabled.checked
                    ? 'flex'
                    : 'none';
            }
        }
        if (cfgFrictionInterval) {
            cfgFrictionInterval.value = String(
                currentSettings.frictionIntervalMinutes || 45,
            );
        }
        if (cfgFrictionDailyLimit) {
            cfgFrictionDailyLimit.value = String(
                currentSettings.frictionDailyLimitMinutes !== undefined
                    ? currentSettings.frictionDailyLimitMinutes
                    : 180,
            );
        }
        if (cfgFrictionCurfewEnabled) {
            cfgFrictionCurfewEnabled.checked = Boolean(
                currentSettings.frictionCurfewEnabled,
            );
            if (cfgFrictionCurfewTimeGroup) {
                cfgFrictionCurfewTimeGroup.style.display =
                    cfgFrictionCurfewEnabled.checked ? 'block' : 'none';
            }
        }
        if (cfgFrictionCurfewTime) {
            cfgFrictionCurfewTime.value =
                currentSettings.frictionCurfewTime || '23:30';
        }
        if (cfgFrictionScreenType) {
            cfgFrictionScreenType.value =
                currentSettings.frictionScreenType || 'screensaver';
        }
        if (cfgFrictionBreakDuration) {
            cfgFrictionBreakDuration.value = String(
                currentSettings.frictionBreakDurationSeconds || 20,
            );
        }
        if (cfgFrictionAutoResume) {
            cfgFrictionAutoResume.checked =
                currentSettings.frictionAutoResumeOnTimer !== false;
        }
        if (cfgFrictionUnlockDiff) {
            cfgFrictionUnlockDiff.value =
                currentSettings.frictionUnlockDifficulty || 'none';
        }
        if (cfgFrictionLlmAdvice) {
            cfgFrictionLlmAdvice.checked =
                currentSettings.frictionEnableLlmAdvice !== false;
        }
        const excludedSet = new Set(
            currentSettings.frictionExcludedPlatforms || [],
        );
        chkFrictionExcludePlatforms.forEach((chk) => {
            chk.checked = excludedSet.has(chk.value as StreamingPlatformId);
        });

        syncFrictionLockUI();
        refreshFrictionTodayStats();

        populateOpenRouterOptions();
    }

    function syncFrictionLockUI(): void {
        const now = Date.now();
        const lockUntil = currentSettings.frictionLockUntil || 0;
        const isLocked = lockUntil > now;
        const lang = currentSettings.uiLanguage || 'en';

        const hasDailyLimit =
            cfgFrictionDailyLimit && Number(cfgFrictionDailyLimit.value) > 0;
        const hasCurfew = Boolean(cfgFrictionCurfewEnabled?.checked);
        const shouldShowLockGroup = isLocked || hasDailyLimit || hasCurfew;

        if (cfgFrictionLockGroup) {
            cfgFrictionLockGroup.style.display = shouldShowLockGroup
                ? 'block'
                : 'none';
        }

        if (cfgFrictionLockPledgeDisplay) {
            cfgFrictionLockPledgeDisplay.textContent = NCW_I18N.getText(
                'frictionLockPledgeText',
                lang,
            );
        }

        if (isLocked) {
            if (cfgFrictionLockEnabled) {
                cfgFrictionLockEnabled.checked = true;
                cfgFrictionLockEnabled.disabled = true;
            }
            if (cfgFrictionLockConfirmBox) {
                cfgFrictionLockConfirmBox.style.display = 'none';
            }
            if (cfgFrictionLockStatus) {
                const remainMs = Math.max(0, lockUntil - now);
                const days = Math.floor(remainMs / (24 * 3600 * 1000));
                const hours = Math.ceil(
                    (remainMs % (24 * 3600 * 1000)) / (3600 * 1000),
                );
                const dateStr = new Date(lockUntil).toLocaleString();
                cfgFrictionLockStatus.textContent = NCW_I18N.getText(
                    'frictionLockActiveStatus',
                    lang,
                    {
                        days,
                        hours,
                        date: dateStr,
                    },
                );
                cfgFrictionLockStatus.style.display = 'block';
            }

            // Lock protected controls during the 7-day period
            if (cfgFrictionEnabled) cfgFrictionEnabled.disabled = true;
            if (cfgFrictionDailyLimit) cfgFrictionDailyLimit.disabled = true;
            if (cfgFrictionCurfewEnabled)
                cfgFrictionCurfewEnabled.disabled = true;
            if (cfgFrictionCurfewTime) cfgFrictionCurfewTime.disabled = true;
            chkFrictionExcludePlatforms.forEach((chk) => {
                chk.disabled = true;
            });
        } else {
            if (cfgFrictionLockEnabled) {
                cfgFrictionLockEnabled.disabled = false;
                if (
                    !cfgFrictionLockConfirmBox ||
                    cfgFrictionLockConfirmBox.style.display === 'none'
                ) {
                    cfgFrictionLockEnabled.checked = false;
                }
            }
            if (cfgFrictionLockStatus) {
                cfgFrictionLockStatus.style.display = 'none';
            }

            if (cfgFrictionEnabled) cfgFrictionEnabled.disabled = false;
            if (cfgFrictionDailyLimit) cfgFrictionDailyLimit.disabled = false;
            if (cfgFrictionCurfewEnabled)
                cfgFrictionCurfewEnabled.disabled = false;
            if (cfgFrictionCurfewTime) cfgFrictionCurfewTime.disabled = false;
            chkFrictionExcludePlatforms.forEach((chk) => {
                chk.disabled = false;
            });
        }
    }

    async function refreshFrictionTodayStats(): Promise<void> {
        try {
            const stats = await messageService.getTodayWatchTime();
            const restValEl = document.getElementById('friction-today-rest-val');
            const breaksValEl = document.getElementById('friction-today-breaks-val');
            if (restValEl && stats.todayRestSeconds !== undefined) {
                const mins = Math.floor(stats.todayRestSeconds / 60);
                const secs = stats.todayRestSeconds % 60;
                restValEl.textContent = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
            }
            if (breaksValEl && stats.todayBreakCount !== undefined) {
                breaksValEl.textContent = String(stats.todayBreakCount);
            }
        } catch {
            // background service unavailable or error
        }
    }

    function toggleProviderVisibility(provider: string): void {
        const isOllama = provider === 'ollama';
        const isOpenRouter = provider === 'openrouter';
        if (cfgOllamaSection)
            cfgOllamaSection.style.display = isOllama ? 'block' : 'none';
        if (cfgOpenrouterSection)
            cfgOpenrouterSection.style.display = isOpenRouter
                ? 'block'
                : 'none';
    }

    function updateVocabProviderVisibility(provider: string): void {
        const isOllama = provider === 'ollama';
        if (cfgVocabOllamaGroup)
            cfgVocabOllamaGroup.style.display = isOllama ? 'block' : 'none';
        if (cfgVocabOpenrouterGroup)
            cfgVocabOpenrouterGroup.style.display = isOllama ? 'none' : 'block';
    }

    cfgVocabProvider?.addEventListener('change', () => {
        if (cfgVocabProvider) {
            updateVocabProviderVisibility(cfgVocabProvider.value);
        }
    });

    cfgAiProvider?.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement | null;
        if (target) toggleProviderVisibility(target.value);
    });

    const RECOMMENDED_MODELS = [
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

    function populateOpenRouterOptions(): void {
        if (!cfgOpenrouterTransModel || !cfgOpenrouterSupModel) return;

        cfgOpenrouterTransModel.innerHTML = '';
        cfgOpenrouterSupModel.innerHTML = '';
        if (cfgVocabOpenrouterModel) cfgVocabOpenrouterModel.innerHTML = '';

        RECOMMENDED_MODELS.forEach((m) => {
            const opt1 = document.createElement('option');
            opt1.value = m.id;
            opt1.textContent = `${m.name} (${m.id})`;
            cfgOpenrouterTransModel?.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = m.id;
            opt2.textContent = `${m.name} (${m.id})`;
            cfgOpenrouterSupModel?.appendChild(opt2);

            if (cfgVocabOpenrouterModel) {
                const opt3 = document.createElement('option');
                opt3.value = m.id;
                opt3.textContent = `${m.name} (${m.id})`;
                cfgVocabOpenrouterModel.appendChild(opt3);
            }
        });

        if (currentSettings.openrouterTranslationModel) {
            cfgOpenrouterTransModel.value =
                currentSettings.openrouterTranslationModel;
        }
        if (currentSettings.openrouterSupervisorModel) {
            cfgOpenrouterSupModel.value =
                currentSettings.openrouterSupervisorModel;
        }
        if (currentSettings.vocabExtractorModel && cfgVocabOpenrouterModel) {
            cfgVocabOpenrouterModel.value = currentSettings.vocabExtractorModel;
        }

        if (cfgVocabOllamaModel) {
            cfgVocabOllamaModel.innerHTML = [
                'qwen2.5:7b',
                'qwen2.5:14b',
                'llama3.1:8b',
                'gemma2:9b',
            ]
                .map((m) => `<option value="${m}">${m}</option>`)
                .join('');
            if (currentSettings.vocabExtractorOllamaModel) {
                cfgVocabOllamaModel.value =
                    currentSettings.vocabExtractorOllamaModel;
            }
        }
    }

    async function refreshVaultStatus(): Promise<void> {
        try {
            const status = await messageService.getCredentialStatus();
            if (cfgOpenrouterKey) {
                if (status.hasKey) {
                    cfgOpenrouterKey.placeholder =
                        status.maskedKey || 'sk-or-••••••••';
                    if (
                        !cfgOpenrouterKey.value ||
                        cfgOpenrouterKey.value.includes('••')
                    ) {
                        cfgOpenrouterKey.value = status.maskedKey;
                    }
                    if (cfgBtnClearKey)
                        cfgBtnClearKey.style.display = 'inline-block';
                } else {
                    cfgOpenrouterKey.placeholder = 'sk-or-v1-...';
                    cfgOpenrouterKey.value = '';
                    if (cfgBtnClearKey) cfgBtnClearKey.style.display = 'none';
                }
            }

            if (cfgEnableMasterPwd) {
                cfgEnableMasterPwd.checked = status.isEncrypted;
            }

            if (status.isEncrypted) {
                if (cfgMasterPwdUnlockRow)
                    cfgMasterPwdUnlockRow.style.display = 'flex';
                if (cfgMasterPwdSetupRow)
                    cfgMasterPwdSetupRow.style.display = 'none';
                if (status.isUnlocked) {
                    if (cfgVaultBadge) {
                        cfgVaultBadge.innerHTML =
                            '<span style="color: var(--accent-green);">🔓 Unlocked (Active for session)</span>';
                    }
                    if (cfgVaultUnlockInput)
                        cfgVaultUnlockInput.style.display = 'none';
                    if (cfgBtnVaultUnlock)
                        cfgBtnVaultUnlock.style.display = 'none';
                    if (cfgBtnVaultLock)
                        cfgBtnVaultLock.style.display = 'inline-block';
                    if (cfgKeyStatusHint) {
                        cfgKeyStatusHint.textContent =
                            'API Key stored locally with AES-256 encryption.';
                    }
                } else {
                    if (cfgVaultBadge) {
                        cfgVaultBadge.innerHTML =
                            '<span style="color: var(--accent-yellow);">🔒 Locked (Master Password required)</span>';
                    }
                    if (cfgVaultUnlockInput) {
                        cfgVaultUnlockInput.style.display = 'inline-block';
                        cfgVaultUnlockInput.value = '';
                    }
                    if (cfgBtnVaultUnlock)
                        cfgBtnVaultUnlock.style.display = 'inline-block';
                    if (cfgBtnVaultLock)
                        cfgBtnVaultLock.style.display = 'none';
                    if (cfgKeyStatusHint) {
                        cfgKeyStatusHint.textContent =
                            'Key is encrypted. Please unlock to enable OpenRouter AI features.';
                    }
                }
            } else {
                if (cfgMasterPwdUnlockRow)
                    cfgMasterPwdUnlockRow.style.display = 'none';
                if (cfgMasterPwdSetupRow)
                    cfgMasterPwdSetupRow.style.display = 'none';
                if (cfgKeyStatusHint) {
                    cfgKeyStatusHint.textContent = status.hasKey
                        ? 'API Key stored in local storage (Unencrypted).'
                        : '';
                }
            }
        } catch (err) {
            logger.error(
                'options',
                'Failed to refresh credential vault status',
                err,
            );
        }
    }

    cfgOpenrouterKey?.addEventListener('focus', () => {
        if (cfgOpenrouterKey.value.includes('••')) {
            cfgOpenrouterKey.value = '';
        }
    });

    cfgOpenrouterKey?.addEventListener('blur', () => {
        if (!cfgOpenrouterKey.value.trim()) {
            refreshVaultStatus().catch(() => {});
        }
    });

    cfgBtnClearKey?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to remove the stored API key?')) {
            await messageService.clearCredentials();
            showToast('API Key removed.');
            await refreshVaultStatus();
        }
    });

    cfgEnableMasterPwd?.addEventListener('change', async () => {
        const isChecked = cfgEnableMasterPwd.checked;
        if (isChecked) {
            if (cfgMasterPwdSetupRow) {
                cfgMasterPwdSetupRow.style.display = 'block';
                if (cfgMasterPwdInput) cfgMasterPwdInput.focus();
            }
            if (cfgMasterPwdMsg) cfgMasterPwdMsg.textContent = '';
        } else {
            const pwd = prompt(
                'Enter your current Master Password to disable encryption:',
            );
            if (!pwd) {
                cfgEnableMasterPwd.checked = true;
                return;
            }
            const res =
                await messageService.disableCredentialEncryption(pwd);
            if (res.success) {
                showToast('Master password protection disabled.');
                await refreshVaultStatus();
            } else {
                alert('Incorrect master password. Encryption remains active.');
                cfgEnableMasterPwd.checked = true;
            }
        }
    });

    cfgBtnSaveMasterPwd?.addEventListener('click', async () => {
        const p1 = cfgMasterPwdInput?.value || '';
        const p2 = cfgMasterPwdConfirm?.value || '';
        if (p1.length < 4) {
            if (cfgMasterPwdMsg) {
                cfgMasterPwdMsg.style.color = 'var(--accent-red)';
                cfgMasterPwdMsg.textContent =
                    'Password must be at least 4 characters.';
            }
            return;
        }
        if (p1 !== p2) {
            if (cfgMasterPwdMsg) {
                cfgMasterPwdMsg.style.color = 'var(--accent-red)';
                cfgMasterPwdMsg.textContent = 'Passwords do not match.';
            }
            return;
        }

        const rawKey = cfgOpenrouterKey?.value.trim() || '';
        const keyToSave = rawKey && !rawKey.includes('••') ? rawKey : undefined;

        const res = await messageService.saveCredentials({
            apiKey: keyToSave,
            masterPassword: p1,
            enableEncryption: true,
        });

        if (res.success) {
            showToast('Master Password set and key encrypted with AES-256!');
            if (cfgMasterPwdInput) cfgMasterPwdInput.value = '';
            if (cfgMasterPwdConfirm) cfgMasterPwdConfirm.value = '';
            await refreshVaultStatus();
        } else {
            if (cfgMasterPwdMsg) {
                cfgMasterPwdMsg.style.color = 'var(--accent-red)';
                cfgMasterPwdMsg.textContent =
                    res.error || 'Failed to save credentials.';
            }
        }
    });

    cfgBtnVaultUnlock?.addEventListener('click', async () => {
        const pwd = cfgVaultUnlockInput?.value || '';
        if (!pwd) return;
        const res = await messageService.unlockCredentials(pwd);
        if (res.success) {
            showToast('Vault unlocked successfully!');
            await refreshVaultStatus();
        } else {
            alert('Incorrect master password.');
        }
    });

    cfgVaultUnlockInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            cfgBtnVaultUnlock?.click();
        }
    });

    cfgBtnVaultLock?.addEventListener('click', async () => {
        await messageService.lockCredentials();
        showToast('Vault locked.');
        await refreshVaultStatus();
    });

    btnSaveSettings?.addEventListener('click', async () => {
        const rawKey = cfgOpenrouterKey?.value.trim() || '';
        if (rawKey && !rawKey.includes('••')) {
            await messageService.saveCredentials({
                apiKey: rawKey,
            });
        }

        const updated: ExtensionSettings = {
            ...currentSettings,
            aiProvider: (cfgAiProvider
                ? cfgAiProvider.value
                : currentSettings.aiProvider) as TranslationProvider,
            ollamaHost: cfgOllamaHost
                ? cfgOllamaHost.value.trim()
                : currentSettings.ollamaHost,
            translationModel: cfgTranslationModel
                ? cfgTranslationModel.value
                : currentSettings.translationModel,
            supervisorModel: cfgSupervisorModel
                ? cfgSupervisorModel.value
                : currentSettings.supervisorModel,
            openrouterTranslationModel: cfgOpenrouterTransModel
                ? cfgOpenrouterTransModel.value
                : currentSettings.openrouterTranslationModel,
            openrouterSupervisorModel: cfgOpenrouterSupModel
                ? cfgOpenrouterSupModel.value
                : currentSettings.openrouterSupervisorModel,
            enableSupervisor: cfgEnableSupervisor
                ? cfgEnableSupervisor.checked
                : currentSettings.enableSupervisor,
            targetLanguage: cfgTargetLang
                ? Language.resolve(cfgTargetLang.value)
                : currentSettings.targetLanguage,
            displayMode: (cfgDisplayMode
                ? cfgDisplayMode.value
                : currentSettings.displayMode) as
                'bilingual' | 'translated' | 'original',
            preferNativeSubtitles: cfgPreferNativeSubtitles
                ? cfgPreferNativeSubtitles.checked
                : currentSettings.preferNativeSubtitles,
            extractTermsFromNativeSubtitles: cfgExtractNativeTerms
                ? cfgExtractNativeTerms.checked
                : currentSettings.extractTermsFromNativeSubtitles,
            hideNativeSubtitles: cfgHideNative
                ? cfgHideNative.checked
                : currentSettings.hideNativeSubtitles,
            enableDomSubtitleSync: cfgEnableDomSync
                ? cfgEnableDomSync.checked
                : currentSettings.enableDomSubtitleSync,
            enableSubtitleLearning: cfgEnableLearning
                ? cfgEnableLearning.checked
                : currentSettings.enableSubtitleLearning,
            autoPauseOnTokenClick: cfgAutoPauseLearning
                ? cfgAutoPauseLearning.checked
                : currentSettings.autoPauseOnTokenClick,
            chinesePhoneticSystem: cfgChinesePhoneticSystem
                ? (cfgChinesePhoneticSystem.value as 'pinyin' | 'zhuyin')
                : currentSettings.chinesePhoneticSystem || 'pinyin',
            koreanPhoneticSystem: cfgKoreanPhoneticSystem
                ? (cfgKoreanPhoneticSystem.value as 'default' | 'hyphenated')
                : currentSettings.koreanPhoneticSystem || 'default',
            vocabExtractorEnabled: cfgVocabEnabled
                ? cfgVocabEnabled.checked
                : currentSettings.vocabExtractorEnabled,
            recordVocabAsLemma: cfgRecordVocabAsLemma
                ? cfgRecordVocabAsLemma.checked
                : currentSettings.recordVocabAsLemma !== false,
            vocabExtractorProvider: (cfgVocabProvider
                ? cfgVocabProvider.value
                : currentSettings.vocabExtractorProvider) as
                'ollama' | 'openrouter',
            vocabExtractorModel: cfgVocabOpenrouterModel
                ? cfgVocabOpenrouterModel.value
                : currentSettings.vocabExtractorModel,
            vocabExtractorOllamaModel: cfgVocabOllamaModel
                ? cfgVocabOllamaModel.value
                : currentSettings.vocabExtractorOllamaModel,
            vocabExtractorDifficulty: (cfgVocabDifficulty
                ? cfgVocabDifficulty.value
                : currentSettings.vocabExtractorDifficulty) as
                'easy' | 'medium' | 'hard',
            vocabSourceLanguage: cfgVocabSourceLang
                ? cfgVocabSourceLang.value === 'auto'
                    ? 'auto'
                    : Language.resolve(cfgVocabSourceLang.value)
                : currentSettings.vocabSourceLanguage,
            vocabExtractorCustomPrompt: cfgVocabCustomPrompt
                ? cfgVocabCustomPrompt.value.trim()
                : currentSettings.vocabExtractorCustomPrompt,
            uiLanguage: (uiLanguageSelect
                ? uiLanguageSelect.value
                : currentSettings.uiLanguage) as 'en' | 'zh',
            cacheRetention: (cfgCacheRetention
                ? cfgCacheRetention.value
                : cacheRetentionSelect
                  ? cacheRetentionSelect.value
                  : currentSettings.cacheRetention || '1m') as
                | '1w'
                | '1m'
                | '1y',
            staticFrictionEnabled:
                (currentSettings.frictionLockUntil || 0) > Date.now()
                    ? true
                    : cfgFrictionEnabled
                      ? cfgFrictionEnabled.checked
                      : Boolean(currentSettings.staticFrictionEnabled),
            frictionIntervalMinutes:
                cfgFrictionInterval && !isNaN(Number(cfgFrictionInterval.value))
                    ? Number(cfgFrictionInterval.value)
                    : currentSettings.frictionIntervalMinutes || 45,
            frictionDailyLimitMinutes:
                (currentSettings.frictionLockUntil || 0) > Date.now()
                    ? currentSettings.frictionDailyLimitMinutes || 0
                    : cfgFrictionDailyLimit && !isNaN(Number(cfgFrictionDailyLimit.value))
                      ? Number(cfgFrictionDailyLimit.value)
                      : currentSettings.frictionDailyLimitMinutes || 0,
            frictionCurfewEnabled:
                (currentSettings.frictionLockUntil || 0) > Date.now()
                    ? Boolean(currentSettings.frictionCurfewEnabled)
                    : cfgFrictionCurfewEnabled
                      ? cfgFrictionCurfewEnabled.checked
                      : Boolean(currentSettings.frictionCurfewEnabled),
            frictionCurfewTime:
                (currentSettings.frictionLockUntil || 0) > Date.now()
                    ? currentSettings.frictionCurfewTime || '23:30'
                    : cfgFrictionCurfewTime
                      ? cfgFrictionCurfewTime.value || '23:30'
                      : currentSettings.frictionCurfewTime,
            frictionScreenType: (cfgFrictionScreenType
                ? cfgFrictionScreenType.value
                : currentSettings.frictionScreenType || 'screensaver') as FrictionScreenType,
            frictionBreakDurationSeconds: cfgFrictionBreakDuration
                ? Number(cfgFrictionBreakDuration.value) || 20
                : currentSettings.frictionBreakDurationSeconds || 20,
            frictionUnlockDifficulty: (cfgFrictionUnlockDiff
                ? cfgFrictionUnlockDiff.value
                : currentSettings.frictionUnlockDifficulty || 'none') as FrictionUnlockDifficulty,
            frictionAutoResumeOnTimer: cfgFrictionAutoResume
                ? cfgFrictionAutoResume.checked
                : currentSettings.frictionAutoResumeOnTimer !== false,
            frictionEnableLlmAdvice: cfgFrictionLlmAdvice
                ? cfgFrictionLlmAdvice.checked
                : currentSettings.frictionEnableLlmAdvice !== false,
            frictionExcludedPlatforms:
                (currentSettings.frictionLockUntil || 0) > Date.now()
                    ? currentSettings.frictionExcludedPlatforms || []
                    : Array.from(chkFrictionExcludePlatforms)
                          .filter((c) => c.checked)
                          .map((c) => c.value as StreamingPlatformId),
            frictionPlatformRules: currentSettings.frictionPlatformRules || {},
            frictionLockUntil: currentSettings.frictionLockUntil || 0,
        };

        currentSettings = updated;
        delete (updated as Partial<ExtensionSettings>).openrouterApiKey;
        await storage.set({
            [NCW_CONSTANTS.STORAGE_KEYS.SETTINGS]: updated,
        });
        await messageService.saveSettings(updated);
        await cacheRepository.cleanExpiredRecords(updated.cacheRetention);
        showToast('Settings saved successfully!');
        loadSubtitleCaches();
        await refreshVaultStatus();
    });

    async function saveFrictionSettingsOnly(
        showFeedback = true,
        activatingLockUntil?: number,
    ): Promise<void> {
        const isLocked =
            !activatingLockUntil &&
            (currentSettings.frictionLockUntil || 0) > Date.now();
        const effectiveLockUntil =
            activatingLockUntil || currentSettings.frictionLockUntil || 0;
        const updatedFriction = {
            staticFrictionEnabled: isLocked
                ? true
                : cfgFrictionEnabled
                  ? cfgFrictionEnabled.checked
                  : Boolean(currentSettings.staticFrictionEnabled),
            frictionIntervalMinutes:
                cfgFrictionInterval && !isNaN(Number(cfgFrictionInterval.value))
                    ? Number(cfgFrictionInterval.value)
                    : currentSettings.frictionIntervalMinutes || 45,
            frictionDailyLimitMinutes: isLocked
                ? currentSettings.frictionDailyLimitMinutes || 0
                : cfgFrictionDailyLimit && !isNaN(Number(cfgFrictionDailyLimit.value))
                  ? Number(cfgFrictionDailyLimit.value)
                  : currentSettings.frictionDailyLimitMinutes || 0,
            frictionCurfewEnabled: isLocked
                ? Boolean(currentSettings.frictionCurfewEnabled)
                : cfgFrictionCurfewEnabled
                  ? cfgFrictionCurfewEnabled.checked
                  : Boolean(currentSettings.frictionCurfewEnabled),
            frictionCurfewTime: isLocked
                ? currentSettings.frictionCurfewTime || '23:30'
                : cfgFrictionCurfewTime
                  ? cfgFrictionCurfewTime.value || '23:30'
                  : currentSettings.frictionCurfewTime,
            frictionScreenType: (cfgFrictionScreenType
                ? cfgFrictionScreenType.value
                : currentSettings.frictionScreenType || 'screensaver') as FrictionScreenType,
            frictionBreakDurationSeconds: cfgFrictionBreakDuration
                ? Number(cfgFrictionBreakDuration.value) || 20
                : currentSettings.frictionBreakDurationSeconds || 20,
            frictionUnlockDifficulty: (cfgFrictionUnlockDiff
                ? cfgFrictionUnlockDiff.value
                : currentSettings.frictionUnlockDifficulty || 'none') as FrictionUnlockDifficulty,
            frictionAutoResumeOnTimer: cfgFrictionAutoResume
                ? cfgFrictionAutoResume.checked
                : currentSettings.frictionAutoResumeOnTimer !== false,
            frictionEnableLlmAdvice: cfgFrictionLlmAdvice
                ? cfgFrictionLlmAdvice.checked
                : currentSettings.frictionEnableLlmAdvice !== false,
            frictionExcludedPlatforms: isLocked
                ? currentSettings.frictionExcludedPlatforms || []
                : Array.from(chkFrictionExcludePlatforms)
                      .filter((c) => c.checked)
                      .map((c) => c.value as StreamingPlatformId),
            frictionPlatformRules: currentSettings.frictionPlatformRules || {},
            frictionLockUntil: effectiveLockUntil,
        };

        currentSettings = { ...currentSettings, ...updatedFriction };
        await messageService.saveSettings(updatedFriction);
        await storage.set({
            [NCW_CONSTANTS.STORAGE_KEYS.SETTINGS]: currentSettings,
        });
        syncFrictionLockUI();
        if (showFeedback) {
            showToast('Mindful Viewing settings saved!');
        }
    }

    document.getElementById('btn-save-friction-settings')?.addEventListener('click', () => {
        saveFrictionSettingsOnly(true);
    });

    cfgFrictionEnabled?.addEventListener('change', () => {
        if (cfgFrictionDetailGroup) {
            cfgFrictionDetailGroup.style.display = cfgFrictionEnabled.checked
                ? 'flex'
                : 'none';
        }
        saveFrictionSettingsOnly(true);
    });

    cfgFrictionInterval?.addEventListener('change', () => {
        saveFrictionSettingsOnly(true);
    });

    cfgFrictionDailyLimit?.addEventListener('change', () => {
        syncFrictionLockUI();
        saveFrictionSettingsOnly(true);
    });
    cfgFrictionDailyLimit?.addEventListener('input', () => {
        syncFrictionLockUI();
        saveFrictionSettingsOnly(false);
    });

    cfgFrictionCurfewEnabled?.addEventListener('change', () => {
        if (cfgFrictionCurfewTimeGroup) {
            cfgFrictionCurfewTimeGroup.style.display =
                cfgFrictionCurfewEnabled.checked ? 'block' : 'none';
        }
        syncFrictionLockUI();
        saveFrictionSettingsOnly(true);
    });

    cfgFrictionCurfewTime?.addEventListener('change', () => {
        saveFrictionSettingsOnly(true);
    });
    cfgFrictionCurfewTime?.addEventListener('input', () => {
        saveFrictionSettingsOnly(false);
    });

    cfgFrictionScreenType?.addEventListener('change', () => {
        saveFrictionSettingsOnly(true);
    });

    cfgFrictionBreakDuration?.addEventListener('change', () => {
        saveFrictionSettingsOnly(true);
    });

    cfgFrictionAutoResume?.addEventListener('change', () => {
        saveFrictionSettingsOnly(true);
    });

    cfgFrictionUnlockDiff?.addEventListener('change', () => {
        saveFrictionSettingsOnly(true);
    });

    cfgFrictionLlmAdvice?.addEventListener('change', () => {
        saveFrictionSettingsOnly(true);
    });

    chkFrictionExcludePlatforms.forEach((chk) => {
        chk.addEventListener('change', () => {
            saveFrictionSettingsOnly(true);
        });
    });

    // Prevent selection/copy on pledge box and paste/middle-click on pledge input
    ['selectstart', 'copy', 'cut', 'contextmenu', 'dragstart'].forEach(
        (evtName) => {
            cfgFrictionLockConfirmBox?.addEventListener(evtName, (e) => {
                e.preventDefault();
            });
            cfgFrictionLockPledgeDisplay?.addEventListener(evtName, (e) => {
                e.preventDefault();
            });
        },
    );

    ['paste', 'drop', 'contextmenu'].forEach((evtName) => {
        cfgFrictionLockInput?.addEventListener(evtName, (e) => {
            e.preventDefault();
        });
    });

    // Block Linux X11/Wayland middle-button primary selection paste
    ['mousedown', 'mouseup', 'auxclick'].forEach((evtName) => {
        cfgFrictionLockInput?.addEventListener(evtName, (e) => {
            if ((e as MouseEvent).button === 1) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    });

    cfgFrictionLockEnabled?.addEventListener('change', () => {
        const isLocked =
            (currentSettings.frictionLockUntil || 0) > Date.now();
        if (isLocked) {
            cfgFrictionLockEnabled.checked = true;
            return;
        }
        if (cfgFrictionLockEnabled.checked) {
            if (cfgFrictionLockConfirmBox) {
                cfgFrictionLockConfirmBox.style.display = 'block';
            }
            if (cfgFrictionLockError) {
                cfgFrictionLockError.style.display = 'none';
            }
            if (cfgFrictionLockInput) {
                cfgFrictionLockInput.value = '';
                cfgFrictionLockInput.focus();
            }
        } else {
            if (cfgFrictionLockConfirmBox) {
                cfgFrictionLockConfirmBox.style.display = 'none';
            }
            if (cfgFrictionLockError) {
                cfgFrictionLockError.style.display = 'none';
            }
        }
    });

    btnFrictionLockCancel?.addEventListener('click', () => {
        if (cfgFrictionLockConfirmBox) {
            cfgFrictionLockConfirmBox.style.display = 'none';
        }
        if (cfgFrictionLockError) {
            cfgFrictionLockError.style.display = 'none';
        }
        if (cfgFrictionLockInput) {
            cfgFrictionLockInput.value = '';
        }
        if (cfgFrictionLockEnabled) {
            cfgFrictionLockEnabled.checked = false;
        }
    });

    btnFrictionLockConfirm?.addEventListener('click', async () => {
        const lang = currentSettings.uiLanguage || 'en';
        const expected = NCW_I18N.getText('frictionLockPledgeText', lang).trim();
        const expectedEn = NCW_I18N.getText('frictionLockPledgeText', 'en').trim();
        const typed = (cfgFrictionLockInput?.value || '').trim();

        if (typed !== expected && typed !== expectedEn) {
            if (cfgFrictionLockError) {
                cfgFrictionLockError.textContent = NCW_I18N.getText(
                    'frictionLockMismatchError',
                    lang,
                );
                cfgFrictionLockError.style.display = 'block';
            }
            return;
        }

        if (cfgFrictionLockError) {
            cfgFrictionLockError.style.display = 'none';
        }
        if (cfgFrictionLockConfirmBox) {
            cfgFrictionLockConfirmBox.style.display = 'none';
        }
        if (cfgFrictionLockInput) {
            cfgFrictionLockInput.value = '';
        }

        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        const lockUntil = Date.now() + sevenDaysMs;
        if (cfgFrictionEnabled) {
            cfgFrictionEnabled.checked = true;
        }
        await saveFrictionSettingsOnly(false, lockUntil);
        showToast(NCW_I18N.getText('frictionLockActivatedToast', lang));
    });

    uiLanguageSelect?.addEventListener('change', async (e) => {
        const target = e.target as HTMLSelectElement | null;
        if (!target) return;
        const lang = target.value as 'en' | 'zh' | 'ja' | 'ko';
        currentSettings.uiLanguage = lang;
        applyI18n(lang);
        syncFrictionLockUI();
        await messageService.saveSettings({ uiLanguage: lang });
    });

    cfgChinesePhoneticSystem?.addEventListener('change', async (e) => {
        const target = e.target as HTMLSelectElement | null;
        if (!target) return;
        const system = (target.value as 'pinyin' | 'zhuyin') || 'pinyin';
        currentSettings.chinesePhoneticSystem = system;
        await storage.set({
            [NCW_CONSTANTS.STORAGE_KEYS.SETTINGS]: currentSettings,
        });
        showToast('Phonetic system updated!');
    });

    cfgKoreanPhoneticSystem?.addEventListener('change', async (e) => {
        const target = e.target as HTMLSelectElement | null;
        if (!target) return;
        const system =
            (target.value as 'default' | 'hyphenated') || 'default';
        currentSettings.koreanPhoneticSystem = system;
        await storage.set({
            [NCW_CONSTANTS.STORAGE_KEYS.SETTINGS]: currentSettings,
        });
        showToast('Phonetic system updated!');
    });

    // Initial Data Loads
    // Load settings and initialize UI language
    storage.get<Record<string, unknown>>(NCW_CONSTANTS.STORAGE_KEYS.SETTINGS).then((stored) => {
        if (stored && stored[NCW_CONSTANTS.STORAGE_KEYS.SETTINGS]) {
            currentSettings = {
                ...NCW_CONSTANTS.DEFAULT_SETTINGS,
                ...(stored[NCW_CONSTANTS.STORAGE_KEYS.SETTINGS] as Partial<ExtensionSettings>),
            };
        }
        if (uiLanguageSelect) {
            uiLanguageSelect.value = currentSettings.uiLanguage || 'en';
        }
        applyI18n(currentSettings.uiLanguage || 'en');
    });

    loadSubtitleCaches();
    loadVocabBank();
    loadShowContexts();
    loadWatchHistory();
    loadSettings();
});
