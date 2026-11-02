import { VocabWordItem } from '@shared/domain/entities/Vocabulary';

export type ReadingCardPlacement = 'front' | 'back' | 'none';

export type AnkiTtsMode = 'edge' | 'native' | 'awesome' | 'none';

export type CoWatcherFieldKey =
    | 'Word'
    | 'Reading'
    | 'Meaning'
    | 'POS'
    | 'Sentence'
    | 'SentenceTranslation'
    | 'Audio'
    | 'Notes';

export type AnkiFieldMapping = Partial<Record<CoWatcherFieldKey, string>>;

export interface AnkiExportOptions {
    deckName: string;
    modelName?: string;
    fieldMapping?: AnkiFieldMapping;
    voiceLang?: string;
    enableTts?: boolean;
    ttsMode?: AnkiTtsMode;
    formatFurigana?: boolean;
    readingPlacement?: ReadingCardPlacement;
    tags?: string[];
}

export interface AnkiCardFieldMap {
    Front: string;
    Back: string;
    Reading?: string;
    Audio?: string;
    Sentence?: string;
    SentenceTranslation?: string;
    Meaning?: string;
    Notes?: string;
    [key: string]: string | undefined;
}

export interface AnkiCard {
    deckName: string;
    modelName: string;
    fields: AnkiCardFieldMap;
    tags: string[];
}

export interface AnkiExportResult {
    success: boolean;
    added: number;
    duplicate: number;
    errors: string[];
    deckName: string;
}

export interface VocabExportItem {
    word: VocabWordItem;
    episodeInfo: { showTitle?: string; movieId?: string };
}
