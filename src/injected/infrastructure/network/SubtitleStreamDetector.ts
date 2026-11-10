export class SubtitleStreamDetector {
    /**
     * Fast byte-level inspection of the first 128 bytes of an ArrayBuffer
     * to avoid expensive decoding of large binary video/audio chunks.
     */
    static looksLikeSubtitleBuffer(
        buffer: ArrayBuffer | ArrayBufferView | null | undefined,
    ): boolean {
        if (!buffer || buffer.byteLength < 10) return false;
        const isView = ArrayBuffer.isView(buffer);
        const actualBuffer = isView ? buffer.buffer : buffer;
        const offset = isView ? buffer.byteOffset : 0;
        const length = Math.min(128, buffer.byteLength);

        const bytes = new Uint8Array(actualBuffer, offset, length);
        let snippet = '';
        for (let i = 0; i < bytes.length; i++) {
            snippet += String.fromCharCode(bytes[i]);
        }
        return (
            snippet.includes('<tt') ||
            snippet.includes('<timedtext') ||
            snippet.includes('<transcript') ||
            snippet.includes('"wireMagic"') ||
            snippet.includes('"events"') ||
            snippet.includes('<p') ||
            snippet.includes('<?xml') ||
            snippet.includes('WEBVTT')
        );
    }

    /**
     * Fast text-level inspection to determine if a string looks like subtitle content (TTML, XML, WebVTT, YouTube JSON3).
     */
    static isSubtitleContent(text: string | null | undefined): boolean {
        if (!text || typeof text !== 'string') return false;
        const clean = text.replace(/^\uFEFF/, '').trim();
        const snippet = clean.slice(0, 2000);

        // Check for WebVTT
        if (snippet.startsWith('WEBVTT') || snippet.includes('WEBVTT')) {
            return true;
        }

        // Check for TTML / DFXP XML / YouTube timedtext XML
        if (
            snippet.includes('<tt') ||
            snippet.includes('<timedtext') ||
            snippet.includes('<transcript') ||
            /<p\s+t="\d+"/i.test(snippet)
        ) {
            return true;
        }
        if (snippet.includes('<p begin=') || snippet.includes('begin="')) {
            return true;
        }

        // Check for YouTube JSON3 format
        if (
            snippet.includes('"wireMagic"') ||
            (snippet.includes('"events"') &&
                (snippet.includes('"tStartMs"') || snippet.includes('"segs"')))
        ) {
            return true;
        }

        // Check for Bilibili BCC JSON format
        if (
            snippet.includes('"body"') &&
            snippet.includes('"from"') &&
            snippet.includes('"to"')
        ) {
            return true;
        }

        return false;
    }
}
