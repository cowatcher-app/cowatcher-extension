import lemmatizer from 'wink-lemmatizer';
import {
    IDictionaryAdapter,
    PhoneticResult,
} from '../../../domain/phonetic/IPhoneticAdapter';
import { Logger } from '../../../utils/logger';

export class EnglishPhoneticAdapter implements IDictionaryAdapter {
    readonly languageCode = 'en';
    readonly displayName = 'English (IPA & Lemmatizer)';

    private readonly logger = new Logger('EnglishPhoneticAdapter');
    private readingCache: Map<string, string> = new Map();

    async init(): Promise<void> {
        return Promise.resolve();
    }

    isReady(): boolean {
        return true;
    }

    /**
     * Extracts base lemma (root / dictionary form) for English words or phrases.
     * For multi-word phrases, preserves the whole phrase intact.
     * For single words, uses wink-lemmatizer (verb -> noun -> adjective) and adverb rule normalization.
     */
    async getLemma(
        text: string,
        _options?: Record<string, unknown>,
    ): Promise<string> {
        const clean = (text || '').trim();
        if (!clean) return '';

        // If multi-word phrase, keep the entire phrase intact
        if (clean.includes(' ')) {
            return clean;
        }

        const w = clean.toLowerCase();

        // Try verb lemmatization (handles -ed, -ing, irregular verbs like went -> go)
        const v = lemmatizer.verb(w);
        if (v && v !== w) return v;

        // Try noun lemmatization (handles plurals like candies -> candy, cats -> cat)
        const n = lemmatizer.noun(w);
        if (n && n !== w) return n;

        // Try adjective lemmatization (handles better -> good, faster -> fast)
        const a = lemmatizer.adjective(w);
        if (a && a !== w) return a;

        // Adverb rule normalization (handles maniacally -> maniacal, happily -> happy, quickly -> quick)
        if (w.endsWith('ally') && w.length > 5) {
            return w.slice(0, -2);
        }
        if (w.endsWith('ly') && w.length > 4) {
            if (w.endsWith('ily')) return w.slice(0, -3) + 'y';
            return w.slice(0, -2);
        }

        return clean;
    }

    async getMeaning(
        _word: string,
        _targetLang?: string,
    ): Promise<string | null> {
        return null;
    }

    /**
     * Resolves IPA phonetic transcription for English words.
     * Checks lemmas first, queries Free Dictionary API or local cache.
     */
    async getWordReading(
        word: string,
        options?: Record<string, unknown>,
    ): Promise<string> {
        const clean = (word || '').trim();
        if (!clean) return '';

        const normalized = clean.toLowerCase();
        if (this.readingCache.has(normalized)) {
            return this.readingCache.get(normalized)!;
        }

        // 1. Get lemma first to maximize dictionary API hits
        let queryWord = normalized;
        const lemma = await this.getLemma(clean, options);
        if (lemma && !lemma.includes(' ')) {
            queryWord = lemma.toLowerCase();
        }

        if (this.readingCache.has(queryWord)) {
            const cached = this.readingCache.get(queryWord)!;
            this.readingCache.set(normalized, cached);
            return cached;
        }

        // 2. Fetch IPA from Free Dictionary API
        try {
            const wordsToTry =
                queryWord !== normalized
                    ? [queryWord, normalized]
                    : [queryWord];
            for (const target of wordsToTry) {
                const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(target)}`;
                const res = await fetch(url);
                if (!res.ok) continue;

                const data = await res.json();
                if (!Array.isArray(data) || data.length === 0) continue;

                let ipa = '';
                const entry = data[0];
                if (entry.phonetic) {
                    ipa = String(entry.phonetic);
                } else if (Array.isArray(entry.phonetics)) {
                    for (const p of entry.phonetics) {
                        if (p && p.text) {
                            ipa = String(p.text);
                            break;
                        }
                    }
                }

                if (ipa) {
                    // Clean enclosing slashes/brackets
                    const cleanIpa = ipa.replace(/^[/[]+|[/\]]+$/g, '').trim();
                    this.readingCache.set(target, cleanIpa);
                    this.readingCache.set(normalized, cleanIpa);
                    return cleanIpa;
                }
            }
        } catch (err) {
            this.logger.warn(
                'Reading',
                `Failed to query IPA for "${clean}":`,
                err,
            );
        }

        return '';
    }

    /**
     * For English, we do not annotate video subtitles with ruby phonetics.
     * Subtitles remain clean and unaffected.
     */
    async annotateText(
        text: string,
        _options?: Record<string, unknown>,
    ): Promise<PhoneticResult> {
        const clean = (text || '').trim();
        return {
            reading: '',
            rubyHtml: clean,
            annotations: [{ surface: clean, reading: '', hasPhonetic: false }],
        };
    }
}
