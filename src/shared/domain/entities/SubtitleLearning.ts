/**
 * Subtitle Learning & Word Tokenization Domain Entities
 */

export interface SubtitleToken {
    id: string; // Unique token identifier within cue (e.g. "c1_t0")
    text: string; // Surface text form (e.g. "食べました", "hello")
    isWordLike: boolean; // True if word/token, false if pure punctuation or whitespace
    index: number; // Character start offset in cue text
    pos?: string; // Part of speech (e.g., "verb", "noun")
    lemma?: string; // Base / dictionary form (e.g. "食べる")
    reading?: string; // Phonetic / kana / pinyin / furigana
    phonetic?: string; // Dedicated phonetic reading storage (zero pollution of text)
    rubyHtml?: string; // Clean pre-rendered ruby representation with isolated <rt>
    meaning?: string; // Quick definition
    isUserMarked?: boolean; // True if saved in user's vocabulary book
}

export interface LearningCueItem {
    cueId: number;
    originalText: string;
    translatedText?: string;
    tokens: SubtitleToken[];
}

export interface WordLookupRequest {
    word: string;
    contextSentence: string;
    contextTranslation?: string;
    sourceLang: string;
    targetLang: string;
    customPrompt?: string; // Optional user prompt injection / guidelines
    preferredRole?: 'vocab' | 'supervisor' | 'translator'; // Preferred LLM role (vocab with fallback to supervisor/translator)
}

export interface WordLookupResult {
    word: string;
    lemma: string; // Dictionary form
    reading: string; // Phonetic/furigana
    pos: string; // Part of speech
    meaning: string; // Definition in target language
    dictMeaning?: string; // 字典解释 (from specialized dict adapter)
    grammarNotes?: string; // Grammatical usage or inflections
    exampleSentence?: string; // Context or dictionary example
    exampleTranslation?: string;
}

/**
 * Domain entity representing an interactive user selection on subtitle text.
 * Encapsulates the contiguous range of tokens, the authentic sliced substring,
 * and the triggering mouse button.
 */
export interface SubtitlePhraseSelection {
    cueId: number;
    startToken: SubtitleToken;
    endToken: SubtitleToken;
    tokens: SubtitleToken[]; // All word-like tokens included in the range
    selectedText: string; // The authentic sliced substring from originalText
    originalText: string; // The full subtitle line context
    translatedText?: string;
    button: 0 | 2; // 0 = left mouse, 2 = right mouse
    anchorEl: HTMLElement; // Anchor element for popover positioning
    tokenElements: HTMLElement[]; // DOM spans of selected tokens
    container?: HTMLElement; // Overlay or player container for popover mounting
}
