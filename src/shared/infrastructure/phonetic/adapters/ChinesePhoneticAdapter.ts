import { pinyin, html } from 'pinyin-pro';
import { pinyinToZhuyin } from 'pinyin-zhuyin';
import {
    IDictionaryAdapter,
    PhoneticResult,
} from '../../../domain/phonetic/IPhoneticAdapter';
import { Language } from '../../../domain/value-objects/Language';
import { Logger } from '../../../utils/logger';
import taiwanZhuyinData from '../data/taiwanZhuyinDict.json';

export type ChinesePhoneticSystem = 'pinyin' | 'zhuyin';

const taiwanZhuyinDict = taiwanZhuyinData as Record<string, string>;

export class ChinesePhoneticAdapter implements IDictionaryAdapter {
    readonly languageCode = 'zh';
    readonly displayName = 'Chinese Phonetic (Pinyin / Zhuyin)';

    private readonly logger = new Logger('ChinesePhoneticAdapter');
    private phoneticSystem: ChinesePhoneticSystem = 'pinyin';

    setPhoneticSystem(system: ChinesePhoneticSystem): void {
        this.phoneticSystem = system === 'zhuyin' ? 'zhuyin' : 'pinyin';
    }

    getPhoneticSystem(): ChinesePhoneticSystem {
        return this.phoneticSystem;
    }

    async init(): Promise<void> {
        // Pure synchronous dictionaries (pinyin-pro & taiwanZhuyinDict), ready instantly
        return Promise.resolve();
    }

    isReady(): boolean {
        return true;
    }

    /**
     * Resolves reading / pronunciation for a single word or short phrase.
     * When configured or requested as 'zhuyin', strictly conforms to Taiwan Ministry of Education (MOE) standards.
     */
    async getWordReading(
        word: string,
        options?: Record<string, unknown>,
    ): Promise<string> {
        const clean = (word || '').trim();
        if (!clean) return '';

        const system =
            (options?.system as ChinesePhoneticSystem) || this.phoneticSystem;

        if (system === 'zhuyin') {
            return this.getZhuyinReading(clean);
        }
        return this.getPinyinReading(clean);
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

        let le: string;
        if (tl === 'en' || tl.startsWith('en')) {
            le = 'eng';
        } else if (tl === 'ja' || tl.startsWith('ja')) {
            le = 'jap';
        } else if (tl === 'ko' || tl.startsWith('ko')) {
            le = 'ko';
        } else {
            // Target is not English, Japanese, or Korean: fallback to GeneralDictionaryAdapter or LLM
            return null;
        }

        const cacheKey = `${le}:${clean.toLowerCase()}`;
        if (this.meaningCache.has(cacheKey)) {
            return this.meaningCache.get(cacheKey)!;
        }

        try {
            const url = `https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=${le}&q=${encodeURIComponent(
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
                // Find entry exactly matching headword or pick the first entry with explanation
                const entry =
                    json.data.entries.find(
                        (e) =>
                            e.entry?.toLowerCase() === clean.toLowerCase() &&
                            Boolean(e.explain),
                    ) ||
                    json.data.entries.find((e) => Boolean(e.explain)) ||
                    json.data.entries[0];

                if (entry && entry.explain) {
                    const meaning = entry.explain.trim();
                    this.meaningCache.set(cacheKey, meaning);
                    return meaning;
                }
            }
        } catch (err) {
            this.logger.warn(
                'Meaning',
                `Failed to fetch Chinese-${le} meaning for "${clean}":`,
                err,
            );
        }

        return null;
    }

    private getPinyinReading(word: string): string {
        try {
            const result = pinyin(word, {
                toneType: 'symbol',
                type: 'string',
            });
            return (result || '').trim();
        } catch (err) {
            this.logger.warn(
                'Reading',
                `Failed to get pinyin for "${word}":`,
                err,
            );
            return '';
        }
    }

    /**
     * Resolves Taiwan standard Zhuyin reading.
     * 1. Exact match in Taiwan MOE heteronym / standard dictionary.
     * 2. Sub-segment lookup for compound words (e.g. 下星期 -> 下 + 星期).
     * 3. Fallback to pinyinToZhuyin conversion with normalized light tone markers.
     */
    private getZhuyinReading(word: string): string {
        if (!word) return '';

        // 1. Exact match in Taiwan MOE dictionary
        if (taiwanZhuyinDict[word]) {
            return taiwanZhuyinDict[word];
        }

        // 2. Sub-segment matching for compound words (e.g. "扔垃圾", "下星期")
        if (word.length > 2) {
            for (let len = word.length - 1; len >= 2; len--) {
                for (let i = 0; i <= word.length - len; i++) {
                    const sub = word.slice(i, i + len);
                    if (taiwanZhuyinDict[sub]) {
                        const prefix = word.slice(0, i);
                        const suffix = word.slice(i + len);
                        const prefixBpmf = prefix
                            ? this.getZhuyinReading(prefix)
                            : '';
                        const suffixBpmf = suffix
                            ? this.getZhuyinReading(suffix)
                            : '';
                        return [prefixBpmf, taiwanZhuyinDict[sub], suffixBpmf]
                            .filter(Boolean)
                            .join(' ');
                    }
                }
            }
        }

        // 3. Fall back to pinyin-pro conversion to Zhuyin
        try {
            const py = pinyin(word, {
                toneType: 'symbol',
                type: 'string',
            });
            const rawZhuyin = pinyinToZhuyin(py)
                .replace(/[\s\u3000]+/g, ' ')
                .trim();
            // Normalize light-tone dot position to leading dot (˙ㄌㄜ, ˙ㄇㄣ, ˙ㄉㄜ)
            return rawZhuyin.replace(/([ㄅ-ㄩ]+)˙/g, '˙$1');
        } catch {
            return '';
        }
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
            (options?.system as ChinesePhoneticSystem) || this.phoneticSystem;

        if (system === 'zhuyin') {
            const readingStr = this.getZhuyinReading(clean);
            return {
                reading: readingStr,
                rubyHtml: `<ruby>${clean}<rt style="user-select: none; -webkit-user-select: none; pointer-events: none;" class="ncw-token-phonetic">${readingStr}</rt></ruby>`,
            };
        }

        try {
            const readingStr = pinyin(clean, {
                toneType: 'symbol',
                type: 'string',
            });

            const rawHtml = html(clean, {
                toneType: 'symbol',
            });

            // Protect <rt> tags so browser text selection & clipboard copy ignore pinyin
            const protectedRuby = rawHtml
                .replace(/<rp>.*?<\/rp>/gi, '')
                .replace(
                    /<rt([^>]*)>(.*?)<\/rt>/gi,
                    '<rt$1 style="user-select: none; -webkit-user-select: none; pointer-events: none;" class="ncw-token-phonetic">$2</rt>',
                );

            return {
                reading: readingStr,
                rubyHtml: protectedRuby,
            };
        } catch (err) {
            this.logger.warn(
                'Annotate',
                `Failed to annotate Chinese text "${clean}":`,
                err,
            );
            return { reading: clean, rubyHtml: clean };
        }
    }
}
