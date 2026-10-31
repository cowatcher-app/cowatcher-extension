/**
 * Individual vocabulary word item extracted from subtitle dialogues.
 */
export interface VocabWordItem {
    word: string;
    lemma?: string;
    dictMeaning?: string;
    pos: string;
    phonetic: string;
    meaning: string;
    sentence: string;
    sentenceTranslation: string;
    timestamp: number;
    frequency: number;
    source?: 'user' | 'ai';
    createdAt?: number;
    sourceLang?: string; // Captured language snapshot at time of collection
    targetLang?: string; // Captured language snapshot at time of collection
}

/**
 * Aggregated episode-level vocabulary dataset stored in browser storage.
 */
export interface EpisodeVocabData {
    movieId: string;
    showTitle: string;
    sourceLanguage: string;
    targetLanguage: string;
    difficulty: string;
    customPrompt: string;
    model: string;
    updatedAt: number;
    totalWords?: number;
    words: VocabWordItem[];
}
