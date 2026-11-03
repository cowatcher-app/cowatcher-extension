import {
    AnkiService,
    DEFAULT_COWATCHER_BACK,
    DEFAULT_COWATCHER_CSS,
    DEFAULT_COWATCHER_FRONT,
    DEFAULT_COWATCHER_MODEL_NAME,
} from './ankiService';
import {
    AnkiExportOptions,
    AnkiFieldMapping,
    AnkiTtsMode,
    CoWatcherFieldKey,
    VocabExportItem,
} from './ankiTypes';
import { NCW_I18N } from '@shared/utils/i18n';
import { TtsAudioService } from '@shared/infrastructure/audio/TtsAudioService';

function escapeHtml(str: string): string {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const COWATCHER_FIELDS: Array<{
    key: CoWatcherFieldKey;
    label: string;
    desc: string;
}> = [
    {
        key: 'Word',
        label: 'Word (Base / Lemma)',
        desc: 'Target vocabulary or lemma',
    },
    {
        key: 'Reading',
        label: 'Pronunciation / Reading',
        desc: 'Phonetic transcription, kana or pinyin',
    },
    {
        key: 'Meaning',
        label: 'Definition / Meaning',
        desc: 'Contextual or dictionary definition',
    },
    {
        key: 'POS',
        label: 'Part of Speech (POS)',
        desc: 'Grammatical category (noun, verb, etc.)',
    },
    {
        key: 'Sentence',
        label: 'Context Sentence',
        desc: 'Original dialogue line highlighting target word',
    },
    {
        key: 'SentenceTranslation',
        label: 'Sentence Translation',
        desc: 'Subtitle translation or notes',
    },
    {
        key: 'Audio',
        label: 'Audio Tag',
        desc: '[sound:...] or [tts:...]',
    },
    {
        key: 'Notes',
        label: 'Source & Notes',
        desc: 'Episode title, context or timestamp',
    },
];

export class AnkiExportModal {
    private modalEl: HTMLElement | null = null;
    private templateModalEl: HTMLElement | null = null;
    private currentItems: VocabExportItem[] = [];
    private isConnected: boolean = false;
    private pollIntervalId: number | null = null;
    private currentAudio: HTMLAudioElement | null = null;

    // Template editor state
    private currentEditingModel: string = DEFAULT_COWATCHER_MODEL_NAME;
    private currentCardTemplateName: string = 'Card 1';
    private currentFrontTpl: string = DEFAULT_COWATCHER_FRONT;
    private currentBackTpl: string = DEFAULT_COWATCHER_BACK;
    private currentCss: string = DEFAULT_COWATCHER_CSS;
    private currentActiveTab: 'front' | 'back' | 'css' = 'front';
    private previewIsBack: boolean = false;

    constructor(
        private readonly ankiService: AnkiService,
        private readonly onToast: (message: string) => void,
    ) {
        this.init();
        this.initTemplateEditor();
    }

    private init(): void {
        this.modalEl = document.getElementById('anki-export-modal');
        if (!this.modalEl) return;

        // Close handlers
        const btnClose = document.getElementById('btn-anki-modal-close');
        const btnCancel = document.getElementById('btn-anki-modal-cancel');
        btnClose?.addEventListener('click', () => this.hide());
        btnCancel?.addEventListener('click', () => this.hide());

        this.modalEl.addEventListener('click', (e) => {
            if (e.target === this.modalEl) {
                this.hide();
            }
        });

        // Toggle custom deck input
        const deckSelect = document.getElementById(
            'anki-deck-select',
        ) as HTMLSelectElement | null;
        const customDeckInput = document.getElementById(
            'anki-custom-deck-input',
        ) as HTMLInputElement | null;

        deckSelect?.addEventListener('change', () => {
            if (deckSelect.value === '__custom__') {
                if (customDeckInput) {
                    customDeckInput.style.display = 'block';
                    customDeckInput.focus();
                }
            } else {
                if (customDeckInput) customDeckInput.style.display = 'none';
            }
        });

        // Note Type (Model) change handler
        const modelSelect = document.getElementById(
            'anki-model-select',
        ) as HTMLSelectElement | null;
        modelSelect?.addEventListener('change', async () => {
            localStorage.setItem('ncw_anki_model', modelSelect.value);
            await this.loadFieldMapping(modelSelect.value);
        });

        // Direct Sync Button
        const btnSync = document.getElementById('btn-anki-modal-sync');
        btnSync?.addEventListener('click', async () => {
            await this.handleDirectSync();
        });

        // TSV Download Button
        const btnDownloadTsv = document.getElementById('btn-anki-modal-tsv');
        btnDownloadTsv?.addEventListener('click', () => {
            this.handleTsvDownload();
        });

        // Help guide toggle
        const helpToggle = document.getElementById('anki-help-toggle');
        const helpContent = document.getElementById('anki-help-content');
        helpToggle?.addEventListener('click', (e) => {
            e.preventDefault();
            if (helpContent) {
                helpContent.style.display =
                    helpContent.style.display === 'none' ? 'block' : 'none';
            }
        });

        // Master TTS Toggle
        const ttsMasterCheck = document.getElementById(
            'anki-tts-master-check',
        ) as HTMLInputElement | null;
        ttsMasterCheck?.addEventListener('change', () => {
            this.updateTtsStatus();
        });

        // Engine Mode Radios
        const modeRadios = document.querySelectorAll<HTMLInputElement>(
            'input[name="anki-tts-mode"]',
        );
        modeRadios.forEach((r) => {
            r.addEventListener('change', () => {
                this.updateTtsStatus();
            });
        });

        // Voice Language Select
        const voiceSelect = document.getElementById(
            'anki-voice-select',
        ) as HTMLSelectElement | null;
        voiceSelect?.addEventListener('change', () => {
            this.updateTtsStatus();
        });

        // Preview Speaker Button
        const previewBtn = document.getElementById('btn-anki-preview-voice');
        previewBtn?.addEventListener('click', async () => {
            await this.handlePreviewVoice();
        });

        // Listen for browser voice list loading (Chromium loads voices asynchronously)
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.onvoiceschanged = () => {
                if (this.modalEl && this.modalEl.style.display === 'flex') {
                    this.updateTtsStatus();
                }
            };
        }
    }

    private initTemplateEditor(): void {
        const btnOpen = document.getElementById(
            'btn-anki-open-template-editor',
        );
        this.templateModalEl = document.getElementById('anki-template-modal');
        const btnClose = document.getElementById('btn-anki-tpl-close');
        const btnCancel = document.getElementById('btn-anki-tpl-cancel');
        const btnSave = document.getElementById('btn-anki-tpl-save');
        const btnReset = document.getElementById('btn-anki-tpl-reset');
        const btnFlip = document.getElementById('btn-anki-flip-preview');
        const codeEditor = document.getElementById(
            'anki-tpl-code-editor',
        ) as HTMLTextAreaElement | null;

        btnOpen?.addEventListener('click', async () => {
            await this.openTemplateEditor();
        });

        const closeEditor = () => {
            if (this.templateModalEl) {
                this.templateModalEl.style.display = 'none';
            }
        };

        btnClose?.addEventListener('click', closeEditor);
        btnCancel?.addEventListener('click', closeEditor);
        this.templateModalEl?.addEventListener('click', (e) => {
            if (e.target === this.templateModalEl) closeEditor();
        });

        // Tabs
        const tabs =
            document.querySelectorAll<HTMLButtonElement>('.btn-tpl-tab');
        tabs.forEach((tab) => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab as 'front' | 'back' | 'css';
                if (targetTab) this.switchTemplateTab(targetTab);
            });
        });

        // Code Editor Input -> Live Preview
        codeEditor?.addEventListener('input', () => {
            if (this.currentActiveTab === 'front') {
                this.currentFrontTpl = codeEditor.value;
            } else if (this.currentActiveTab === 'back') {
                this.currentBackTpl = codeEditor.value;
            } else if (this.currentActiveTab === 'css') {
                this.currentCss = codeEditor.value;
            }
            this.updateLivePreview();
        });

        // Variable Insertion Chips
        const varChips =
            document.querySelectorAll<HTMLButtonElement>('.btn-insert-var');
        varChips.forEach((chip) => {
            chip.addEventListener('click', () => {
                if (!codeEditor) return;
                const insertText = chip.dataset.var || '';
                const start = codeEditor.selectionStart;
                const end = codeEditor.selectionEnd;
                const text = codeEditor.value;
                codeEditor.value =
                    text.substring(0, start) + insertText + text.substring(end);
                codeEditor.selectionStart = codeEditor.selectionEnd =
                    start + insertText.length;
                codeEditor.focus();
                codeEditor.dispatchEvent(new Event('input'));
            });
        });

        // Flip Card Preview
        btnFlip?.addEventListener('click', () => {
            this.previewIsBack = !this.previewIsBack;
            this.updateLivePreview();
        });

        // Reset to Default
        btnReset?.addEventListener('click', () => {
            if (
                confirm(
                    'Reset card layout and CSS styles to CoWatcher defaults?',
                )
            ) {
                this.currentFrontTpl = DEFAULT_COWATCHER_FRONT;
                this.currentBackTpl = DEFAULT_COWATCHER_BACK;
                this.currentCss = DEFAULT_COWATCHER_CSS;
                if (codeEditor) {
                    if (this.currentActiveTab === 'front')
                        codeEditor.value = this.currentFrontTpl;
                    else if (this.currentActiveTab === 'back')
                        codeEditor.value = this.currentBackTpl;
                    else if (this.currentActiveTab === 'css')
                        codeEditor.value = this.currentCss;
                }
                this.updateLivePreview();
            }
        });

        // Save to Anki
        btnSave?.addEventListener('click', async () => {
            await this.handleSaveTemplate();
        });
    }

    async show(
        items: VocabExportItem[],
        defaultLanguage: string = 'ja_JP',
    ): Promise<void> {
        if (!this.modalEl) return;
        this.currentItems = items;

        const countEl = document.getElementById('anki-modal-item-count');
        const customDeckInput = document.getElementById(
            'anki-custom-deck-input',
        ) as HTMLInputElement | null;
        const voiceSelect = document.getElementById(
            'anki-voice-select',
        ) as HTMLSelectElement | null;
        const ttsMasterCheck = document.getElementById(
            'anki-tts-master-check',
        ) as HTMLInputElement | null;
        const furiganaCheck = document.getElementById(
            'anki-furigana-check',
        ) as HTMLInputElement | null;

        // Deduplicate summary
        const deduped = this.ankiService.deduplicate(items);
        if (countEl) {
            countEl.textContent = `${deduped.unique.length} unique words (${deduped.duplicateCount} duplicate${deduped.duplicateCount === 1 ? '' : 's'} merged)`;
        }

        // Restore voice language
        if (voiceSelect) {
            const savedVoice = localStorage.getItem('ncw_anki_voice_lang');
            if (savedVoice) {
                voiceSelect.value = savedVoice;
            } else {
                const itemLang = items[0]?.word?.sourceLang || defaultLanguage;
                const lang = itemLang.toLowerCase();
                if (lang.includes('ja') || lang.includes('jp')) {
                    voiceSelect.value = 'ja_JP';
                } else if (lang.includes('ko') || lang.includes('kr')) {
                    voiceSelect.value = 'ko_KR';
                } else if (lang.includes('zh') || lang.includes('cn')) {
                    voiceSelect.value = 'zh_CN';
                } else if (lang.includes('es')) {
                    voiceSelect.value = 'es_ES';
                } else if (lang.includes('fr')) {
                    voiceSelect.value = 'fr_FR';
                } else if (lang.includes('de')) {
                    voiceSelect.value = 'de_DE';
                } else {
                    voiceSelect.value = 'en_US';
                }
            }
        }

        // Restore master TTS toggle
        if (ttsMasterCheck) {
            const savedMaster = localStorage.getItem('ncw_anki_tts_master');
            if (savedMaster !== null) {
                ttsMasterCheck.checked = savedMaster === 'true';
            }
        }

        // Restore TTS mode
        const savedMode = localStorage.getItem('ncw_anki_tts_mode') || 'edge';
        const modeRadio = document.querySelector<HTMLInputElement>(
            `input[name="anki-tts-mode"][value="${savedMode}"]`,
        );
        if (modeRadio) {
            modeRadio.checked = true;
        }

        // Restore Furigana check
        if (furiganaCheck) {
            const savedFurigana = localStorage.getItem('ncw_anki_furigana');
            if (savedFurigana !== null) {
                furiganaCheck.checked = savedFurigana === 'true';
            }
        }

        // Restore reading placement
        const placementSelect = document.getElementById(
            'anki-reading-placement-select',
        ) as HTMLSelectElement | null;
        if (placementSelect) {
            const savedPlacement = localStorage.getItem(
                'ncw_anki_reading_placement',
            );
            if (savedPlacement) {
                placementSelect.value = savedPlacement;
            }
        }

        // Reset custom input
        if (customDeckInput) {
            customDeckInput.value = '';
            customDeckInput.style.display = 'none';
        }

        // Initial UI state
        this.updateConnectionUI(false, true);
        this.modalEl.style.display = 'flex';

        // Update TTS speaker button and status
        this.updateTtsStatus();

        // Check connection and load decks & models
        const available = await this.ankiService.isConnectAvailable();
        this.isConnected = available;
        this.updateConnectionUI(available);
        await this.loadDecks();
        await this.loadModels();

        // Start 2-second background polling while modal is open
        this.startPolling();
    }

    hide(): void {
        this.stopPolling();
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
        if (this.templateModalEl) {
            this.templateModalEl.style.display = 'none';
        }
        this.currentItems = [];
    }

    private startPolling(): void {
        this.stopPolling();
        this.pollIntervalId = window.setInterval(async () => {
            const available = await this.ankiService.isConnectAvailable();
            if (available !== this.isConnected) {
                this.isConnected = available;
                this.updateConnectionUI(available);
                if (available) {
                    await this.loadDecks();
                    await this.loadModels();
                }
            }
        }, 2000);
    }

    private stopPolling(): void {
        if (this.pollIntervalId !== null) {
            clearInterval(this.pollIntervalId);
            this.pollIntervalId = null;
        }
    }

    private updateConnectionUI(available: boolean, isChecking = false): void {
        const statusBadge = document.getElementById('anki-status-badge');
        const btnSync = document.getElementById(
            'btn-anki-modal-sync',
        ) as HTMLButtonElement | null;

        if (statusBadge) {
            if (isChecking) {
                statusBadge.className = 'status-pill checking';
                statusBadge.innerHTML = '🔄 Checking AnkiConnect...';
            } else if (available) {
                statusBadge.className = 'status-pill online';
                statusBadge.innerHTML = '🟢 AnkiConnect Online (127.0.0.1:8765)';
            } else {
                statusBadge.className = 'status-pill offline';
                statusBadge.innerHTML =
                    '⚪ AnkiConnect Offline (TSV Export Available)';
            }
        }

        if (btnSync) {
            btnSync.disabled = !available;
            btnSync.title = available
                ? 'Sync directly to Anki desktop'
                : 'AnkiConnect is offline. Start Anki Desktop with AnkiConnect add-on or export TSV.';
        }
    }

    private async loadDecks(): Promise<void> {
        const deckSelect = document.getElementById(
            'anki-deck-select',
        ) as HTMLSelectElement | null;
        if (!deckSelect) return;

        const lastDeck = await this.ankiService.getLastUsedDeck();
        let deckNames: string[] = ['CoWatcher', 'Default'];

        if (this.isConnected) {
            try {
                deckNames = await this.ankiService.getDeckNames();
            } catch {
                // Fallback
            }
        }

        if (!deckNames.includes('CoWatcher')) {
            deckNames.unshift('CoWatcher');
        }
        if (lastDeck && !deckNames.includes(lastDeck)) {
            deckNames.unshift(lastDeck);
        }

        deckSelect.innerHTML = '';
        deckNames.forEach((d) => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            if (d === lastDeck) opt.selected = true;
            deckSelect.appendChild(opt);
        });

        // Option to enter custom deck name
        const customOpt = document.createElement('option');
        customOpt.value = '__custom__';
        customOpt.textContent = '➕ Create new deck...';
        deckSelect.appendChild(customOpt);
    }

    private async loadModels(): Promise<void> {
        const modelSelect = document.getElementById(
            'anki-model-select',
        ) as HTMLSelectElement | null;
        if (!modelSelect) return;

        let modelNames: string[] = [DEFAULT_COWATCHER_MODEL_NAME, 'Basic'];
        if (this.isConnected) {
            try {
                await this.ankiService.ensureCoWatcherModel();
                modelNames = await this.ankiService.getModelNames();
            } catch {
                // Fallback
            }
        }

        if (!modelNames.includes(DEFAULT_COWATCHER_MODEL_NAME)) {
            modelNames.unshift(DEFAULT_COWATCHER_MODEL_NAME);
        }

        const lastModel =
            localStorage.getItem('ncw_anki_model') ||
            DEFAULT_COWATCHER_MODEL_NAME;

        modelSelect.innerHTML = '';
        modelNames.forEach((m) => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent =
                m === DEFAULT_COWATCHER_MODEL_NAME
                    ? `${m} (Modern Card Template)`
                    : m;
            if (m === lastModel) opt.selected = true;
            modelSelect.appendChild(opt);
        });

        await this.loadFieldMapping(modelSelect.value);
    }

    private async loadFieldMapping(modelName: string): Promise<void> {
        const container = document.getElementById('anki-field-mapping-table');
        if (!container) return;

        let fields: string[] = [];
        if (this.isConnected) {
            try {
                fields = await this.ankiService.getModelFieldNames(modelName);
            } catch {
                // Fallback
            }
        }
        if (fields.length === 0) {
            fields = [
                'Word',
                'Reading',
                'Meaning',
                'POS',
                'Sentence',
                'SentenceTranslation',
                'Audio',
                'Notes',
                'Front',
                'Back',
            ];
        }

        let savedMap: AnkiFieldMapping = {};
        try {
            const raw = localStorage.getItem(`ncw_anki_map_${modelName}`);
            if (raw) savedMap = JSON.parse(raw);
        } catch {
            // ignore
        }

        container.innerHTML = '';

        COWATCHER_FIELDS.forEach((cw) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.flexDirection = 'column';
            row.style.gap = '3px';

            const label = document.createElement('label');
            label.style.fontWeight = '600';
            label.style.color = '#cbd5e1';
            label.style.fontSize = '11.5px';
            label.textContent = `${cw.label}:`;

            const select = document.createElement('select');
            select.className = 'form-control anki-field-mapping-select';
            select.dataset.cwKey = cw.key;
            select.style.height = '32px';
            select.style.fontSize = '12px';

            const noneOpt = document.createElement('option');
            noneOpt.value = '';
            noneOpt.textContent = '(Do Not Export / Blank)';
            select.appendChild(noneOpt);

            const matchedDefault =
                savedMap[cw.key] !== undefined
                    ? savedMap[cw.key]
                    : this.autoMatchField(cw.key, fields);

            fields.forEach((f) => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = f;
                if (f === matchedDefault) opt.selected = true;
                select.appendChild(opt);
            });

            select.addEventListener('change', () => {
                this.saveCurrentFieldMapping(modelName);
            });

            row.appendChild(label);
            row.appendChild(select);
            container.appendChild(row);
        });
    }

    private autoMatchField(
        cwKey: CoWatcherFieldKey,
        ankiFields: string[],
    ): string {
        const lower = cwKey.toLowerCase();
        const exact = ankiFields.find((f) => f.toLowerCase() === lower);
        if (exact) return exact;

        if (cwKey === 'Word') {
            return (
                ankiFields.find((f) =>
                    [
                        'expression',
                        'headword',
                        'front',
                        'vocab',
                        'term',
                        'word',
                    ].includes(f.toLowerCase()),
                ) || ''
            );
        }
        if (cwKey === 'Reading') {
            return (
                ankiFields.find((f) =>
                    [
                        'furigana',
                        'kana',
                        'reading',
                        'phonetic',
                        'pinyin',
                    ].includes(f.toLowerCase()),
                ) || ''
            );
        }
        if (cwKey === 'Meaning') {
            return (
                ankiFields.find((f) =>
                    [
                        'glossary',
                        'definition',
                        'meaning',
                        'back',
                        'translation',
                    ].includes(f.toLowerCase()),
                ) || ''
            );
        }
        if (cwKey === 'Sentence') {
            return (
                ankiFields.find((f) =>
                    ['sentence', 'example', 'context', 'sent'].includes(
                        f.toLowerCase(),
                    ),
                ) || ''
            );
        }
        if (cwKey === 'SentenceTranslation') {
            return (
                ankiFields.find((f) =>
                    [
                        'sentencetranslation',
                        'translation',
                        'sentence_translation',
                        'sent_trans',
                    ].includes(f.toLowerCase()),
                ) || ''
            );
        }
        if (cwKey === 'Audio') {
            return (
                ankiFields.find((f) =>
                    ['audio', 'sound', 'pronunciation'].includes(
                        f.toLowerCase(),
                    ),
                ) || ''
            );
        }
        if (cwKey === 'POS') {
            return (
                ankiFields.find((f) =>
                    ['pos', 'partofspeech', 'wordtype', 'type'].includes(
                        f.toLowerCase(),
                    ),
                ) || ''
            );
        }
        if (cwKey === 'Notes') {
            return (
                ankiFields.find((f) =>
                    ['notes', 'source', 'episode', 'comment', 'extra'].includes(
                        f.toLowerCase(),
                    ),
                ) || ''
            );
        }
        return '';
    }

    private saveCurrentFieldMapping(modelName: string): AnkiFieldMapping {
        const selects = document.querySelectorAll<HTMLSelectElement>(
            '.anki-field-mapping-select',
        );
        const mapping: AnkiFieldMapping = {};
        selects.forEach((sel) => {
            const cwKey = sel.dataset.cwKey as CoWatcherFieldKey;
            if (cwKey) {
                mapping[cwKey] = sel.value;
            }
        });
        try {
            localStorage.setItem(
                `ncw_anki_map_${modelName}`,
                JSON.stringify(mapping),
            );
        } catch {
            // ignore
        }
        return mapping;
    }

    private updateTtsStatus(): void {
        const ttsMasterCheck = document.getElementById(
            'anki-tts-master-check',
        ) as HTMLInputElement | null;
        const modesContainer = document.getElementById(
            'anki-tts-modes-container',
        );
        const voiceSelect = document.getElementById(
            'anki-voice-select',
        ) as HTMLSelectElement | null;
        const previewBtn = document.getElementById('btn-anki-preview-voice');
        const voiceStatusHint = document.getElementById(
            'anki-voice-status-hint',
        );

        const isMasterEnabled = ttsMasterCheck ? ttsMasterCheck.checked : true;
        const activeRadio = document.querySelector<HTMLInputElement>(
            'input[name="anki-tts-mode"]:checked',
        );
        const mode: AnkiTtsMode = (activeRadio?.value as AnkiTtsMode) || 'edge';
        const firstWordItem = this.currentItems[0]?.word;
        const voiceLang =
            firstWordItem?.sourceLang || voiceSelect?.value || 'ja_JP';

        if (modesContainer) {
            modesContainer.style.opacity = isMasterEnabled ? '1' : '0.4';
            modesContainer.style.pointerEvents = isMasterEnabled
                ? 'auto'
                : 'none';
        }

        // Master TTS is OFF
        if (!isMasterEnabled) {
            if (previewBtn) previewBtn.style.display = 'none';
            if (voiceStatusHint) {
                voiceStatusHint.innerHTML =
                    '<span style="color: #64748b;">🔇 Word audio disabled: Exported cards will not include audio or TTS tags.</span>';
            }
            return;
        }

        // Master TTS is ON
        if (mode === 'awesome') {
            if (previewBtn) previewBtn.style.display = 'none';
            if (voiceStatusHint) {
                voiceStatusHint.innerHTML =
                    '<span style="color: #cbd5e1;">✨ <strong>AwesomeTTS / HyperTTS mode</strong>: Clean text fields preserved for batch audio generation in Anki desktop.</span>';
            }
            return;
        }

        if (mode === 'native') {
            // Sniff local voices via Web Speech API
            const voices =
                typeof window !== 'undefined' && 'speechSynthesis' in window
                    ? window.speechSynthesis.getVoices()
                    : [];
            const prefix = voiceLang.split(/[-_]/)[0].toLowerCase();
            const match = voices.find(
                (v) =>
                    v.lang.toLowerCase().startsWith(prefix) ||
                    v.lang.replace('_', '-').toLowerCase() ===
                        voiceLang.replace('_', '-').toLowerCase(),
            );

            if (match) {
                if (previewBtn) previewBtn.style.display = 'inline-flex';
                if (voiceStatusHint) {
                    voiceStatusHint.innerHTML = `<span style="color: #10b981;">✅ Detected system voice: <strong>${escapeHtml(match.name)}</strong> (${match.lang}). Cards will generate [tts:${voiceLang}] tag.</span>`;
                }
            } else {
                if (previewBtn) previewBtn.style.display = 'none';
                if (voiceStatusHint) {
                    voiceStatusHint.innerHTML = `<span style="color: #f59e0b;">⚠️ No local voice found for <strong>${voiceLang}</strong>. Voice playback may be silent in Anki; High-Fidelity Cloud Voice recommended.</span>`;
                }
            }
            return;
        }

        if (mode === 'edge') {
            const supported = TtsAudioService.isLanguageSupported(voiceLang);
            if (supported) {
                if (previewBtn) previewBtn.style.display = 'inline-flex';
                if (voiceStatusHint) {
                    voiceStatusHint.innerHTML =
                        '<span style="color: #38bdf8;">✅ High-Fidelity Cloud Voice ready: MP3 audio will be automatically downloaded into Anki media library on export (cross-platform).</span>';
                }
            } else {
                if (previewBtn) previewBtn.style.display = 'none';
                if (voiceStatusHint) {
                    voiceStatusHint.innerHTML = `<span style="color: #f59e0b;">⚠️ Cloud voice engine does not currently support [<strong>${voiceLang}</strong>]. Please select another voice mode.</span>`;
                }
            }
            return;
        }
    }

    private async handlePreviewVoice(): Promise<void> {
        const previewBtn = document.getElementById('btn-anki-preview-voice');
        const voiceSelect = document.getElementById(
            'anki-voice-select',
        ) as HTMLSelectElement | null;
        const activeRadio = document.querySelector<HTMLInputElement>(
            'input[name="anki-tts-mode"]:checked',
        );
        const mode: AnkiTtsMode = (activeRadio?.value as AnkiTtsMode) || 'edge';
        const firstWordItem = this.currentItems[0]?.word;
        const voiceLang =
            firstWordItem?.sourceLang || voiceSelect?.value || 'ja_JP';

        const sampleWord =
            this.currentItems[0]?.word?.word?.trim() ||
            this.getSampleWordForLang(voiceLang);

        if (mode === 'native') {
            if (typeof window === 'undefined' || !('speechSynthesis' in window))
                return;
            try {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(sampleWord);
                utterance.lang = voiceLang;
                const voices = window.speechSynthesis.getVoices();
                const prefix = voiceLang.split(/[-_]/)[0].toLowerCase();
                const match = voices.find(
                    (v) =>
                        v.lang.toLowerCase().startsWith(prefix) ||
                        v.lang.replace('_', '-').toLowerCase() ===
                            voiceLang.replace('_', '-').toLowerCase(),
                );
                if (match) utterance.voice = match;
                window.speechSynthesis.speak(utterance);
            } catch {
                // Ignore preview errors
            }
            return;
        }

        if (mode === 'edge') {
            if (!previewBtn) return;
            const origHtml = previewBtn.innerHTML;
            previewBtn.innerHTML = '<span>⏳ Loading...</span>';
            try {
                const base64 = await TtsAudioService.fetchAudioBase64(
                    sampleWord,
                    voiceLang,
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
                    this.onToast(
                        '⚠️ Audio generation failed. Please check network connection.',
                    );
                }
            } catch {
                this.onToast('⚠️ Audio loading failed');
            } finally {
                previewBtn.innerHTML = origHtml;
            }
        }
    }

    private getSampleWordForLang(lang: string): string {
        const lower = lang.toLowerCase();
        if (lower.includes('ja')) return 'こんにちは';
        if (lower.includes('ko')) return '안녕하세요';
        if (lower.includes('zh')) return '你好';
        if (lower.includes('es')) return 'Hola';
        if (lower.includes('fr')) return 'Bonjour';
        if (lower.includes('de')) return 'Hallo';
        return 'Hello';
    }

    // --- Template Editor & Live Preview Methods ---

    private async openTemplateEditor(): Promise<void> {
        const modelSelect = document.getElementById(
            'anki-model-select',
        ) as HTMLSelectElement | null;
        this.currentEditingModel =
            modelSelect?.value || DEFAULT_COWATCHER_MODEL_NAME;

        const modelLabel = document.getElementById('anki-editor-model-name');
        if (modelLabel) modelLabel.textContent = this.currentEditingModel;

        const templates = await this.ankiService.getModelTemplates(
            this.currentEditingModel,
        );
        const firstCardName = Object.keys(templates)[0] || 'Card 1';
        this.currentCardTemplateName = firstCardName;
        this.currentFrontTpl =
            templates[firstCardName]?.Front || DEFAULT_COWATCHER_FRONT;
        this.currentBackTpl =
            templates[firstCardName]?.Back || DEFAULT_COWATCHER_BACK;
        this.currentCss = await this.ankiService.getModelStyling(
            this.currentEditingModel,
        );

        this.currentActiveTab = 'front';
        this.previewIsBack = false;

        const codeEditor = document.getElementById(
            'anki-tpl-code-editor',
        ) as HTMLTextAreaElement | null;
        if (codeEditor) {
            codeEditor.value = this.currentFrontTpl;
        }

        const tabs =
            document.querySelectorAll<HTMLButtonElement>('.btn-tpl-tab');
        tabs.forEach((t) => {
            t.classList.toggle('active', t.dataset.tab === 'front');
        });

        this.updateLivePreview();
        if (this.templateModalEl) {
            this.templateModalEl.style.display = 'flex';
        }
    }

    private switchTemplateTab(tab: 'front' | 'back' | 'css'): void {
        const codeEditor = document.getElementById(
            'anki-tpl-code-editor',
        ) as HTMLTextAreaElement | null;
        if (codeEditor) {
            if (this.currentActiveTab === 'front')
                this.currentFrontTpl = codeEditor.value;
            else if (this.currentActiveTab === 'back')
                this.currentBackTpl = codeEditor.value;
            else if (this.currentActiveTab === 'css')
                this.currentCss = codeEditor.value;
        }

        this.currentActiveTab = tab;

        const tabs =
            document.querySelectorAll<HTMLButtonElement>('.btn-tpl-tab');
        tabs.forEach((t) => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });

        if (codeEditor) {
            if (tab === 'front') codeEditor.value = this.currentFrontTpl;
            else if (tab === 'back') codeEditor.value = this.currentBackTpl;
            else if (tab === 'css') codeEditor.value = this.currentCss;
        }

        if (tab === 'front') this.previewIsBack = false;
        else if (tab === 'back') this.previewIsBack = true;

        this.updateLivePreview();
    }

    private updateLivePreview(): void {
        const previewBox = document.getElementById(
            'anki-card-live-preview-box',
        );
        const sideLabel = document.getElementById('anki-preview-side-label');
        if (!previewBox) return;

        if (sideLabel) {
            sideLabel.textContent = this.previewIsBack
                ? NCW_I18N.t('anki.sideBack') || 'Back'
                : NCW_I18N.t('anki.sideFront') || 'Front';
        }

        const firstItem = this.currentItems[0]?.word;
        const mockData: Record<string, string> = {
            Word: firstItem?.word || 'backroom',
            Reading: firstItem?.phonetic || 'ˈbækruːm',
            Meaning:
                firstItem?.meaning ||
                firstItem?.dictMeaning ||
                'A room where confidential discussions or negotiations take place',
            POS: firstItem?.pos || 'noun',
            Sentence: firstItem?.sentence
                ? `The decisions were made in the <b>${firstItem.word || 'backroom'}</b>.`
                : 'The decisions were made in the <b>backroom</b>.',
            SentenceTranslation:
                firstItem?.sentenceTranslation ||
                'All major decisions were negotiated in backroom meetings.',
            Audio: '🔈 [sound:backroom_audio.mp3]',
            Notes:
                this.currentItems[0]?.episodeInfo?.showTitle ||
                'How Backrooms Should Have Ended',
            Front: firstItem?.word || 'backroom',
            Back:
                firstItem?.meaning ||
                firstItem?.dictMeaning ||
                'A room where confidential discussions or negotiations take place',
        };

        const renderMustache = (
            template: string,
            data: Record<string, string>,
        ): string => {
            let out = template;
            // 1. Conditionals {{#Key}}content{{/Key}}
            out = out.replace(
                /\{\{#([\w]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
                (_, key, content) => {
                    return data[key] ? content : '';
                },
            );
            // 2. Inverted conditionals {{^Key}}content{{/Key}}
            out = out.replace(
                /\{\{\^([\w]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
                (_, key, content) => {
                    return !data[key] ? content : '';
                },
            );
            // 3. Simple replacements {{Key}}
            out = out.replace(/\{\{([\w]+)\}\}/g, (_, key) => {
                return data[key] !== undefined ? data[key] : '';
            });
            return out;
        };

        const frontHtml = renderMustache(this.currentFrontTpl, mockData);
        const contentHtml = this.previewIsBack
            ? renderMustache(this.currentBackTpl, {
                  ...mockData,
                  FrontSide: frontHtml,
              })
            : frontHtml;

        previewBox.innerHTML = `
            <style>
                #anki-card-live-preview-box .card {
                    margin: 0 !important;
                    min-height: 240px;
                    box-sizing: border-box;
                    border-radius: 6px;
                }
                ${this.currentCss}
            </style>
            <div class="card">
                ${contentHtml}
            </div>
        `;
    }

    private async handleSaveTemplate(): Promise<void> {
        const btnSave = document.getElementById(
            'btn-anki-tpl-save',
        ) as HTMLButtonElement | null;
        if (!this.isConnected) {
            alert(
                '⚠️ Please ensure Anki desktop is running with AnkiConnect before syncing templates.',
            );
            return;
        }

        try {
            if (btnSave) {
                btnSave.disabled = true;
                btnSave.textContent = '⏳ Syncing...';
            }

            const codeEditor = document.getElementById(
                'anki-tpl-code-editor',
            ) as HTMLTextAreaElement | null;
            if (codeEditor) {
                if (this.currentActiveTab === 'front')
                    this.currentFrontTpl = codeEditor.value;
                else if (this.currentActiveTab === 'back')
                    this.currentBackTpl = codeEditor.value;
                else if (this.currentActiveTab === 'css')
                    this.currentCss = codeEditor.value;
            }

            const templates: Record<string, { Front: string; Back: string }> = {
                [this.currentCardTemplateName || 'Card 1']: {
                    Front: this.currentFrontTpl,
                    Back: this.currentBackTpl,
                },
            };

            await this.ankiService.saveModelTemplatesAndStyle(
                this.currentEditingModel,
                templates,
                this.currentCss,
            );

            this.onToast(
                `🎉 Card layout and CSS styles synced to Anki [${this.currentEditingModel}]!`,
            );

            if (this.templateModalEl) {
                this.templateModalEl.style.display = 'none';
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            alert(`❌ Failed to save template to Anki: ${msg}`);
        } finally {
            if (btnSave) {
                btnSave.disabled = false;
                btnSave.textContent = '💾 Sync & Save to Anki';
            }
        }
    }

    private getSelectedOptions(): AnkiExportOptions {
        const deckSelect = document.getElementById(
            'anki-deck-select',
        ) as HTMLSelectElement | null;
        const customDeckInput = document.getElementById(
            'anki-custom-deck-input',
        ) as HTMLInputElement | null;
        const modelSelect = document.getElementById(
            'anki-model-select',
        ) as HTMLSelectElement | null;
        const voiceSelect = document.getElementById(
            'anki-voice-select',
        ) as HTMLSelectElement | null;
        const ttsMasterCheck = document.getElementById(
            'anki-tts-master-check',
        ) as HTMLInputElement | null;
        const activeRadio = document.querySelector<HTMLInputElement>(
            'input[name="anki-tts-mode"]:checked',
        );
        const furiganaCheck = document.getElementById(
            'anki-furigana-check',
        ) as HTMLInputElement | null;
        const placementSelect = document.getElementById(
            'anki-reading-placement-select',
        ) as HTMLSelectElement | null;

        let deckName = deckSelect?.value || 'CoWatcher';
        if (deckName === '__custom__') {
            deckName = (customDeckInput?.value || '').trim() || 'CoWatcher';
        }

        const modelName = modelSelect?.value || DEFAULT_COWATCHER_MODEL_NAME;
        const fieldMapping = this.saveCurrentFieldMapping(modelName);

        const firstWordItem = this.currentItems[0]?.word;
        const voiceLang =
            firstWordItem?.sourceLang || voiceSelect?.value || 'ja_JP';
        const enableTts = ttsMasterCheck ? ttsMasterCheck.checked : true;
        const ttsMode: AnkiTtsMode =
            (activeRadio?.value as AnkiTtsMode) || 'edge';
        const formatFurigana = furiganaCheck
            ? furiganaCheck.checked !== false
            : true;
        const readingPlacement =
            (placementSelect?.value as 'front' | 'back' | 'none') || 'front';

        // Persist preferences
        try {
            localStorage.setItem('ncw_anki_tts_master', String(enableTts));
            localStorage.setItem('ncw_anki_tts_mode', ttsMode);
            localStorage.setItem('ncw_anki_voice_lang', voiceLang);
            localStorage.setItem('ncw_anki_furigana', String(formatFurigana));
            localStorage.setItem(
                'ncw_anki_reading_placement',
                readingPlacement,
            );
            localStorage.setItem('ncw_anki_model', modelName);
        } catch {
            // ignore
        }

        return {
            deckName,
            modelName,
            fieldMapping,
            voiceLang,
            enableTts,
            ttsMode,
            formatFurigana,
            readingPlacement,
            tags: ['CoWatcher'],
        };
    }

    private async handleDirectSync(): Promise<void> {
        const btnSync = document.getElementById(
            'btn-anki-modal-sync',
        ) as HTMLButtonElement | null;
        const origText = btnSync?.innerHTML || '🎴 Direct Sync to Anki';

        try {
            if (btnSync) {
                btnSync.disabled = true;
                btnSync.innerHTML = '⏳ Syncing cards & audio...';
            }

            const options = this.getSelectedOptions();
            await this.ankiService.saveLastUsedDeck(options.deckName);

            const res = await this.ankiService.syncToAnki(
                this.currentItems,
                options,
            );

            if (res.success) {
                let msg = `🎉 Added ${res.added} cards to Anki [${res.deckName}]!`;
                if (res.duplicate > 0) {
                    msg += ` (${res.duplicate} duplicate${res.duplicate === 1 ? '' : 's'} skipped)`;
                }
                this.onToast(msg);
                this.hide();
            } else {
                alert(
                    `❌ AnkiConnect sync failed:\n${res.errors.join('\n') || 'Unknown error'}`,
                );
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            alert(`❌ Error connecting to AnkiConnect: ${msg}`);
        } finally {
            if (btnSync) {
                btnSync.disabled = !this.isConnected;
                btnSync.innerHTML = origText;
            }
        }
    }

    private handleTsvDownload(): void {
        try {
            const options = this.getSelectedOptions();
            const res = this.ankiService.exportTsv(
                this.currentItems,
                options,
            );

            if (res.success) {
                this.onToast(`📥 Anki file generated with ${res.added} words!`);
                this.hide();
            } else {
                alert(`❌ Failed to export TSV: ${res.errors.join('\n')}`);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            alert(`❌ Error exporting TSV: ${msg}`);
        }
    }
}
