import {
    IDictionaryAdapter,
    PhoneticResult,
} from '../../../domain/phonetic/IPhoneticAdapter';
import { Language } from '../../../domain/value-objects/Language';
import { Logger } from '../../../utils/logger';

export class SpanishPhoneticAdapter implements IDictionaryAdapter {
    readonly languageCode = 'es';
    readonly displayName = 'Spanish (Dictionary & Lemmatizer)';

    private readonly logger = new Logger('SpanishPhoneticAdapter');
    private readonly lemmaCache = new Map<string, string>();
    private readonly meaningCache = new Map<string, string>();

    async init(): Promise<void> {
        return Promise.resolve();
    }

    isReady(): boolean {
        return true;
    }

    /**
     * Extracts base lemma (root / dictionary form) for Spanish words or phrases.
     * Uses Wiktionary's inflected form relations (e.g. "comieron" -> "comer", "hablo" -> "hablar").
     */
    async getLemma(
        text: string,
        _options?: Record<string, unknown>,
    ): Promise<string> {
        const clean = (text || '').trim();
        if (!clean) return '';

        if (clean.includes(' ')) {
            return clean;
        }

        const normalized = clean.toLowerCase();
        if (this.lemmaCache.has(normalized)) {
            return this.lemmaCache.get(normalized)!;
        }

        try {
            const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(
                normalized,
            )}`;
            const res = await fetch(url);
            if (res.ok) {
                const json = (await res.json()) as {
                    es?: Array<{
                        definitions?: Array<{
                            definition?: string;
                        }>;
                    }>;
                };

                if (Array.isArray(json?.es)) {
                    for (const section of json.es) {
                        if (Array.isArray(section.definitions)) {
                            for (const d of section.definitions) {
                                const match = d.definition?.match(
                                    /href="\/wiki\/([^"#]+)#Spanish"/,
                                );
                                if (match && match[1]) {
                                    const lemma = decodeURIComponent(
                                        match[1],
                                    ).trim();
                                    if (lemma) {
                                        this.lemmaCache.set(normalized, lemma);
                                        return lemma;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch {
            // ignore network/lookup errors
        }

        this.lemmaCache.set(normalized, clean);
        return clean;
    }

    async getWordReading(
        _word: string,
        _options?: Record<string, unknown>,
    ): Promise<string> {
        return '';
    }

    /**
     * Spanish subtitles do not require ruby annotations.
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

    private cleanWiktionaryDef(raw: string): string {
        let text = raw.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        text = text.replace(/<[^>]+>/g, ' ');
        text = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '\x22')
            .replace(/&#39;/g, '\'')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
        // Strip trailing grammatical notes like "[with ...]"
        text = text.replace(/\s*\[with[\s\S]*?\]/gi, '');
        text = text.replace(/\s+([,;.?!:])/g, '$1');
        return text.replace(/\s+/g, ' ').trim();
    }

    private async getChineseMeaning(clean: string): Promise<string | null> {
        const url = `https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=es&q=${encodeURIComponent(
            clean,
        )}`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) return null;

        const json = (await res.json()) as {
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
            const entry =
                json.data.entries.find(
                    (e) =>
                        e.entry?.toLowerCase() === clean.toLowerCase() &&
                        Boolean(e.explain),
                ) ||
                json.data.entries.find((e) => Boolean(e.explain)) ||
                json.data.entries[0];

            if (entry && entry.explain) {
                return entry.explain.trim();
            }
        }
        return null;
    }

    private async getKoreanMeaning(clean: string): Promise<string | null> {
        const url = `https://ac-dict.naver.com/esko/ac?q=${encodeURIComponent(
            clean,
        )}&q_enc=utf-8&st=100&r_format=json&r_enc=utf-8&r_lt=100`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) return null;

        const json = (await res.json()) as {
            items?: Array<Array<Array<string[]>>>;
        };

        const entries = json?.items?.[0];
        if (!Array.isArray(entries) || entries.length === 0) return null;

        const cleanLower = clean.toLowerCase();
        const matches: string[] = [];

        for (const item of entries) {
            const word = item?.[0]?.[0] || '';
            const def = item?.[3]?.[0] || '';
            if (!def) continue;

            if (word.toLowerCase() === cleanLower) {
                if (!matches.includes(def.trim())) {
                    matches.push(def.trim());
                }
                if (matches.length >= 2) break;
            }
        }

        if (matches.length === 0) {
            for (const item of entries) {
                const def = item?.[3]?.[0] || '';
                if (def && !matches.includes(def.trim())) {
                    matches.push(def.trim());
                    break;
                }
            }
        }

        if (matches.length > 0) {
            return matches.join('; ');
        }
        return null;
    }

    private async getEnglishMeaning(clean: string): Promise<string | null> {
        const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(
            clean.toLowerCase(),
        )}`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) return null;

        const json = (await res.json()) as {
            es?: Array<{
                partOfSpeech?: string;
                definitions?: Array<{
                    definition?: string;
                }>;
            }>;
        };

        if (!json?.es || !Array.isArray(json.es) || json.es.length === 0) {
            return null;
        }

        const defs: string[] = [];
        for (const section of json.es) {
            const pos = section.partOfSpeech || '';
            if (Array.isArray(section.definitions)) {
                for (const d of section.definitions) {
                    if (!d?.definition) continue;

                    const lemmaMatch = d.definition.match(
                        /href="\/wiki\/([^"#]+)#Spanish"/,
                    );
                    if (lemmaMatch && lemmaMatch[1]) {
                        const lemmaWord = decodeURIComponent(
                            lemmaMatch[1],
                        ).trim();
                        if (
                            lemmaWord &&
                            lemmaWord.toLowerCase() !== clean.toLowerCase()
                        ) {
                            this.lemmaCache.set(
                                clean.toLowerCase(),
                                lemmaWord,
                            );
                        }
                    }

                    const cleaned = this.cleanWiktionaryDef(d.definition);
                    if (cleaned) {
                        const prefix = pos ? `[${pos}] ` : '';
                        defs.push(`${prefix}${cleaned}`);
                        if (defs.length >= 2) break;
                    }
                }
            }
            if (defs.length >= 2) break;
        }

        if (defs.length > 0) {
            return defs.join('; ');
        }
        return null;
    }

    /**
     * Resolves dictionary definitions:
     * - Chinese ('zh'): Youdao Spanish-Chinese dictionary ('le=es')
     * - Korean ('ko'): Naver Spanish-Korean dictionary ('esko')
     * - English ('en'): Wiktionary REST API ('page/definition/{word}')
     * - Japanese ('ja') / Other: returns null (fallback to Google Translate or LLM)
     */
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

        let targetCategory: 'zh' | 'ko' | 'en';
        if (tl === 'zh' || tl.startsWith('zh')) {
            targetCategory = 'zh';
        } else if (tl === 'ko' || tl.startsWith('ko')) {
            targetCategory = 'ko';
        } else if (tl === 'en' || tl.startsWith('en')) {
            targetCategory = 'en';
        } else {
            // Target is not Chinese, Korean, or English (e.g. Japanese 'ja'): fallback to GeneralDictionaryAdapter or LLM
            return null;
        }

        const cacheKey = `${targetCategory}:${clean.toLowerCase()}`;
        if (this.meaningCache.has(cacheKey)) {
            return this.meaningCache.get(cacheKey)!;
        }

        try {
            let meaning: string | null = null;
            if (targetCategory === 'zh') {
                meaning = await this.getChineseMeaning(clean);
                if (!meaning) {
                    const lemma = this.lemmaCache.get(clean.toLowerCase());
                    if (lemma && lemma.toLowerCase() !== clean.toLowerCase()) {
                        meaning = await this.getChineseMeaning(lemma);
                    }
                }
            } else if (targetCategory === 'ko') {
                meaning = await this.getKoreanMeaning(clean);
                if (!meaning) {
                    const lemma = this.lemmaCache.get(clean.toLowerCase());
                    if (lemma && lemma.toLowerCase() !== clean.toLowerCase()) {
                        meaning = await this.getKoreanMeaning(lemma);
                    }
                }
            } else if (targetCategory === 'en') {
                meaning = await this.getEnglishMeaning(clean);
            }

            if (meaning) {
                this.meaningCache.set(cacheKey, meaning);
                return meaning;
            }
        } catch (err) {
            this.logger.warn(
                'Meaning',
                `Failed to fetch Spanish-${targetCategory} meaning for "${clean}":`,
                err,
            );
        }

        return null;
    }
}
