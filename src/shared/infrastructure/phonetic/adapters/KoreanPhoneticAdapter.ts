import { romanize } from 'romaja';
import {
    IDictionaryAdapter,
    PhoneticResult,
} from '../../../domain/phonetic/IPhoneticAdapter';
import { Language } from '../../../domain/value-objects/Language';
import { Logger } from '../../../utils/logger';

export type KoreanPhoneticSystem = 'default' | 'hyphenated';

export class KoreanPhoneticAdapter implements IDictionaryAdapter {
    readonly languageCode = 'ko';
    readonly displayName = 'Korean Phonetic (Revised Romanization)';

    private readonly logger = new Logger('KoreanPhoneticAdapter');
    private phoneticSystem: KoreanPhoneticSystem = 'default';

    setPhoneticSystem(system: KoreanPhoneticSystem): void {
        this.phoneticSystem =
            system === 'hyphenated' ? 'hyphenated' : 'default';
    }

    getPhoneticSystem(): KoreanPhoneticSystem {
        return this.phoneticSystem;
    }

    async init(): Promise<void> {
        // Pure synchronous rules in romaja, ready instantly
        return Promise.resolve();
    }

    isReady(): boolean {
        return true;
    }

    /**
     * Resolves reading / pronunciation for a single word or short phrase.
     * Conforms to National Institute of Korean Language Revised Romanization standard.
     * Supports both continuous (default) and syllable hyphenated (e.g. beo-reo-jyeot-seum-ni-da) modes.
     */
    async getWordReading(
        word: string,
        options?: Record<string, unknown>,
    ): Promise<string> {
        const clean = (word || '').trim();
        if (!clean) return '';

        const system =
            (options?.system as KoreanPhoneticSystem) || this.phoneticSystem;
        const hyphenate = system === 'hyphenated';

        try {
            return romanize(clean, { hyphenate });
        } catch (err) {
            this.logger.warn(
                'Reading',
                `Failed to get Korean reading for "${word}":`,
                err,
            );
            return '';
        }
    }

    async getLemma(text: string): Promise<string> {
        return text;
    }

    private readonly meaningCache = new Map<string, string>();

    async getMeaning(
        word: string,
        targetLang?: string,
        _options?: Record<string, unknown>,
    ): Promise<string | null> {
        const clean = (word || '').trim();
        if (!clean) return null;

        const tl = targetLang
            ? Language.resolve(targetLang).code.toLowerCase()
            : '';
        const isChinese = tl.startsWith('zh');

        // Only handle Chinese targets; other languages fall back to GeneralDictionaryAdapter or LLM
        if (!isChinese) {
            return null;
        }

        const cacheKey = `zh:${clean.toLowerCase()}`;
        if (this.meaningCache.has(cacheKey)) {
            return this.meaningCache.get(cacheKey)!;
        }

        try {
            const url = `https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=ko&q=${encodeURIComponent(
                clean,
            )}`;
            const res = await fetch(url, { method: 'GET' });
            if (!res.ok) return null;

            const json = (await res.json()) as {
                result?: { code?: number };
                data?: {
                    entries?: Array<{
                        entry?: string;
                        explain?: string;
                    }>;
                };
            };

            if (
                json?.data?.entries &&
                Array.isArray(json.data.entries) &&
                json.data.entries.length > 0
            ) {
                // Find matching entry or take the first entry
                const entry =
                    json.data.entries.find(
                        (e) =>
                            e.entry?.toLowerCase() === clean.toLowerCase(),
                    ) || json.data.entries[0];

                if (entry && entry.explain) {
                    const meaning = entry.explain.trim();
                    this.meaningCache.set(cacheKey, meaning);
                    return meaning;
                }
            }
        } catch (err) {
            this.logger.warn(
                'Meaning',
                `Failed to fetch Korean-Chinese meaning for "${clean}":`,
                err,
            );
        }

        return null;
    }

    async annotateText(
        text: string,
        options?: Record<string, unknown>,
    ): Promise<PhoneticResult> {
        const clean = (text || '').trim();
        if (!clean) {
            return { reading: '', rubyHtml: '' };
        }

        const system =
            (options?.system as KoreanPhoneticSystem) || this.phoneticSystem;
        const hyphenate = system === 'hyphenated';

        try {
            const readingStr = romanize(clean, { hyphenate });
            return {
                reading: readingStr,
                rubyHtml: `<ruby>${clean}<rt style="user-select: none; -webkit-user-select: none; pointer-events: none;" class="ncw-token-phonetic">${readingStr}</rt></ruby>`,
            };
        } catch (err) {
            this.logger.warn(
                'Annotate',
                `Failed to annotate Korean text "${clean}":`,
                err,
            );
            return { reading: clean, rubyHtml: clean };
        }
    }
}
