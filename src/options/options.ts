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
import contributorsMarkdown from '../../CONTRIBUTORS.md';
import creditsMarkdown from '../../CREDITS.md';

const logger = new Logger('options');

interface CachedContextItem extends ContextDTO {
    storageKey: string;
}

document.addEventListener('DOMContentLoaded', () => {
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
                        title: `${showTitle} · 全剧词汇导出确认 (${matchingEps.length} 集)`,
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
                        title: `${showTitle} · 全剧 Anki 导出确认 (${matchingEps.length} 集)`,
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
                title: `批量导出确认 · ${selectedEpisodes.length} 个剧集`,
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
                title: `批量导出到 Anki 确认 · ${selectedEpisodes.length} 个剧集`,
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
                showToast(`❌ ${parsed.error || '导入失败'}`);
                return;
            }

            const session = VocabCurationSession.fromImportedCsv(
                parsed.words,
                {
                    title: `外部导入词表: ${file.name}`,
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
                `🎉 成功导入 ${parsed.words.length} 个词条！（除 word 列外其余已允许留空，可点击【一键 AI 释义】补全）`,
            );
        } catch {
            showToast('❌ 读取 CSV 文件失败');
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
            return `${dictM} (语境: ${ctxM})`;
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
