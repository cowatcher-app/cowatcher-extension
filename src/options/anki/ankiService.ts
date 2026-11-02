import { AnkiConnectClient } from './ankiClient';
import {
    AnkiExportOptions,
    AnkiExportResult,
    VocabExportItem,
} from './ankiTypes';
import {
    deduplicateVocabItems,
    downloadTsvFile,
    formatCardsToTsv,
    formatWordToCard,
} from './ankiFormatter';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { TtsAudioService } from '@shared/infrastructure/audio/TtsAudioService';

const LAST_DECK_STORAGE_KEY = 'ncw_anki_last_deck';

export const DEFAULT_COWATCHER_MODEL_NAME = 'CoWatcher Vocab';

export const DEFAULT_COWATCHER_FRONT = `<div class="card-container">
  <div class="word-header">
    <div class="word">{{Word}}</div>
    {{#Audio}}<div class="audio-btn">{{Audio}}</div>{{/Audio}}
  </div>
  {{#Sentence}}
  <div class="sentence-box">
    {{Sentence}}
  </div>
  {{/Sentence}}
</div>`;

export const DEFAULT_COWATCHER_BACK = `{{FrontSide}}

<hr id="answer">

<div class="card-container answer-side">
  {{#Reading}}
  <div class="reading">[{{Reading}}]</div>
  {{/Reading}}

  {{#POS}}
  <span class="pos-badge">{{POS}}</span>
  {{/POS}}

  <div class="meaning">
    {{Meaning}}
  </div>

  {{#SentenceTranslation}}
  <div class="translation-box">
    {{SentenceTranslation}}
  </div>
  {{/SentenceTranslation}}

  {{#Notes}}
  <div class="notes-footer">
    📺 {{Notes}}
  </div>
  {{/Notes}}
</div>`;

export const DEFAULT_COWATCHER_CSS = `.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 16px;
  text-align: center;
  color: #f1f5f9;
  background-color: #0f172a;
  padding: 18px;
}
.card-container {
  max-width: 520px;
  margin: 0 auto;
  text-align: left;
}
.word-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.word {
  font-size: 28px;
  font-weight: 700;
  color: #38bdf8;
}
.audio-btn {
  font-size: 18px;
}
.sentence-box {
  background: rgba(255, 255, 255, 0.05);
  border-left: 3px solid #38bdf8;
  padding: 10px 14px;
  border-radius: 4px;
  font-size: 15px;
  line-height: 1.5;
  color: #e2e8f0;
}
.sentence-box b {
  color: #38bdf8;
  text-decoration: underline;
}
.reading {
  font-size: 17px;
  font-weight: 600;
  color: #a855f7;
  margin-bottom: 8px;
}
.pos-badge {
  display: inline-block;
  font-size: 11px;
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  padding: 2px 8px;
  border-radius: 4px;
  margin-bottom: 8px;
}
.meaning {
  font-size: 17px;
  font-weight: 500;
  color: #10b981;
  line-height: 1.5;
  margin-bottom: 12px;
}
.translation-box {
  font-size: 13.5px;
  color: #94a3b8;
  line-height: 1.4;
  margin-bottom: 10px;
}
.notes-footer {
  font-size: 11px;
  color: #64748b;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
  padding-top: 8px;
  margin-top: 10px;
}
hr#answer {
  border: 0;
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 16px 0;
}`;

export class AnkiService {
    private readonly client = new AnkiConnectClient();
    private readonly storage = BrowserStorageFactory.getStorage();

    async isConnectAvailable(): Promise<boolean> {
        return this.client.isAvailable();
    }

    async getDeckNames(): Promise<string[]> {
        try {
            return await this.client.getDeckNames();
        } catch {
            return ['Default', 'CoWatcher'];
        }
    }

    async getLastUsedDeck(): Promise<string> {
        try {
            const data = await this.storage.get<string>(LAST_DECK_STORAGE_KEY);
            return (data && data[LAST_DECK_STORAGE_KEY]) || 'CoWatcher';
        } catch {
            return 'CoWatcher';
        }
    }

    async saveLastUsedDeck(deckName: string): Promise<void> {
        if (!deckName) return;
        try {
            await this.storage.set({ [LAST_DECK_STORAGE_KEY]: deckName });
        } catch {
            // Ignore storage errors
        }
    }

    deduplicate(items: VocabExportItem[]): {
        unique: VocabExportItem[];
        duplicateCount: number;
    } {
        return deduplicateVocabItems(items);
    }

    /**
     * Direct HTTP sync to Anki via AnkiConnect.
     */
    async syncToAnki(
        items: VocabExportItem[],
        options: AnkiExportOptions,
    ): Promise<AnkiExportResult> {
        const deckName = options.deckName.trim() || 'CoWatcher';
        const result: AnkiExportResult = {
            success: false,
            added: 0,
            duplicate: 0,
            errors: [],
            deckName,
        };

        if (items.length === 0) {
            result.errors.push('No vocabulary items provided');
            return result;
        }

        const isAvailable = await this.client.isAvailable();
        if (!isAvailable) {
            result.errors.push(
                'AnkiConnect is not reachable at http://127.0.0.1:8765',
            );
            return result;
        }

        // 1. Ensure deck exists
        try {
            await this.client.createDeck(deckName);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            result.errors.push(`Failed to verify or create deck: ${msg}`);
        }

        // 2. Audio pre-fetching & media storage if Edge TTS mode is enabled
        const audioMap = new Map<string, string>();
        if (options.enableTts && options.ttsMode === 'edge') {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const rawWord = item.word.word.trim();
                if (!rawWord) continue;
                const voiceLang =
                    item.word.sourceLang || options.voiceLang || 'ja_JP';
                try {
                    const audioBase64 = await TtsAudioService.fetchAudioBase64(
                        rawWord,
                        voiceLang,
                    );
                    if (audioBase64) {
                        const safeWord = rawWord
                            .replace(/[^\w\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, '_')
                            .slice(0, 20);
                        const filename = `cowatcher_${voiceLang}_${safeWord}_${Date.now()}_${i}.mp3`;
                        await this.client.storeMediaFile(filename, audioBase64);
                        audioMap.set(`${i}_${rawWord}`, filename);
                    }
                } catch {
                    // Gracefully continue without audio if media storage or fetch fails
                }
            }
        }

        // 3. Format cards
        const notes = items.map((item, idx) => {
            const rawWord = item.word.word.trim();
            const filename = audioMap.get(`${idx}_${rawWord}`);
            return formatWordToCard(item.word, item.episodeInfo, options, filename);
        });

        // 4. Deduplicate check with Anki
        let canAddFlags: boolean[] = [];
        try {
            canAddFlags = await this.client.canAddNotes(notes);
        } catch {
            canAddFlags = notes.map(() => true);
        }

        const notesToAdd = notes.filter((_, idx) => canAddFlags[idx] !== false);
        const dupCount = notes.length - notesToAdd.length;
        result.duplicate += dupCount;

        if (notesToAdd.length === 0) {
            result.success = true;
            return result;
        }

        // 4. Batch add notes to Anki
        try {
            const addedIds = await this.client.addNotes(notesToAdd);
            let addedCount = 0;
            let failedOrDup = 0;

            addedIds.forEach((id) => {
                if (typeof id === 'number') {
                    addedCount++;
                } else {
                    failedOrDup++;
                }
            });

            result.added = addedCount;
            result.duplicate += failedOrDup;
            result.success = addedCount > 0 || result.duplicate > 0;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            result.errors.push(`Failed to add notes to Anki: ${msg}`);
        }

        return result;
    }

    /**
     * Generate standard Anki TSV file and trigger browser download.
     */
    exportTsv(
        items: VocabExportItem[],
        options: AnkiExportOptions,
    ): AnkiExportResult {
        const deckName = options.deckName.trim() || 'CoWatcher';
        const result: AnkiExportResult = {
            success: false,
            added: 0,
            duplicate: 0,
            errors: [],
            deckName,
        };

        if (items.length === 0) {
            result.errors.push('No vocabulary items provided');
            return result;
        }

        try {
            const cards = items.map((item) =>
                formatWordToCard(item.word, item.episodeInfo, options),
            );
            const tsvContent = formatCardsToTsv(cards);
            const cleanDeck = deckName
                .replace(/[^\w\s\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af-]/g, '')
                .trim()
                .replace(/\s+/g, '_');
            const filename = `anki_${cleanDeck || 'vocab'}_${cards.length}_cards.tsv`;

            downloadTsvFile(tsvContent, filename);

            result.success = true;
            result.added = items.length;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            result.errors.push(`Failed to generate TSV file: ${msg}`);
        }

        return result;
    }

    async getModelNames(): Promise<string[]> {
        try {
            return await this.client.getModelNames();
        } catch {
            return [DEFAULT_COWATCHER_MODEL_NAME, 'Basic'];
        }
    }

    async getModelFieldNames(modelName: string): Promise<string[]> {
        try {
            return await this.client.getModelFieldNames(modelName);
        } catch {
            return [
                'Word',
                'Reading',
                'Meaning',
                'POS',
                'Sentence',
                'SentenceTranslation',
                'Audio',
                'Notes',
            ];
        }
    }

    async getModelTemplates(
        modelName: string,
    ): Promise<Record<string, { Front: string; Back: string }>> {
        try {
            return await this.client.getModelTemplates(modelName);
        } catch {
            return {
                'Card 1': {
                    Front: DEFAULT_COWATCHER_FRONT,
                    Back: DEFAULT_COWATCHER_BACK,
                },
            };
        }
    }

    async getModelStyling(modelName: string): Promise<string> {
        try {
            const res = await this.client.getModelStyling(modelName);
            return res.css || DEFAULT_COWATCHER_CSS;
        } catch {
            return DEFAULT_COWATCHER_CSS;
        }
    }

    async saveModelTemplatesAndStyle(
        modelName: string,
        templates: Record<string, { Front: string; Back: string }>,
        css: string,
    ): Promise<void> {
        await this.client.updateModelTemplates({
            name: modelName,
            templates,
        });
        await this.client.updateModelStyling({
            name: modelName,
            css,
        });
    }

    async ensureCoWatcherModel(): Promise<string> {
        try {
            const models = await this.client.getModelNames();
            if (models.includes(DEFAULT_COWATCHER_MODEL_NAME)) {
                return DEFAULT_COWATCHER_MODEL_NAME;
            }

            await this.client.createModel({
                modelName: DEFAULT_COWATCHER_MODEL_NAME,
                inOrderFields: [
                    'Word',
                    'Reading',
                    'Meaning',
                    'POS',
                    'Sentence',
                    'SentenceTranslation',
                    'Audio',
                    'Notes',
                ],
                css: DEFAULT_COWATCHER_CSS,
                cardTemplates: [
                    {
                        Name: 'Card 1',
                        Front: DEFAULT_COWATCHER_FRONT,
                        Back: DEFAULT_COWATCHER_BACK,
                    },
                ],
            });
            return DEFAULT_COWATCHER_MODEL_NAME;
        } catch {
            return DEFAULT_COWATCHER_MODEL_NAME;
        }
    }
}
