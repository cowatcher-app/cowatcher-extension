import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VocabWordItem } from '@shared/domain/entities/Vocabulary';
import { AnkiCard, VocabExportItem } from './ankiTypes';
import { formatWordToCard } from './ankiFormatter';

const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();

vi.mock('@shared/infrastructure/storage/BrowserStorageFactory', () => ({
    BrowserStorageFactory: {
        getStorage: () => ({
            get: mockStorageGet,
            set: mockStorageSet,
        }),
    },
}));

vi.mock('@shared/infrastructure/audio/TtsAudioService', () => ({
    TtsAudioService: {
        fetchAudioBase64: vi.fn().mockResolvedValue(null),
    },
}));

import {
    AnkiService,
    DEFAULT_COWATCHER_BACK,
    DEFAULT_COWATCHER_CSS,
    DEFAULT_COWATCHER_FRONT,
    DEFAULT_COWATCHER_MODEL_NAME,
} from './ankiService';

interface MockAnkiState {
    decks: Set<string>;
    existingNoteWords: Set<string>;
    models: Record<
        string,
        {
            fields: string[];
            css: string;
            templates: Record<string, { Front: string; Back: string }>;
        }
    >;
    addedNotes: Array<Record<string, unknown>>;
    calls: Array<{ action: string; params: Record<string, unknown> }>;
}

function createMockAnkiFetch(state: MockAnkiState) {
    return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}')) as {
            action: string;
            version: number;
            params?: Record<string, unknown>;
        };
        const params = body.params || {};
        state.calls.push({ action: body.action, params });

        const ok = (result: unknown) =>
            new Response(JSON.stringify({ result, error: null }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });

        switch (body.action) {
            case 'version':
                return ok(6);
            case 'deckNames':
                return ok(Array.from(state.decks));
            case 'createDeck': {
                const deck = String(params.deck || '');
                if (deck) state.decks.add(deck);
                return ok(1001);
            }
            case 'canAddNotes': {
                const notes = (params.notes || []) as AnkiCard[];
                const flags = notes.map((n) => {
                    const key = (
                        n.fields.Word ||
                        n.fields.Front ||
                        ''
                    )
                        .trim()
                        .toLowerCase();
                    return !state.existingNoteWords.has(key);
                });
                return ok(flags);
            }
            case 'addNotes': {
                const notes = (params.notes || []) as AnkiCard[];
                const ids = notes.map((n, idx) => {
                    const key = (
                        n.fields.Word ||
                        n.fields.Front ||
                        ''
                    )
                        .trim()
                        .toLowerCase();
                    if (state.existingNoteWords.has(key)) {
                        return null;
                    }
                    state.existingNoteWords.add(key);
                    state.addedNotes.push(n as unknown as Record<string, unknown>);
                    return 2000 + idx;
                });
                return ok(ids);
            }
            case 'modelNames':
                return ok(Object.keys(state.models));
            case 'modelFieldNames': {
                const m = state.models[String(params.modelName || '')];
                return ok(m ? m.fields : []);
            }
            case 'modelTemplates': {
                const m = state.models[String(params.modelName || '')];
                return ok(m ? m.templates : {});
            }
            case 'modelStyling': {
                const m = state.models[String(params.modelName || '')];
                return ok({ css: m ? m.css : '' });
            }
            case 'createModel': {
                const modelName = String(params.modelName || '');
                const inOrderFields = (params.inOrderFields || []) as string[];
                const css = String(params.css || '');
                const cardTemplates = (params.cardTemplates || []) as Array<{
                    Name: string;
                    Front: string;
                    Back: string;
                }>;
                const templates: Record<
                    string,
                    { Front: string; Back: string }
                > = {};
                for (const tpl of cardTemplates) {
                    templates[tpl.Name] = {
                        Front: tpl.Front,
                        Back: tpl.Back,
                    };
                }
                state.models[modelName] = {
                    fields: inOrderFields,
                    css,
                    templates,
                };
                return ok({ id: 3001 });
            }
            case 'updateModelTemplates': {
                const model = params.model as {
                    name: string;
                    templates: Record<string, { Front: string; Back: string }>;
                };
                if (state.models[model.name]) {
                    state.models[model.name].templates = model.templates;
                }
                return ok(null);
            }
            case 'updateModelStyling': {
                const model = params.model as { name: string; css: string };
                if (state.models[model.name]) {
                    state.models[model.name].css = model.css;
                }
                return ok(null);
            }
            default:
                return ok(null);
        }
    });
}

function makeVocabItem(
    word: string,
    overrides?: Partial<VocabWordItem>,
    episodeInfo?: { showTitle?: string; movieId?: string },
): VocabExportItem {
    return {
        word: {
            word,
            pos: 'noun',
            timestamp: 0,
            frequency: 1,
            meaning: `${word} meaning`,
            phonetic: 'phonetic',
            sentence: `Sentence containing ${word}.`,
            sentenceTranslation: '例句翻译',
            sourceLang: 'ja',
            ...overrides,
        },
        episodeInfo: {
            showTitle: 'Tengu no Kitchen',
            movieId: 'ep-01',
            ...episodeInfo,
        },
    };
}

describe('Anki export unit tests (deduplication, deck discovery, styling)', () => {
    let state: MockAnkiState;
    let service: AnkiService;

    beforeEach(() => {
        mockStorageGet.mockReset().mockResolvedValue({});
        mockStorageSet.mockReset().mockResolvedValue(undefined);

        state = {
            decks: new Set(['Default', 'Japanese::Anime']),
            existingNoteWords: new Set(['already-in-anki']),
            models: {
                Basic: {
                    fields: ['Front', 'Back'],
                    css: '.card { color: black; }',
                    templates: {
                        'Card 1': { Front: '{{Front}}', Back: '{{Back}}' },
                    },
                },
            },
            addedNotes: [],
            calls: [],
        };

        vi.stubGlobal('fetch', createMockAnkiFetch(state));
        service = new AnkiService();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('deduplicates local vocab items case-insensitively and prefers user-marked or items with sentences', () => {
        const items: VocabExportItem[] = [
            makeVocabItem('Apple', { source: 'ai', sentence: '' }),
            makeVocabItem('apple', {
                source: 'user',
                sentence: 'I ate an apple.',
            }),
            makeVocabItem('Banana', { source: 'ai', sentence: '' }),
            makeVocabItem('banana', {
                source: 'ai',
                sentence: 'Yellow banana.',
            }),
            makeVocabItem('   ', { source: 'ai' }),
        ];

        const { unique, duplicateCount } = service.deduplicate(items);

        expect(duplicateCount).toBe(2);
        expect(unique).toHaveLength(2);
        expect(unique[0].word.source).toBe('user');
        expect(unique[0].word.sentence).toBe('I ate an apple.');
        expect(unique[1].word.sentence).toBe('Yellow banana.');
    });

    it('deduplicates against AnkiConnect via canAddNotes and only submits new notes', async () => {
        const items: VocabExportItem[] = [
            makeVocabItem('already-in-anki'),
            makeVocabItem('fresh-word'),
        ];

        const res = await service.syncToAnki(items, {
            deckName: 'Japanese::Anime',
            modelName: DEFAULT_COWATCHER_MODEL_NAME,
            enableTts: false,
        });

        expect(res.success).toBe(true);
        expect(res.added).toBe(1);
        expect(res.duplicate).toBe(1);
        expect(res.errors).toEqual([]);
        expect(state.addedNotes).toHaveLength(1);
        expect(
            (state.addedNotes[0] as unknown as AnkiCard).fields.Word,
        ).toBe('fresh-word');
    });

    it('skips addNotes when all notes are already duplicates in Anki', async () => {
        const items: VocabExportItem[] = [makeVocabItem('already-in-anki')];

        const res = await service.syncToAnki(items, {
            deckName: 'Default',
            enableTts: false,
        });

        expect(res.success).toBe(true);
        expect(res.added).toBe(0);
        expect(res.duplicate).toBe(1);
        expect(state.calls.some((c) => c.action === 'addNotes')).toBe(false);
    });

    it('discovers decks from AnkiConnect and falls back safely when Anki is unreachable', async () => {
        const decks = await service.getDeckNames();
        expect(decks).toEqual(['Default', 'Japanese::Anime']);

        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        );
        const fallbackDecks = await service.getDeckNames();
        expect(fallbackDecks).toEqual(['Default', 'CoWatcher']);
    });

    it('creates target deck when syncing to a new deck name and remembers last used deck', async () => {
        const res = await service.syncToAnki([makeVocabItem('komorebi')], {
            deckName: 'CoWatcher::Dramas',
            enableTts: false,
        });

        expect(res.success).toBe(true);
        expect(res.deckName).toBe('CoWatcher::Dramas');
        expect(state.decks.has('CoWatcher::Dramas')).toBe(true);

        await service.saveLastUsedDeck('CoWatcher::Dramas');
        expect(mockStorageSet).toHaveBeenCalledWith({
            ncw_anki_last_deck: 'CoWatcher::Dramas',
        });
    });

    it('creates CoWatcher Vocab model with default CSS/templates when missing, and avoids duplicate creation', async () => {
        const modelName = await service.ensureCoWatcherModel();
        expect(modelName).toBe(DEFAULT_COWATCHER_MODEL_NAME);
        expect(state.models[DEFAULT_COWATCHER_MODEL_NAME]).toBeDefined();
        expect(state.models[DEFAULT_COWATCHER_MODEL_NAME].css).toBe(
            DEFAULT_COWATCHER_CSS,
        );
        expect(
            state.models[DEFAULT_COWATCHER_MODEL_NAME].templates['Card 1'],
        ).toEqual({
            Front: DEFAULT_COWATCHER_FRONT,
            Back: DEFAULT_COWATCHER_BACK,
        });

        const createCallsBefore = state.calls.filter(
            (c) => c.action === 'createModel',
        ).length;
        expect(createCallsBefore).toBe(1);

        // Calling again should detect existing model and skip createModel
        await service.ensureCoWatcherModel();
        const createCallsAfter = state.calls.filter(
            (c) => c.action === 'createModel',
        ).length;
        expect(createCallsAfter).toBe(1);
    });

    it('reads and updates model styling & templates through AnkiConnect', async () => {
        await service.ensureCoWatcherModel();

        const initialCss = await service.getModelStyling(
            DEFAULT_COWATCHER_MODEL_NAME,
        );
        expect(initialCss).toContain('.card-container');

        const updatedCss = '.card { background-color: #000; color: #fff; }';
        const updatedTemplates = {
            'Card 1': {
                Front: '<div>{{Word}}</div>',
                Back: '{{FrontSide}}<hr>{{Meaning}}',
            },
        };

        await service.saveModelTemplatesAndStyle(
            DEFAULT_COWATCHER_MODEL_NAME,
            updatedTemplates,
            updatedCss,
        );

        expect(
            await service.getModelStyling(DEFAULT_COWATCHER_MODEL_NAME),
        ).toBe(updatedCss);
        expect(
            await service.getModelTemplates(DEFAULT_COWATCHER_MODEL_NAME),
        ).toEqual(updatedTemplates);
    });

    it('formats card reading placement styles (front ruby, back reading, none)', () => {
        const wordItem = makeVocabItem('木漏れ日', {
            phonetic: 'こもれび',
            dictMeaning: 'sunlight filtering through trees',
            meaning: '树叶间洒下的阳光',
        });

        const frontRubyCard = formatWordToCard(
            wordItem.word,
            wordItem.episodeInfo,
            {
                deckName: 'Default',
                readingPlacement: 'front',
                formatFurigana: true,
                enableTts: false,
            },
        );
        expect(frontRubyCard.fields.Front).toBe(
            '<ruby>木漏れ日<rt>こもれび</rt></ruby>',
        );
        expect(frontRubyCard.fields.Reading).toBe('こもれび');

        const backCard = formatWordToCard(wordItem.word, wordItem.episodeInfo, {
            deckName: 'Default',
            readingPlacement: 'back',
            enableTts: false,
        });
        expect(backCard.fields.Front).toBe('木漏れ日');
        expect(backCard.fields.Back).toContain('[こもれび]');

        const noneCard = formatWordToCard(wordItem.word, wordItem.episodeInfo, {
            deckName: 'Default',
            readingPlacement: 'none',
            enableTts: false,
        });
        expect(noneCard.fields.Front).toBe('木漏れ日');
        expect(noneCard.fields.Reading).toBe('');
    });
});
