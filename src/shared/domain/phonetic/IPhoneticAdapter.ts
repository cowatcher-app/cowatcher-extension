/**
 * Domain entity and interfaces for language-specific phonetic and pronunciation adapters.
 * Provides deterministic phonetic reading extraction, furigana / pinyin annotation,
 * and ruby HTML formatting without polluting the raw source text.
 */

export interface PhoneticAnnotation {
    /** Surface text fragment (e.g. "社員", "好") */
    surface: string;
    /** Phonetic transcription (e.g. "しゃいん", "hǎo") */
    reading: string;
    /** True if the segment contains ideographic characters (kanji/hanzi) that received annotation */
    hasPhonetic: boolean;
}

export interface PhoneticResult {
    /** Clean normalized reading (hiragana for Japanese, pinyin for Chinese) */
    reading: string;
    /** Pre-rendered Ruby HTML string with isolated <rt> tags */
    rubyHtml?: string;
    /** Segment-by-segment phonetic breakdown */
    annotations?: PhoneticAnnotation[];
}

export interface IDictionaryAdapter {
    /** Primary language identifier (e.g., 'ja', 'zh') */
    readonly languageCode: string;

    /** Human-readable adapter name */
    readonly displayName: string;

    /** Asynchronously initialize resources (e.g. Kuromoji dictionary files) */
    init(): Promise<void>;

    /** Checks whether the engine is initialized and ready for synchronous or fast lookups */
    isReady(): boolean;

    /**
     * Resolves reading / pronunciation for a single dictionary headword or short phrase.
     * Guaranteed to return pure reading string without HTML tags or formatting.
     */
    getWordReading(
        word: string,
        options?: Record<string, unknown>,
    ): Promise<string>;

    /**
     * Extracts the base lemma (dictionary / root form) for the given word or phrase.
     * For languages without morphological lemmatization, returns the input text as-is.
     */
    getLemma(text: string, options?: Record<string, unknown>): Promise<string>;

    /**
     * Resolves dictionary meaning / definition for the given headword or phrase.
     * Returns string definition if available in language adapter dictionary, or null if unsupported.
     */
    getMeaning(
        word: string,
        targetLang?: string,
        options?: Record<string, unknown>,
    ): Promise<string | null>;

    /**
     * Annotates a complete sentence or phrase, generating ruby HTML and structured segments.
     */
    annotateText(
        text: string,
        options?: Record<string, unknown>,
    ): Promise<PhoneticResult>;
}

/**
 * Normalizes varied language tags into a canonical two-letter code for phonetic registry lookup.
 * e.g., "ja-JP", "ja_JP", "japanese", "jpn" -> "ja"
 *       "zh-CN", "zh-TW", "chinese", "cmn" -> "zh"
 */
export function normalizeLanguageCode(lang: string | undefined | null): string {
    if (!lang) return '';
    const clean = String(lang).toLowerCase().trim().replace(/_/g, '-');
    if (clean.startsWith('ja') || clean.includes('japan')) {
        return 'ja';
    }
    if (
        clean.startsWith('zh') ||
        clean.includes('chinese') ||
        clean.startsWith('cmn')
    ) {
        return 'zh';
    }
    if (clean.startsWith('ko') || clean.includes('korean')) {
        return 'ko';
    }
    if (clean.startsWith('en') || clean.includes('english')) {
        return 'en';
    }
    if (clean.startsWith('es') || clean.includes('spanish')) {
        return 'es';
    }
    if (clean === 'general') {
        return 'general';
    }
    return clean.split('-')[0];
}
