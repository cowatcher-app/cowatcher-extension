import { VocabWordItem } from '@shared/domain/entities/Vocabulary';

export type ReadingCardPlacement = 'front' | 'back' | 'none';

export interface AnkiExportOptions {
    deckName: string;
    modelName?: string;
    voiceLang?: string;
    enableTts?: boolean;
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
