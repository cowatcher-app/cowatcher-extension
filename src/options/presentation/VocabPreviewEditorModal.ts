import {
    EpisodeVocabData,
    VocabWordItem,
} from '@shared/domain/entities/Vocabulary';
import { VocabCurationService } from '../application/VocabCurationService';
import {
    VocabCurationSession,
    CuratedVocabWord,
} from '../application/VocabCurationSession';
import {
    FieldLockConfig,
    CURATION_FIELDS,
    CurationFieldKey,
} from '../application/VocabFieldLock';
import { AnkiExportModal } from '../anki/AnkiExportModal';
import { VocabExportItem } from '../anki/ankiTypes';
import { TtsAudioService } from '@shared/infrastructure/audio/TtsAudioService';
import { parseVocabCsv } from '@shared/utils/csvParser';

export class VocabPreviewEditorModal {
    private modalEl: HTMLElement | null = null;
    private session: VocabCurationSession | null = null;
    private words: CuratedVocabWord[] = [];
    private selectedIndices = new Set<number>();
    private isEnriching: boolean = false;
    private isImportedMode: boolean = false;
    private onUpdateCallback: (() => void) | null = null;
    private fieldLockConfig: FieldLockConfig = new FieldLockConfig();
    private currentAudio: HTMLAudioElement | null = null;
    private exportFields = {
        phonetic: true,
        pos: true,
        sentence: true,
        sentenceTranslation: true,
        audio: true,
    };

    private getWordsForExport(): CuratedVocabWord[] {
        const isTtsMaster =
            localStorage.getItem('ncw_anki_tts_master') !== 'false';
        const ttsMode = localStorage.getItem('ncw_anki_tts_mode') || 'edge';
        const includeAudio = this.exportFields.audio && isTtsMaster;

        return this.words.map((w) => {
            const dictM = (w.dictMeaning || '').trim();
            const ctxM = (w.meaning || '').trim();
            const combinedMeaning =
                dictM && ctxM && dictM !== ctxM
                    ? `${dictM} (语境: ${ctxM})`
                    : dictM || ctxM || '';

            let audioVal = '';
            if (includeAudio) {
                const lang = (
                    w.sourceLang ||
                    this.session?.sourceLanguage ||
                    'ja'
                ).trim();
                const word = (w.word || '').trim();
                if (ttsMode === 'native') {
                    audioVal = `[tts:${lang}]${word}[/tts]`;
                } else if (ttsMode === 'edge') {
                    audioVal = TtsAudioService.getAudioUrl(word, lang);
                }
            }

            return {
                ...w,
                meaning: combinedMeaning,
                phonetic: this.exportFields.phonetic ? w.phonetic : '',
                pos: this.exportFields.pos ? w.pos : '',
                sentence: this.exportFields.sentence ? w.sentence : '',
                sentenceTranslation: this.exportFields.sentenceTranslation
                    ? w.sentenceTranslation
                    : '',
                audio: audioVal,
            };
        });
    }

    constructor(
        private readonly curationService: VocabCurationService,
        private readonly ankiModal: AnkiExportModal,
        private readonly onToast: (msg: string) => void,
        private readonly onExportCsv?: (
            episode: EpisodeVocabData,
            words: VocabWordItem[],
        ) => void,
    ) {
        this.init();
    }

    private init(): void {
        this.modalEl = document.getElementById('vocab-preview-modal');
        if (!this.modalEl) return;

        // Close handlers
        const btnClose = document.getElementById('btn-modal-close');
        btnClose?.addEventListener('click', () => this.hide());
        this.modalEl.addEventListener('click', (e) => {
            if (e.target === this.modalEl) {
                this.hide();
            }
        });

        // Prompt Preset Chips
        const chips =
            this.modalEl.querySelectorAll<HTMLButtonElement>('.btn-chip');
        const promptInput = document.getElementById(
            'curation-custom-prompt',
        ) as HTMLTextAreaElement | null;

        chips.forEach((chip) => {
            chip.addEventListener('click', () => {
                const text = chip.dataset.prompt || '';
                if (!promptInput) return;
                const current = promptInput.value.trim();
                if (!current) {
                    promptInput.value = text;
                } else if (!current.includes(text)) {
                    promptInput.value = `${current}；${text}`;
                }
                promptInput.focus();
                this.curationService.saveCustomPrompt(promptInput.value);
            });
        });

        promptInput?.addEventListener('change', () => {
            this.curationService.saveCustomPrompt(promptInput.value);
        });

        // Config Accordion collapse state persistence
        const accordion = document.getElementById(
            'curation-config-accordion',
        ) as HTMLDetailsElement | null;
        if (accordion) {
            accordion.open =
                localStorage.getItem('ncw_curation_accordion_open') === 'true';
            accordion.addEventListener('toggle', () => {
                localStorage.setItem(
                    'ncw_curation_accordion_open',
                    String(accordion.open),
                );
            });
        }

        // Select All Handler
        const selectAllCheckbox = document.getElementById(
            'curation-select-all',
        ) as HTMLInputElement | null;
        selectAllCheckbox?.addEventListener('change', () => {
            if (selectAllCheckbox.checked) {
                this.words.forEach((_, idx) => this.selectedIndices.add(idx));
            } else {
                this.selectedIndices.clear();
            }
            this.updateSelectionUI();
            this.renderWordRows();
        });

        // Batch Delete Button
        const btnBatchDelete = document.getElementById(
            'btn-curation-batch-delete',
        );
        btnBatchDelete?.addEventListener('click', () => {
            if (this.selectedIndices.size === 0) return;
            if (
                confirm(
                    `Are you sure you want to delete ${this.selectedIndices.size} selected word(s)?`,
                )
            ) {
                this.words = this.words.filter(
                    (_, idx) => !this.selectedIndices.has(idx),
                );
                this.selectedIndices.clear();
                this.updateSelectionUI();
                this.renderWordRows();
                this.onToast('Selected words deleted from list');
            }
        });

        // Batch AI Enrich Button
        const btnEnrichAll = document.getElementById(
            'btn-curation-enrich-all',
        );
        btnEnrichAll?.addEventListener('click', async () => {
            await this.handleBatchEnrich();
        });

        // Save Changes Button
        const btnSave = document.getElementById('btn-curation-save');
        btnSave?.addEventListener('click', async () => {
            await this.handleSaveChanges(true);
        });

        // Export Auxiliary Fields Selection Checkboxes
        const chkPho = document.getElementById(
            'curation-export-pho',
        ) as HTMLInputElement | null;
        const chkPos = document.getElementById(
            'curation-export-pos',
        ) as HTMLInputElement | null;
        const chkSent = document.getElementById(
            'curation-export-sentence',
        ) as HTMLInputElement | null;
        const chkTrans = document.getElementById(
            'curation-export-translation',
        ) as HTMLInputElement | null;
        const chkAudio = document.getElementById(
            'curation-export-audio',
        ) as HTMLInputElement | null;

        chkPho?.addEventListener('change', () => {
            this.exportFields.phonetic = !!chkPho.checked;
        });
        chkPos?.addEventListener('change', () => {
            this.exportFields.pos = !!chkPos.checked;
        });
        chkSent?.addEventListener('change', () => {
            this.exportFields.sentence = !!chkSent.checked;
        });
        chkTrans?.addEventListener('change', () => {
            this.exportFields.sentenceTranslation = !!chkTrans.checked;
        });
        chkAudio?.addEventListener('change', () => {
            this.exportFields.audio = !!chkAudio.checked;
        });

        // TTS Engine & Audio Settings Handlers
        const ttsMasterCheck = document.getElementById(
            'curation-tts-master-check',
        ) as HTMLInputElement | null;
        ttsMasterCheck?.addEventListener('change', () => {
            localStorage.setItem(
                'ncw_anki_tts_master',
                String(ttsMasterCheck.checked),
            );
            this.updateTtsBarUI();
            this.renderWordRows();
        });

        const ttsModeRadios = document.querySelectorAll<HTMLInputElement>(
            'input[name="curation-tts-mode"]',
        );
        ttsModeRadios.forEach((r) => {
            r.addEventListener('change', () => {
                if (r.checked) {
                    localStorage.setItem('ncw_anki_tts_mode', r.value);
                    this.updateTtsBarUI();
                    this.renderWordRows();
                }
            });
        });

        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.onvoiceschanged = () => {
                if (this.modalEl && this.modalEl.style.display === 'flex') {
                    this.renderWordRows();
                }
            };
        }

        // Import CSV Button & Hidden File Input
        const btnImportCsv = document.getElementById('btn-curation-import-csv');
        const fileInput = document.getElementById(
            'curation-csv-file-input',
        ) as HTMLInputElement | null;

        btnImportCsv?.addEventListener('click', () => {
            if (fileInput) {
                fileInput.value = '';
                fileInput.click();
            }
        });

        fileInput?.addEventListener('change', async (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files || files.length === 0) return;
            const file = files[0];
            try {
                const text = await file.text();
                const defaultLang =
                    this.words[0]?.sourceLang ||
                    this.session?.sourceLanguage ||
                    'ja';
                const parsed = parseVocabCsv(text, {
                    sourceLang: defaultLang,
                    defaultShowTitle: file.name.replace(/\.[^/.]+$/, ''),
                });

                if (!parsed.success || parsed.words.length === 0) {
                    this.onToast(`❌ ${parsed.error || '导入失败'}`);
                    return;
                }

                if (this.words.length > 0) {
                    const doAppend = confirm(
                        `成功解析 ${parsed.words.length} 个生词！\n\n点击【确定】追加到当前列表末尾\n点击【取消】清空当前列表并替换`,
                    );
                    if (doAppend) {
                        this.words = [...this.words, ...parsed.words];
                    } else {
                        this.words = parsed.words;
                    }
                } else {
                    this.words = parsed.words;
                }

                this.setImportedMode(true);
                this.selectedIndices.clear();
                this.updateSelectionUI();
                this.renderWordRows();
                this.onToast(
                    `🎉 成功导入 ${parsed.words.length} 个生词！（非 word 列允许留空，可点击【一键 AI 释义】智能补全）`,
                );
            } catch {
                this.onToast('❌ 读取 CSV 文件失败');
            }
        });

        // Download CSV Button
        const btnDownloadCsv = document.getElementById('modal-download-btn');
        btnDownloadCsv?.addEventListener('click', async () => {
            if (!this.session || this.words.length === 0) {
                this.onToast('No vocabulary items to export');
                return;
            }
            if (!this.isImportedMode && !this.session.isImported) {
                await this.handleSaveChanges(false);
            }
            const exportWords = this.getWordsForExport();
            if (this.session.onExportCsv) {
                await this.session.onExportCsv(exportWords);
            } else if (
                this.onExportCsv &&
                this.session.primaryEpisode &&
                !this.isImportedMode &&
                !this.session.isImported
            ) {
                this.onExportCsv(this.session.primaryEpisode, exportWords);
            } else {
                this.exportDirectCsv(exportWords);
            }
            this.hide();
        });

        // Export to Anki Button
        const btnAnki = document.getElementById('modal-anki-btn');
        btnAnki?.addEventListener('click', async () => {
            if (!this.session || this.words.length === 0) {
                this.onToast('No vocabulary items to export');
                return;
            }
            if (!this.isImportedMode && !this.session.isImported) {
                await this.handleSaveChanges(false);
            }
            const exportWords = this.getWordsForExport();
            if (this.session.onExportAnki) {
                await this.session.onExportAnki(exportWords);
            } else {
                const items: VocabExportItem[] = exportWords.map((w) => ({
                    word: w,
                    episodeInfo: {
                        showTitle:
                            w.originShowTitle ||
                            this.session?.primaryEpisode?.showTitle ||
                            'Imported Vocab',
                        movieId:
                            w.originEpisodeId ||
                            this.session?.primaryEpisode?.movieId ||
                            'imported_csv',
                    },
                }));
                const lang =
                    this.words[0]?.sourceLang ||
                    this.session.primaryEpisode?.sourceLanguage ||
                    'ja_JP';
                this.ankiModal.show(items, lang);
            }
            this.hide();
        });
    }

    async open(
        sessionOrEpisode: VocabCurationSession | EpisodeVocabData,
        onUpdate?: () => void,
    ): Promise<void> {
        if (!this.modalEl) return;

        if (sessionOrEpisode instanceof VocabCurationSession) {
            this.session = sessionOrEpisode;
        } else {
            this.session = VocabCurationSession.fromSingleEpisode(
                sessionOrEpisode,
                {
                    onUpdate,
                    onExportCsv: (words) => {
                        if (this.onExportCsv) {
                            this.onExportCsv(sessionOrEpisode, words);
                        }
                    },
                },
            );
        }

        this.words = this.session.initialWords.map((w) => ({ ...w }));
        this.selectedIndices.clear();
        this.onUpdateCallback = onUpdate || null;

        if (
            this.session instanceof VocabCurationSession &&
            this.session.isImported
        ) {
            this.setImportedMode(true);
        } else {
            this.setImportedMode(false);
        }

        // Populate Titles & Language Snapshot Badge
        const titleEl = document.getElementById('modal-episode-title');
        const badgeEl = document.getElementById('modal-lang-badge');
        const subtitleEl = document.getElementById('modal-episode-subtitle');
        const promptInput = document.getElementById(
            'curation-custom-prompt',
        ) as HTMLTextAreaElement | null;

        if (titleEl) {
            titleEl.textContent = this.session.title;
        }
        if (badgeEl) {
            badgeEl.textContent = this.session.badgeText;
        }
        if (subtitleEl) {
            subtitleEl.textContent = this.session.subtitle;
        }

        // Adjust CTA button styling based on intent
        const btnDownloadCsv = document.getElementById(
            'modal-download-btn',
        ) as HTMLButtonElement | null;
        const btnAnki = document.getElementById(
            'modal-anki-btn',
        ) as HTMLButtonElement | null;

        if (this.session.intent === 'csv') {
            if (btnDownloadCsv) {
                btnDownloadCsv.className = 'btn-primary';
                btnDownloadCsv.innerHTML = '📥 确认并下载 CSV';
            }
            if (btnAnki) {
                btnAnki.className = 'btn-secondary';
                btnAnki.innerHTML = '🎴 导出到 Anki';
            }
        } else if (this.session.intent === 'anki') {
            if (btnAnki) {
                btnAnki.className = 'btn-primary btn-anki';
                btnAnki.innerHTML = '🎴 确认并导出到 Anki';
            }
            if (btnDownloadCsv) {
                btnDownloadCsv.className = 'btn-secondary';
                btnDownloadCsv.innerHTML = '📥 下载 CSV';
            }
        } else {
            // Standard review / curation intent
            if (btnDownloadCsv) {
                btnDownloadCsv.className = 'btn-secondary';
                btnDownloadCsv.innerHTML = '📥 下载 CSV';
            }
            if (btnAnki) {
                btnAnki.className = 'btn-primary btn-anki';
                btnAnki.innerHTML = '🎴 导出到 Anki';
            }
        }

        // Load saved custom prompt
        if (promptInput) {
            promptInput.value =
                (await this.curationService.getSavedCustomPrompt()) || '';
        }

        // Load saved column lock preferences
        const savedLocks = await this.curationService.getSavedFieldLocks();
        this.fieldLockConfig = FieldLockConfig.fromJSON(savedLocks);
        this.renderColumnLocks();

        this.updateSelectionUI();
        this.updateTtsBarUI();
        this.renderWordRows();

        this.modalEl.style.display = 'flex';
    }

    hide(): void {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        if (this.modalEl) {
            this.modalEl.style.display = 'none';
        }
        this.session = null;
        this.words = [];
        this.selectedIndices.clear();
        this.onUpdateCallback = null;
    }

    private renderColumnLocks(): void {
        const container = document.getElementById('curation-column-locks');
        if (!container) return;

        container.innerHTML = CURATION_FIELDS.map((f) => {
            const isLocked = this.fieldLockConfig.isLocked(f.key);
            const stateClass = isLocked ? 'locked' : 'unlocked';
            const icon = isLocked ? '🔒' : '🔓';
            const labelSuffix = isLocked ? ' (已锁)' : '';
            return `
                <button
                    type="button"
                    class="btn-field-lock ${stateClass}"
                    data-key="${f.key}"
                    title="${this.escapeHtml(f.description)} - 点击锁定/允许AI更新"
                >
                    <span>${icon}</span>
                    <span>${this.escapeHtml(f.label)}${labelSuffix}</span>
                </button>
            `;
        }).join('');

        container
            .querySelectorAll<HTMLButtonElement>('.btn-field-lock')
            .forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const key = btn.dataset.key as CurationFieldKey;
                    if (!key) return;
                    const newLocked = this.fieldLockConfig.toggle(key);
                    await this.curationService.saveFieldLocks(
                        this.fieldLockConfig.toJSON(),
                    );
                    this.renderColumnLocks();
                    this.renderWordRows();
                    const action = newLocked ? '🔒 已锁定' : '🔓 已解锁';
                    const fieldDef = CURATION_FIELDS.find((f) => f.key === key);
                    this.onToast(`${action} ${fieldDef?.label || key}`);
                });
            });
    }

    private updateSelectionUI(): void {
        const selectAllCheckbox = document.getElementById(
            'curation-select-all',
        ) as HTMLInputElement | null;
        const btnBatchDelete = document.getElementById(
            'btn-curation-batch-delete',
        ) as HTMLButtonElement | null;
        const selectedCountSpan = document.getElementById(
            'curation-selected-count',
        );
        const wordCountSpan = document.getElementById('modal-word-count');

        const total = this.words.length;
        const selCount = this.selectedIndices.size;

        if (selectAllCheckbox) {
            selectAllCheckbox.checked = total > 0 && selCount === total;
            selectAllCheckbox.indeterminate = selCount > 0 && selCount < total;
        }

        if (btnBatchDelete) {
            btnBatchDelete.disabled = selCount === 0;
        }
        if (selectedCountSpan) {
            selectedCountSpan.textContent = String(selCount);
        }
        if (wordCountSpan) {
            const userCount = this.words.filter(
                (w) => w.source === 'user',
            ).length;
            wordCountSpan.textContent = `${total} words total (${userCount} starred by user)`;
        }
    }

    private renderWordRows(): void {
        const container = document.getElementById('modal-words-list');
        if (!container) return;

        if (this.words.length === 0) {
            container.innerHTML = `
        <div style="text-align:center; padding: 40px; color:#888;">
          No words in this vocabulary session.
        </div>
      `;
            return;
        }

        const isMultiEpisode = (this.session?.episodes.length || 0) > 1;
        const isLemmaLocked = this.fieldLockConfig.isLocked('lemma');
        const isMeaningLocked = this.fieldLockConfig.isLocked('meaning');
        const isPhoLocked = this.fieldLockConfig.isLocked('phonetic');
        const isPosLocked = this.fieldLockConfig.isLocked('pos');
        const isSentenceLocked = this.fieldLockConfig.isLocked('sentence');
        const isTransLocked =
            this.fieldLockConfig.isLocked('sentenceTranslation');
        const isTtsMaster =
            localStorage.getItem('ncw_anki_tts_master') !== 'false';
        const ttsMode = localStorage.getItem('ncw_anki_tts_mode') || 'edge';

        container.innerHTML = this.words
            .map((w, idx) => {
                const isChecked = this.selectedIndices.has(idx);
                const isUser = w.source === 'user';
                const word = this.escapeHtml(w.word || '');
                const lemma = this.escapeHtml(w.lemma || '');
                const pos = this.escapeHtml(w.pos || '');
                const pho = this.escapeHtml(w.phonetic || '');
                const meaning = this.escapeHtml(w.meaning || '');
                const sentence = this.escapeHtml(w.sentence || '');
                const trans = this.escapeHtml(w.sentenceTranslation || '');
                const wordLang = (
                    w.sourceLang ||
                    this.session?.sourceLanguage ||
                    'ja'
                ).trim();

                let speakBtnHtml = '';
                if (isTtsMaster) {
                    if (ttsMode === 'edge') {
                        if (TtsAudioService.isLanguageSupported(wordLang)) {
                            speakBtnHtml = `<button type="button" class="btn-word-speak btn-icon" data-idx="${idx}" title="试听高保真发音 (${this.escapeHtml(wordLang)})" style="background: rgba(56,189,248,0.12); border: 1px solid rgba(56,189,248,0.3); color: #38bdf8; border-radius: 4px; padding: 2px 7px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; margin-left: 2px;">🔈</button>`;
                        }
                    } else if (ttsMode === 'native') {
                        if (this.hasNativeVoice(wordLang)) {
                            speakBtnHtml = `<button type="button" class="btn-word-speak btn-icon" data-idx="${idx}" title="试听系统发音 (${this.escapeHtml(wordLang)})" style="background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); color: #10b981; border-radius: 4px; padding: 2px 7px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; margin-left: 2px;">🔈</button>`;
                        } else {
                            speakBtnHtml = `<span title="系统未安装【${this.escapeHtml(wordLang)}】本地语音包" style="font-size: 11px; color: #64748b; cursor: help; padding: 2px 4px; margin-left: 2px;">🔇</span>`;
                        }
                    }
                }

                const langBadge =
                    w.sourceLang && w.targetLang
                        ? `<span class="badge badge-neutral" style="font-size:10px; margin-left:6px;">${w.sourceLang}➔${w.targetLang}</span>`
                        : '';
                const epBadge =
                    isMultiEpisode && (w.originShowTitle || w.originEpisodeId)
                        ? `<span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; border: 1px solid rgba(56,189,248,0.3); font-size:10px; margin-left:6px;" title="${this.escapeHtml(w.originEpisodeId || '')}">📺 ${this.escapeHtml(w.originShowTitle || w.originEpisodeId || '')}</span>`
                        : '';

                return `
          <div class="curation-word-card ${isChecked ? 'selected' : ''}" data-idx="${idx}" style="background:#16161b; border: 1px solid ${isChecked ? '#38bdf8' : 'var(--border-color)'}; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
            <div style="display:flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px;">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <input type="checkbox" class="chk-word-select" data-idx="${idx}" ${isChecked ? 'checked' : ''} style="cursor:pointer;" />
                <input
                  type="text"
                  class="form-control input-word-headword"
                  data-idx="${idx}"
                  value="${word}"
                  title="点击可编辑生词原形 (Headword)"
                  placeholder="Word..."
                  style="font-weight: 700; font-size: 15px; color: #fff; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; padding: 2px 8px; width: 170px; height: 28px;"
                />
                ${speakBtnHtml}
                ${langBadge}
                ${epBadge}
                ${isUser ? '<span class="badge" style="background:rgba(212,175,55,0.2); color:#ffd700; border:1px solid #d4af37; font-size:10px;">⭐ User</span>' : '<span class="badge" style="background:#222; color:#888; font-size:10px;">🤖 AI</span>'}
              </div>
              <div style="display:flex; gap: 6px;">
                <button type="button" class="btn-secondary btn-sm btn-word-enrich" data-idx="${idx}" title="使用监督模型润色该词条（受锁定列保护）" style="font-size: 11px; padding: 2px 8px;">
                  ✨ 润色
                </button>
                <button type="button" class="btn-danger btn-sm btn-word-delete" data-idx="${idx}" title="从列表中删除该词条" style="font-size: 11px; padding: 2px 8px;">
                  🗑️
                </button>
              </div>
            </div>

            <!-- Row 1: Lemma (1fr), Meaning (2fr), Phonetic (1fr), POS (0.8fr) -->
            <div style="display: grid; grid-template-columns: 1fr 2fr 1fr 0.8fr; gap: 8px; margin-bottom: 8px;">
              <div>
                <div class="curation-field-label">
                  <span>原型 (Lemma):</span>
                  ${isLemmaLocked ? '<span class="curation-field-lock-tag">🔒 已锁定</span>' : ''}
                </div>
                <input
                  type="text"
                  class="form-control input-word-lemma"
                  data-idx="${idx}"
                  value="${lemma}"
                  placeholder="Root / Lemma..."
                  style="width: 100%; height: 28px; font-size: 12.5px; color: #38bdf8; background: #0e0e12; border: 1px solid ${isLemmaLocked ? 'rgba(239,68,68,0.35)' : 'var(--border-color)'};"
                />
              </div>

              <div>
                <div class="curation-field-label">
                  <span>释义 (Meaning):</span>
                  ${isMeaningLocked ? '<span class="curation-field-lock-tag">🔒 已锁定</span>' : ''}
                </div>
                <input
                  type="text"
                  class="form-control input-word-meaning"
                  data-idx="${idx}"
                  value="${meaning}"
                  placeholder="Target language definition..."
                  style="width: 100%; height: 28px; font-size: 12.5px; color: #46d369; background: #0e0e12; border: 1px solid ${isMeaningLocked ? 'rgba(239,68,68,0.35)' : 'var(--border-color)'};"
                />
              </div>

              <div>
                <div class="curation-field-label">
                  <span>发音/读音 (Phonetic):</span>
                  ${isPhoLocked ? '<span class="curation-field-lock-tag">🔒 已锁定</span>' : ''}
                </div>
                <input
                  type="text"
                  class="form-control input-word-phonetic"
                  data-idx="${idx}"
                  value="${pho}"
                  placeholder="Reading / IPA..."
                  style="width: 100%; height: 28px; font-size: 12px; color: #93c5fd; background: #0e0e12; border: 1px solid ${isPhoLocked ? 'rgba(239,68,68,0.35)' : 'var(--border-color)'};"
                />
              </div>

              <div>
                <div class="curation-field-label">
                  <span>词性 (POS):</span>
                  ${isPosLocked ? '<span class="curation-field-lock-tag">🔒 已锁定</span>' : ''}
                </div>
                <input
                  type="text"
                  class="form-control input-word-pos"
                  data-idx="${idx}"
                  value="${pos}"
                  placeholder="n. / v. / adj..."
                  style="width: 100%; height: 28px; font-size: 12px; color: #cbd5e1; background: #0e0e12; border: 1px solid ${isPosLocked ? 'rgba(239,68,68,0.35)' : 'var(--border-color)'};"
                />
              </div>
            </div>

            <!-- Row 2: Sentence (1fr), Translation (1fr) -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <div>
                <div class="curation-field-label">
                  <span>语境例句 (Sentence):</span>
                  ${isSentenceLocked ? '<span class="curation-field-lock-tag">🔒 已锁定</span>' : ''}
                </div>
                <textarea
                  class="form-control input-word-sentence"
                  data-idx="${idx}"
                  rows="2"
                  placeholder="Context sentence in source language..."
                  style="width: 100%; font-size: 12px; color: #e2e8f0; background: #0e0e12; resize: vertical; border: 1px solid ${isSentenceLocked ? 'rgba(239,68,68,0.35)' : 'var(--border-color)'}; line-height: 1.4;"
                >${sentence}</textarea>
              </div>

              <div>
                <div class="curation-field-label">
                  <span>例句翻译 (Translation):</span>
                  ${isTransLocked ? '<span class="curation-field-lock-tag">🔒 已锁定</span>' : ''}
                </div>
                <textarea
                  class="form-control input-word-translation"
                  data-idx="${idx}"
                  rows="2"
                  placeholder="Sentence translation in target language..."
                  style="width: 100%; font-size: 12px; color: #94a3b8; background: #0e0e12; resize: vertical; border: 1px solid ${isTransLocked ? 'rgba(239,68,68,0.35)' : 'var(--border-color)'}; line-height: 1.4;"
                >${trans}</textarea>
              </div>
            </div>
          </div>
        `;
            })
            .join('');

        // Attach Row Listeners
        container
            .querySelectorAll<HTMLInputElement>('.chk-word-select')
            .forEach((chk) => {
                chk.addEventListener('change', () => {
                    const idx = parseInt(chk.dataset.idx || '-1', 10);
                    if (idx >= 0) {
                        if (chk.checked) this.selectedIndices.add(idx);
                        else this.selectedIndices.delete(idx);
                        this.updateSelectionUI();
                        this.renderWordRows();
                    }
                });
            });

        container
            .querySelectorAll<HTMLInputElement>('.input-word-headword')
            .forEach((input) => {
                input.addEventListener('input', () => {
                    const idx = parseInt(input.dataset.idx || '-1', 10);
                    if (idx >= 0 && this.words[idx]) {
                        this.words[idx].word = input.value.trim();
                    }
                });
            });

        container
            .querySelectorAll<HTMLInputElement>('.input-word-lemma')
            .forEach((input) => {
                input.addEventListener('input', () => {
                    const idx = parseInt(input.dataset.idx || '-1', 10);
                    if (idx >= 0 && this.words[idx]) {
                        this.words[idx].lemma = input.value.trim();
                    }
                });
            });

        container
            .querySelectorAll<HTMLInputElement>('.input-word-meaning')
            .forEach((input) => {
                input.addEventListener('input', () => {
                    const idx = parseInt(input.dataset.idx || '-1', 10);
                    if (idx >= 0 && this.words[idx]) {
                        this.words[idx].meaning = input.value;
                    }
                });
            });

        container
            .querySelectorAll<HTMLInputElement>('.input-word-phonetic')
            .forEach((input) => {
                input.addEventListener('input', () => {
                    const idx = parseInt(input.dataset.idx || '-1', 10);
                    if (idx >= 0 && this.words[idx]) {
                        this.words[idx].phonetic = input.value;
                    }
                });
            });

        container
            .querySelectorAll<HTMLInputElement>('.input-word-pos')
            .forEach((input) => {
                input.addEventListener('input', () => {
                    const idx = parseInt(input.dataset.idx || '-1', 10);
                    if (idx >= 0 && this.words[idx]) {
                        this.words[idx].pos = input.value;
                    }
                });
            });

        container
            .querySelectorAll<HTMLTextAreaElement>('.input-word-sentence')
            .forEach((ta) => {
                ta.addEventListener('input', () => {
                    const idx = parseInt(ta.dataset.idx || '-1', 10);
                    if (idx >= 0 && this.words[idx]) {
                        this.words[idx].sentence = ta.value;
                    }
                });
            });

        container
            .querySelectorAll<HTMLTextAreaElement>('.input-word-translation')
            .forEach((ta) => {
                ta.addEventListener('input', () => {
                    const idx = parseInt(ta.dataset.idx || '-1', 10);
                    if (idx >= 0 && this.words[idx]) {
                        this.words[idx].sentenceTranslation = ta.value;
                    }
                });
            });

        container
            .querySelectorAll<HTMLButtonElement>('.btn-word-delete')
            .forEach((btn) => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.idx || '-1', 10);
                    if (idx >= 0) {
                        this.words.splice(idx, 1);
                        this.selectedIndices.delete(idx);
                        this.updateSelectionUI();
                        this.renderWordRows();
                    }
                });
            });

        container
            .querySelectorAll<HTMLButtonElement>('.btn-word-enrich')
            .forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const idx = parseInt(btn.dataset.idx || '-1', 10);
                    if (idx >= 0) {
                        await this.handleSingleEnrich(idx, btn);
                    }
                });
            });

        container
            .querySelectorAll<HTMLButtonElement>('.btn-word-speak')
            .forEach((btn) => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.idx || '-1', 10);
                    if (idx >= 0 && this.words[idx]) {
                        await this.handleWordSpeak(btn, idx);
                    }
                });
            });
    }

    private updateTtsBarUI(): void {
        const masterCheck = document.getElementById(
            'curation-tts-master-check',
        ) as HTMLInputElement | null;
        const hintEl = document.getElementById('curation-tts-hint');
        const modesContainer = document.getElementById('curation-tts-modes');

        const isMaster =
            localStorage.getItem('ncw_anki_tts_master') !== 'false';
        const mode = localStorage.getItem('ncw_anki_tts_mode') || 'edge';

        if (masterCheck) {
            masterCheck.checked = isMaster;
        }

        const activeRadio = document.querySelector<HTMLInputElement>(
            `input[name="curation-tts-mode"][value="${mode}"]`,
        );
        if (activeRadio) {
            activeRadio.checked = true;
        }

        if (modesContainer) {
            modesContainer.style.opacity = isMaster ? '1' : '0.4';
            modesContainer.style.pointerEvents = isMaster ? 'auto' : 'none';
        }

        if (hintEl) {
            if (!isMaster) {
                hintEl.innerHTML =
                    '<span style="color: #64748b;">🔇 发音已关闭</span>';
            } else if (mode === 'edge') {
                hintEl.innerHTML =
                    '<span style="color: #38bdf8;">✅ 云端高保真语音：卡片小喇叭即点即试听，导出附带发音列</span>';
            } else if (mode === 'native') {
                hintEl.innerHTML =
                    '<span style="color: #10b981;">✅ 本地原生语音：调用系统语音包试听与生成 [tts:lang] 标签</span>';
            } else if (mode === 'awesome') {
                hintEl.innerHTML =
                    '<span style="color: #cbd5e1;">✨ AwesomeTTS 模式：卡片保持干净字段，供桌面插件批量生成</span>';
            }
        }
    }

    private hasNativeVoice(lang: string): boolean {
        if (typeof window === 'undefined' || !('speechSynthesis' in window))
            return false;
        const voices = window.speechSynthesis.getVoices();
        const prefix = (lang || '').split(/[-_]/)[0].toLowerCase();
        return voices.some(
            (v) =>
                v.lang.toLowerCase().startsWith(prefix) ||
                v.lang.replace('_', '-').toLowerCase() ===
                    lang.replace('_', '-').toLowerCase(),
        );
    }

    private async handleWordSpeak(
        btn: HTMLButtonElement,
        idx: number,
    ): Promise<void> {
        const item = this.words[idx];
        if (!item) return;
        const text = (item.word || '').trim();
        if (!text) return;
        const lang = (
            item.sourceLang ||
            this.session?.sourceLanguage ||
            'ja'
        ).trim();
        const mode = localStorage.getItem('ncw_anki_tts_mode') || 'edge';

        if (mode === 'native') {
            if (typeof window === 'undefined' || !('speechSynthesis' in window))
                return;
            try {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = lang;
                const voices = window.speechSynthesis.getVoices();
                const prefix = lang.split(/[-_]/)[0].toLowerCase();
                const match = voices.find(
                    (v) =>
                        v.lang.toLowerCase().startsWith(prefix) ||
                        v.lang.replace('_', '-').toLowerCase() ===
                            lang.replace('_', '-').toLowerCase(),
                );
                if (match) utterance.voice = match;
                window.speechSynthesis.speak(utterance);
            } catch {
                // Ignore speech synthesis errors
            }
            return;
        }

        if (mode === 'edge') {
            const origHtml = btn.innerHTML;
            btn.innerHTML = '⏳';
            try {
                const base64 = await TtsAudioService.fetchAudioBase64(
                    text,
                    lang,
                );
                if (base64) {
                    if (this.currentAudio) {
                        this.currentAudio.pause();
                        this.currentAudio = null;
                    }
                    this.currentAudio = new Audio(
                        `data:audio/mp3;base64,${base64}`,
                    );
                    await this.currentAudio.play();
                } else {
                    this.onToast('⚠️ 发音加载失败，请检查网络');
                }
            } catch {
                this.onToast('⚠️ 发音加载失败');
            } finally {
                btn.innerHTML = origHtml;
            }
        }
    }

    private async handleSingleEnrich(
        idx: number,
        button: HTMLButtonElement,
    ): Promise<void> {
        if (!this.session || !this.words[idx]) return;

        const allLocked = CURATION_FIELDS.every((f) =>
            this.fieldLockConfig.isLocked(f.key),
        );
        if (allLocked) {
            this.onToast(
                '⚠️ 所有列均已锁定受保护，请至少解锁一列后再进行 AI 润色',
            );
            return;
        }

        const promptInput = document.getElementById(
            'curation-custom-prompt',
        ) as HTMLTextAreaElement | null;
        const customPrompt = promptInput?.value || '';

        const origHtml = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '⏳...';

        try {
            const originEp = this.session.findEpisodeForWord(this.words[idx]);
            const enriched = await this.curationService.enrichWord(
                this.words[idx],
                originEp,
                customPrompt,
                this.fieldLockConfig,
            );
            this.words[idx] = {
                ...this.words[idx],
                ...enriched,
            };
            this.renderWordRows();
            this.onToast(`✨ Enriched "${enriched.word}"`);
        } catch {
            button.disabled = false;
            button.innerHTML = origHtml;
            this.onToast('Enrichment failed');
        }
    }

    private async handleBatchEnrich(): Promise<void> {
        if (!this.session || this.words.length === 0 || this.isEnriching)
            return;

        const allLocked = CURATION_FIELDS.every((f) =>
            this.fieldLockConfig.isLocked(f.key),
        );
        if (allLocked) {
            this.onToast(
                '⚠️ 所有列均已锁定受保护，请至少解锁一列后再进行 AI 润色',
            );
            return;
        }

        const promptInput = document.getElementById(
            'curation-custom-prompt',
        ) as HTMLTextAreaElement | null;
        const customPrompt = promptInput?.value || '';

        // Save prompt for future sessions
        if (customPrompt) {
            await this.curationService.saveCustomPrompt(customPrompt);
        }

        const indicesToEnrich =
            this.selectedIndices.size > 0
                ? Array.from(this.selectedIndices)
                : this.words.map((_, i) => i);

        const statusEl = document.getElementById('curation-enrich-status');
        const btnEnrichAll = document.getElementById(
            'btn-curation-enrich-all',
        ) as HTMLButtonElement | null;

        this.isEnriching = true;
        if (btnEnrichAll) {
            btnEnrichAll.disabled = true;
            btnEnrichAll.innerHTML = '⏳ Enriching...';
        }
        if (statusEl) {
            statusEl.style.display = 'inline-block';
        }

        let completed = 0;
        try {
            for (const idx of indicesToEnrich) {
                const w = this.words[idx];
                if (!w) continue;

                if (statusEl) {
                    statusEl.textContent = `✨ Enriching ${completed + 1}/${indicesToEnrich.length} [${w.word}] (Supervisor)...`;
                }

                const originEp = this.session.findEpisodeForWord(w);
                const enriched = await this.curationService.enrichWord(
                    w,
                    originEp,
                    customPrompt,
                    this.fieldLockConfig,
                );
                this.words[idx] = {
                    ...w,
                    ...enriched,
                };
                completed++;
            }

            this.renderWordRows();
            this.onToast(
                `🎉 Enriched ${completed} word(s) with supervisor model!`,
            );
        } catch {
            this.onToast('Batch enrichment encountered an error');
        } finally {
            this.isEnriching = false;
            if (btnEnrichAll) {
                btnEnrichAll.disabled = false;
                btnEnrichAll.innerHTML = '✨ 一键 AI 释义 (监督模型)';
            }
            if (statusEl) {
                statusEl.style.display = 'none';
            }
        }
    }

    public setImportedMode(isImported: boolean): void {
        this.isImportedMode = isImported;
        const btnSave = document.getElementById(
            'btn-curation-save',
        ) as HTMLButtonElement | null;
        if (btnSave) {
            if (isImported) {
                btnSave.disabled = true;
                btnSave.style.opacity = '0.45';
                btnSave.style.cursor = 'not-allowed';
                btnSave.title =
                    '外部导入模式仅供临时润色与导出，不可写入剧集词库';
            } else {
                btnSave.disabled = false;
                btnSave.style.opacity = '1';
                btnSave.style.cursor = 'pointer';
                btnSave.title = '保存当前修改到本地数据库';
            }
        }
        if (isImported) {
            const badgeEl = document.getElementById('modal-lang-badge');
            if (badgeEl) {
                badgeEl.textContent = '📂 外部导入暂存 (只读不入库)';
            }
            const subtitleEl = document.getElementById('modal-episode-subtitle');
            if (subtitleEl) {
                subtitleEl.textContent =
                    '已导入外部词表（除 word 列外其余均允许留空）。可使用【✨ 一键 AI 释义】智能补全，完成后直接导出到 Anki 或 CSV。此模式不写入剧集库。';
            }
        }
    }

    private exportDirectCsv(words: CuratedVocabWord[]): void {
        const headers: string[] = ['Word'];
        if (this.exportFields.pos) headers.push('POS');
        if (this.exportFields.phonetic) headers.push('Phonetic');
        headers.push('Contextual Meaning');
        if (this.exportFields.sentence) headers.push('Original Sentence');
        if (this.exportFields.sentenceTranslation)
            headers.push('Sentence Translation');
        if (this.exportFields.audio) headers.push('Audio / TTS');

        const escapeCsv = (str: string | number): string => {
            const s = String(str || '');
            return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : `"${s}"`;
        };

        const ttsMode = localStorage.getItem('ncw_anki_tts_mode') || 'edge';
        const isTtsMaster =
            localStorage.getItem('ncw_anki_tts_master') !== 'false';

        const rows: string[][] = words.map((w) => {
            const row: string[] = [escapeCsv(w.word || '')];
            if (this.exportFields.pos) row.push(escapeCsv(w.pos || ''));
            if (this.exportFields.phonetic) row.push(escapeCsv(w.phonetic || ''));
            row.push(escapeCsv(w.meaning || ''));
            if (this.exportFields.sentence) row.push(escapeCsv(w.sentence || ''));
            if (this.exportFields.sentenceTranslation)
                row.push(escapeCsv(w.sentenceTranslation || ''));
            if (this.exportFields.audio) {
                let audioTag = '';
                if (isTtsMaster) {
                    if (ttsMode === 'awesome') {
                        audioTag = `[sound:awesome_tts_${w.word}.mp3]`;
                    } else if (w.audio) {
                        audioTag = `[sound:${w.audio}]`;
                    } else {
                        audioTag = `[sound:cowatcher_tts_${w.word}.mp3]`;
                    }
                }
                row.push(escapeCsv(audioTag));
            }
            return row;
        });

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
        a.download = `cowatcher_imported_vocab_${words.length}.csv`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 500);

        this.onToast(`🎉 成功导出 ${words.length} 个词汇为 CSV！`);
    }

    private async handleSaveChanges(showToast: boolean = true): Promise<void> {
        if (!this.session) return;
        if (this.isImportedMode || this.session.isImported) {
            if (showToast) {
                this.onToast(
                    '⚠️ 外部导入词表为临时暂存模式，不支持保存至剧集库，请直接导出到 Anki 或 CSV',
                );
            }
            return;
        }
        const btnSave = document.getElementById(
            'btn-curation-save',
        ) as HTMLButtonElement | null;
        if (btnSave && showToast) {
            btnSave.disabled = true;
            btnSave.innerHTML = '💾 Saving...';
        }

        try {
            await this.curationService.saveCuratedSession(
                this.session,
                this.words,
            );
            if (showToast) {
                this.onToast('💾 Changes saved to vocabulary bank!');
            }
            this.onUpdateCallback?.();
            this.session.onUpdate?.();
        } catch {
            if (showToast) {
                this.onToast('Failed to save changes');
            }
        } finally {
            if (btnSave && showToast) {
                btnSave.disabled = false;
                btnSave.innerHTML = '💾 保存修改';
            }
        }
    }

    private escapeHtml(str: string): string {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
