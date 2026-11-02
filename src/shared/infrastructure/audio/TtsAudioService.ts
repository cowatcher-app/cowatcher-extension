import { Language } from '@shared/domain/value-objects/Language';

/**
 * TtsAudioService
 * Handles high-fidelity cloud audio streaming, language resolution via Language domain object,
 * and base64 audio serialization for Anki & preview playback.
 */
export class TtsAudioService {
    /**
     * Checks if cloud TTS audio generation is supported for the given language.
     * Delegates to the Language domain value object.
     */
    static isLanguageSupported(lang?: string | null): boolean {
        if (!lang || lang === 'auto') return false;
        const resolved = Language.resolve(lang);
        return !!(resolved && resolved.googleCode && Language.get(resolved.code));
    }

    /**
     * Resolves language input to the standard Google Translate / BCP-47 TTS code.
     */
    static resolveLangCode(lang?: string | null): string {
        if (!lang || lang === 'auto') return 'en';
        const resolved = Language.resolve(lang);
        return resolved?.googleCode || resolved?.iso639_1 || 'en';
    }

    /**
     * Constructs public cloud audio streaming URL for a given word and language.
     */
    static getAudioUrl(text: string, lang: string): string {
        const cleanText = (text || '').trim();
        const targetLang = this.resolveLangCode(lang);
        return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
            cleanText,
        )}&tl=${targetLang}&client=tw-ob`;
    }

    /**
     * Fetches high-fidelity audio binary stream and returns base64 string.
     */
    static async fetchAudioBase64(
        text: string,
        lang: string,
    ): Promise<string | null> {
        const cleanText = (text || '').trim();
        if (!cleanText) return null;

        const url = this.getAudioUrl(cleanText, lang);

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 6000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);

            if (!res.ok) return null;
            const arrayBuffer = await res.arrayBuffer();
            if (!arrayBuffer || arrayBuffer.byteLength === 0) return null;

            // Safe chunked Base64 conversion
            const uint8 = new Uint8Array(arrayBuffer);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < uint8.length; i += chunkSize) {
                binary += String.fromCharCode.apply(
                    null,
                    uint8.subarray(i, i + chunkSize) as unknown as number[],
                );
            }
            return btoa(binary);
        } catch {
            return null;
        }
    }
}
