import {
    IDictionaryAdapter,
    PhoneticResult,
} from '../../../domain/phonetic/IPhoneticAdapter';
import { Language } from '../../../domain/value-objects/Language';
import { Logger } from '../../../utils/logger';

export class GeneralDictionaryAdapter implements IDictionaryAdapter {
    readonly languageCode = 'general';
    readonly displayName = 'General Dictionary (Google Translate)';

    private readonly logger = new Logger('GeneralDictionaryAdapter');
    private readonly meaningCache = new Map<string, string>();

    async init(): Promise<void> {
        return Promise.resolve();
    }

    isReady(): boolean {
        return true;
    }

    async getWordReading(
        _word: string,
        _options?: Record<string, unknown>,
    ): Promise<string> {
        return '';
    }

    async getLemma(
        text: string,
        _options?: Record<string, unknown>,
    ): Promise<string> {
        return text;
    }

    async annotateText(
        text: string,
        _options?: Record<string, unknown>,
    ): Promise<PhoneticResult> {
        const clean = (text || '').trim();
        return {
            reading: '',
            rubyHtml: clean,
        };
    }

    async getMeaning(
        word: string,
        targetLang?: string,
        options?: Record<string, unknown>,
    ): Promise<string | null> {
        const clean = (word || '').trim();
        if (!clean) return null;

        const tl = targetLang
            ? Language.resolve(targetLang).googleCode || targetLang
            : 'zh-CN';
        const sl = options?.sourceLang
            ? Language.resolve(String(options.sourceLang)).googleCode ||
              String(options.sourceLang)
            : 'auto';

        const cacheKey = `${clean.toLowerCase()}:${sl}:${tl}`;
        if (this.meaningCache.has(cacheKey)) {
            return this.meaningCache.get(cacheKey)!;
        }

        const urlsToTry = [
            `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
                sl,
            )}&tl=${encodeURIComponent(tl)}&dt=t&dt=bd&q=${encodeURIComponent(clean)}`,
            `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
                sl,
            )}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(clean)}`,
        ];

        for (const url of urlsToTry) {
            for (let attempt = 0; attempt <= 2; attempt++) {
                try {
                    const res = await fetch(url, { method: 'GET' });
                    if (res.status === 429) {
                        // Exponential backoff for Google Translate rate limiting
                        await new Promise((r) =>
                            setTimeout(r, 600 * (attempt + 1)),
                        );
                        continue;
                    }
                    if (!res.ok) {
                        break; // Try next fallback URL if available
                    }

                    const data = await res.json();
                    if (!Array.isArray(data)) break;

                    // Primary translation text
                    let translation = '';
                    if (Array.isArray(data[0])) {
                        translation = data[0]
                            .map((seg: unknown[]) =>
                                Array.isArray(seg) && seg[0]
                                    ? String(seg[0])
                                    : '',
                            )
                            .filter(Boolean)
                            .join('');
                    }

                    // Optional dictionary entries breakdown (e.g. [noun] 地点, 地方; [verb] 放置, 放)
                    let dictTerms = '';
                    if (Array.isArray(data[1])) {
                        dictTerms = data[1]
                            .filter(
                                (entry: unknown[]) =>
                                    Array.isArray(entry) &&
                                    Array.isArray(entry[1]),
                            )
                            .map((entry: [string, string[]]) => {
                                const pos = entry[0] ? `[${entry[0]}] ` : '';
                                const terms = Array.isArray(entry[1])
                                    ? entry[1].slice(0, 4).join(', ')
                                    : '';
                                return `${pos}${terms}`;
                            })
                            .filter(Boolean)
                            .join('; ');
                    }

                    let result = translation.trim();
                    if (
                        dictTerms &&
                        dictTerms.toLowerCase() !== result.toLowerCase()
                    ) {
                        result = `${result} (${dictTerms})`;
                    }

                    if (result) {
                        this.meaningCache.set(cacheKey, result);
                        return result;
                    }
                } catch (err) {
                    if (attempt === 2) {
                        this.logger.warn(
                            'Meaning',
                            `Failed to fetch meaning for "${clean}":`,
                            err,
                        );
                    } else {
                        await new Promise((r) =>
                            setTimeout(r, 400 * (attempt + 1)),
                        );
                    }
                }
            }
        }

        return null;
    }
}
