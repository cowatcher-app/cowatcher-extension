declare module 'romaja' {
    export interface RomanizeOptions {
        ruby?: boolean;
        method?: string;
        hyphenate?: boolean;
        hanja?: boolean;
        overrides?: Record<string, string> | Map<string, string>;
    }
    export function romanize(text: string, options?: RomanizeOptions): string;
    export function romanizeWord(
        word: string,
        options?: RomanizeOptions,
    ): string;
}
