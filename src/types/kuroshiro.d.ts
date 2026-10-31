declare module 'kuroshiro' {
    export interface KuroshiroConvertOptions {
        to?: 'hiragana' | 'katakana' | 'romaji';
        mode?: 'normal' | 'spaced' | 'okurigana' | 'furigana';
        romajiSystem?: 'nippon' | 'passport' | 'hepburn';
        delimiter_start?: string;
        delimiter_end?: string;
    }

    export default class Kuroshiro {
        static Util: {
            isHiragana(ch: string): boolean;
            isKatakana(ch: string): boolean;
            isKana(ch: string): boolean;
            isKanji(ch: string): boolean;
            isJapanese(ch: string): boolean;
            hasHiragana(str: string): boolean;
            hasKatakana(str: string): boolean;
            hasKana(str: string): boolean;
            hasKanji(str: string): boolean;
            hasJapanese(str: string): boolean;
            kanaToHiragna(str: string): string;
            kanaToKatakana(str: string): string;
            kanaToRomaji(str: string, system?: string): string;
        };

        constructor();
        init(analyzer: unknown): Promise<void>;
        convert(text: string, options?: KuroshiroConvertOptions): Promise<string>;
    }
}

declare module 'kuroshiro-analyzer-kuromoji' {
    export interface KuromojiAnalyzerOptions {
        dictPath?: string;
    }

    export default class KuromojiAnalyzer {
        constructor(options?: KuromojiAnalyzerOptions);
        init(): Promise<void>;
        parse(str?: string): Promise<unknown[]>;
    }
}
