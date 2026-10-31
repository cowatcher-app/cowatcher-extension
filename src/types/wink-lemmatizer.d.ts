declare module 'wink-lemmatizer' {
    /**
     * Lemmatize an inflected verb into its base form (infinitive).
     */
    export function verb(word: string): string;

    /**
     * Lemmatize an inflected noun into its singular form.
     */
    export function noun(word: string): string;

    /**
     * Lemmatize an inflected adjective into its positive/base form.
     */
    export function adjective(word: string): string;
}
