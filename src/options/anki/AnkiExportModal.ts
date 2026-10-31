import { AnkiService } from './ankiService';
import { AnkiExportOptions, VocabExportItem } from './ankiTypes';

export class AnkiExportModal {
    private modalEl: HTMLElement | null = null;
    private currentItems: VocabExportItem[] = [];
    private isConnected: boolean = false;

    constructor(
        private readonly ankiService: AnkiService,
        private readonly onToast: (message: string) => void,
    ) {
        this.init();
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
    }

    async show(
        items: VocabExportItem[],
        defaultLanguage: string = 'ja_JP',
    ): Promise<void> {
        if (!this.modalEl) return;
        this.currentItems = items;

        const countEl = document.getElementById('anki-modal-item-count');
        const statusBadge = document.getElementById('anki-status-badge');
        const deckSelect = document.getElementById(
            'anki-deck-select',
        ) as HTMLSelectElement | null;
        const customDeckInput = document.getElementById(
            'anki-custom-deck-input',
        ) as HTMLInputElement | null;
        const voiceSelect = document.getElementById(
            'anki-voice-select',
        ) as HTMLSelectElement | null;
        const btnSync = document.getElementById(
            'btn-anki-modal-sync',
        ) as HTMLButtonElement | null;

        // Deduplicate summary
        const deduped = this.ankiService.deduplicate(items);
        if (countEl) {
            countEl.textContent = `${deduped.unique.length} unique words (${deduped.duplicateCount} duplicate${deduped.duplicateCount === 1 ? '' : 's'} merged)`;
        }

        // Voice language
        if (voiceSelect) {
            const lang = defaultLanguage.toLowerCase();
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

        // Set status to checking
        if (statusBadge) {
            statusBadge.className = 'status-pill checking';
            statusBadge.innerHTML = '🔄 Checking AnkiConnect...';
        }
        if (btnSync) {
            btnSync.disabled = true;
            btnSync.title = 'Checking AnkiConnect connection...';
        }

        // Reset custom input
        if (customDeckInput) {
            customDeckInput.value = '';
            customDeckInput.style.display = 'none';
        }

        // Restore saved reading placement preference
        const placementSelect = document.getElementById(
            'anki-reading-placement-select',
        ) as HTMLSelectElement | null;
        if (placementSelect) {
            const savedPlacement = localStorage.getItem('ncw_anki_reading_placement');
            if (savedPlacement) {
                placementSelect.value = savedPlacement;
            }
        }

        this.modalEl.style.display = 'flex';

        // Check AnkiConnect connectivity & load decks
        const lastDeck = await this.ankiService.getLastUsedDeck();
        const available = await this.ankiService.isConnectAvailable();
        this.isConnected = available;

        if (statusBadge) {
            if (available) {
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

        if (deckSelect) {
            deckSelect.innerHTML = '';
            let deckNames: string[] = ['CoWatcher', 'Default'];

            if (available) {
                try {
                    deckNames = await this.ankiService.getDeckNames();
                } catch {
                    // Fallback to default
                }
            }

            if (!deckNames.includes('CoWatcher')) {
                deckNames.unshift('CoWatcher');
            }
            if (lastDeck && !deckNames.includes(lastDeck)) {
                deckNames.unshift(lastDeck);
            }

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
    }

    hide(): void {
        if (this.modalEl) {
            this.modalEl.style.display = 'none';
        }
        this.currentItems = [];
    }

    private getSelectedOptions(): AnkiExportOptions {
        const deckSelect = document.getElementById(
            'anki-deck-select',
        ) as HTMLSelectElement | null;
        const customDeckInput = document.getElementById(
            'anki-custom-deck-input',
        ) as HTMLInputElement | null;
        const voiceSelect = document.getElementById(
            'anki-voice-select',
        ) as HTMLSelectElement | null;
        const ttsCheck = document.getElementById(
            'anki-tts-check',
        ) as HTMLInputElement | null;
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

        const readingPlacement = (placementSelect?.value as 'front' | 'back' | 'none') || 'front';
        try {
            localStorage.setItem('ncw_anki_reading_placement', readingPlacement);
        } catch {
            // ignore
        }

        return {
            deckName,
            voiceLang: voiceSelect?.value || 'ja_JP',
            enableTts: ttsCheck?.checked !== false,
            formatFurigana: furiganaCheck?.checked !== false,
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
                btnSync.innerHTML = '⏳ Syncing...';
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
