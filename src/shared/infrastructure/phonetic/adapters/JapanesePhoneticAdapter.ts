import Kuroshiro from 'kuroshiro';
import KuromojiAnalyzer from 'kuroshiro-analyzer-kuromoji';
import {
    IDictionaryAdapter,
    PhoneticResult,
} from '../../../domain/phonetic/IPhoneticAdapter';
import { Language } from '../../../domain/value-objects/Language';
import { Logger } from '../../../utils/logger';
import { BrowserPlatformFactory } from '../../platform/BrowserPlatformFactory';

/* eslint-disable @typescript-eslint/no-require-imports */
// Polyfill BrowserDictionaryLoader: Modern WebExtensions (Firefox & Chrome) block cross-origin XMLHttpRequest
// on moz-extension:// and chrome-extension:// from content scripts. We use fetch() universally whenever available.
try {
    const BrowserDictionaryLoader = require('kuromoji/src/loader/BrowserDictionaryLoader');
    if (BrowserDictionaryLoader && BrowserDictionaryLoader.prototype) {
        const originalLoad = BrowserDictionaryLoader.prototype.loadArrayBuffer;
        BrowserDictionaryLoader.prototype.loadArrayBuffer = function (
            url: string,
            callback: (err: unknown, buf: ArrayBuffer | null) => void,
        ) {
            // Restore protocol double slashes if path.join collapsed them
            // (e.g. moz-extension:/uuid/... -> moz-extension://uuid/...)
            const targetUrl = url.replace(
                /^(moz-extension|chrome-extension):\/(?!\/)/,
                '$1://',
            );

            if (typeof fetch !== 'undefined') {
                const zlib = require('zlibjs/bin/gunzip.min.js');
                fetch(targetUrl)
                    .then((res) => {
                        if (!res.ok) {
                            throw new Error(
                                `HTTP ${res.status}: ${res.statusText}`,
                            );
                        }
                        return res.arrayBuffer();
                    })
                    .then((arrayBuffer) => {
                        const gz = new zlib.Zlib.Gunzip(
                            new Uint8Array(arrayBuffer),
                        );
                        const typedArray = gz.decompress();
                        callback(null, typedArray.buffer);
                    })
                    .catch((err) => callback(err, null));
                return;
            }
            return originalLoad.call(this, targetUrl, callback);
        };
    }
} catch {
    // Ignore when patching is not possible
}
/* eslint-enable @typescript-eslint/no-require-imports */

export class JapanesePhoneticAdapter implements IDictionaryAdapter {
    readonly languageCode = 'ja';
    readonly displayName = 'Japanese (Kuroshiro + Kuromoji)';

    private readonly logger = new Logger('JapanesePhoneticAdapter');
    private kuroshiro: Kuroshiro | null = null;
    private analyzer: unknown | null = null;
    private initPromise: Promise<void> | null = null;
    private initialized = false;

    private resolveDictPath(): string {
        try {
            return BrowserPlatformFactory.getPlatform().getURL('dict/');
        } catch {
            return 'dict/';
        }
    }

    async init(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                this.logger.info('Init', 'Initializing Kuromoji analyzer...');
                const dictPath = this.resolveDictPath();
                const analyzer = new KuromojiAnalyzer({ dictPath });
                const instance = new Kuroshiro();
                await instance.init(analyzer);
                this.kuroshiro = instance;
                this.analyzer = analyzer;
                this.initialized = true;
                this.logger.info(
                    'Init',
                    `Kuromoji analyzer successfully initialized with dictPath: "${dictPath}"`,
                );
            } catch (err) {
                this.logger.error(
                    'Init',
                    'Failed to initialize Kuromoji analyzer:',
                    err,
                );
                this.initPromise = null;
                throw err;
            }
        })();

        return this.initPromise;
    }

    isReady(): boolean {
        return this.initialized && this.kuroshiro !== null;
    }

    async getWordReading(word: string): Promise<string> {
        const clean = (word || '').trim();
        if (!clean) return '';

        // If purely kana/punctuation/latin, no kanji conversion needed
        if (!Kuroshiro.Util.hasKanji(clean)) {
            return clean;
        }

        try {
            await this.init();
            if (!this.kuroshiro) return '';
            const converted = await this.kuroshiro.convert(clean, {
                to: 'hiragana',
                mode: 'normal',
            });
            return (converted || '').trim();
        } catch (err) {
            this.logger.warn(
                'Reading',
                `Failed to get reading for "${clean}":`,
                err,
            );
            return '';
        }
    }

    async getLemma(text: string): Promise<string> {
        const clean = (text || '').trim();
        if (!clean) return '';
        try {
            await this.init();
            const analyzerObj = this.analyzer as
                | {
                      parse?: (
                          t: string,
                      ) => Promise<
                          Array<{ basic_form?: string; pos?: string }>
                      >;
                  }
                | null
                | undefined;

            if (analyzerObj && typeof analyzerObj.parse === 'function') {
                const tokens = await analyzerObj.parse(clean);
                if (Array.isArray(tokens) && tokens.length > 0) {
                    const first = tokens[0];
                    if (
                        first.basic_form &&
                        first.basic_form !== '*' &&
                        (first.pos === '動詞' ||
                            first.pos === '形容詞' ||
                            first.pos === '名詞')
                    ) {
                        return first.basic_form;
                    }
                }
            }
        } catch (err) {
            this.logger.warn(
                'Lemma',
                `Failed to get lemma for "${clean}":`,
                err,
            );
        }
        return clean;
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
        const isEnglish = tl === 'en' || tl.startsWith('en');
        const isChinese = tl.startsWith('zh');

        // Neither English nor Chinese requested: return null to let general adapter or LLM handle
        if (!isEnglish && !isChinese) {
            return null;
        }

        const cacheKey = `${isEnglish ? 'en' : 'zh'}:${clean.toLowerCase()}`;
        if (this.meaningCache.has(cacheKey)) {
            return this.meaningCache.get(cacheKey)!;
        }

        if (isEnglish) {
            // Target is English: query online Jisho API (JMdict based)
            try {
                const url = `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(clean)}`;
                const res = await fetch(url, {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json',
                    },
                });
                if (!res.ok) return null;

                const json = (await res.json()) as {
                    data?: Array<{
                        senses?: Array<{
                            parts_of_speech?: string[];
                            english_definitions?: string[];
                        }>;
                    }>;
                };

                if (
                    !json ||
                    !Array.isArray(json.data) ||
                    json.data.length === 0
                ) {
                    return null;
                }

                const senses = json.data[0].senses || [];
                const formatted = senses
                    .slice(0, 3)
                    .map((s) => {
                        const pos =
                            s.parts_of_speech && s.parts_of_speech.length > 0
                                ? `[${s.parts_of_speech[0]}] `
                                : '';
                        const defs = (s.english_definitions || [])
                            .slice(0, 4)
                            .join(', ');
                        return `${pos}${defs}`.trim();
                    })
                    .filter(Boolean)
                    .join('; ');

                if (formatted) {
                    this.meaningCache.set(cacheKey, formatted);
                    return formatted;
                }
            } catch (err) {
                this.logger.warn(
                    'Meaning',
                    `Failed to fetch Jisho meaning for "${clean}":`,
                    err,
                );
            }
            return null;
        }

        if (isChinese) {
            // Target is Chinese: query online free Japanese-Chinese dictionary (Youdao Dict API)
            try {
                const url = `https://dict.youdao.com/suggest?num=5&ver=3.0&doctype=json&cache=false&le=jap&q=${encodeURIComponent(
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
                            fromDict?: string;
                            show?: string;
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
                                e.entry?.toLowerCase() ===
                                    clean.toLowerCase() ||
                                e.show
                                    ?.toLowerCase()
                                    .startsWith(clean.toLowerCase()),
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
                    `Failed to fetch Japanese-Chinese meaning for "${clean}":`,
                    err,
                );
            }
            return null;
        }

        return null;
    }

    async annotateText(text: string): Promise<PhoneticResult> {
        const clean = (text || '').trim();
        if (!clean) {
            return { reading: '', rubyHtml: '' };
        }

        try {
            await this.init();
            if (!this.kuroshiro) {
                return { reading: clean, rubyHtml: clean };
            }

            const reading = await this.kuroshiro.convert(clean, {
                to: 'hiragana',
                mode: 'normal',
            });

            // Convert to furigana ruby tags
            const rawFurigana = await this.kuroshiro.convert(clean, {
                to: 'hiragana',
                mode: 'furigana',
            });

            // Protect <rt> tags so browser text selection & clipboard copy ignore annotations
            const protectedRuby = rawFurigana
                .replace(/<rp>.*?<\/rp>/gi, '') // Remove <rp>(</rp> for cleaner modern ruby
                .replace(
                    /<rt>(.*?)<\/rt>/gi,
                    '<rt style="user-select: none; -webkit-user-select: none; pointer-events: none;" class="ncw-token-phonetic">$1</rt>',
                );

            return {
                reading: reading.trim(),
                rubyHtml: protectedRuby,
            };
        } catch (err) {
            this.logger.warn(
                'Annotate',
                `Failed to annotate Japanese text "${clean}":`,
                err,
            );
            return { reading: clean, rubyHtml: clean };
        }
    }
}
