import { SubtitleCueData } from '@content/domain/adapters/IStreamingAdapter';
import { SubtitleParser } from '@content/application/utils/parser';

interface BilibiliBccCue {
    from: number;
    to: number;
    location?: number;
    content: string;
}

interface BilibiliBccPayload {
    body?: BilibiliBccCue[];
    lang?: string;
    type?: string;
}

/**
 * Dedicated Bilibili Subtitle Parser.
 * Handles Bilibili BCC JSON format and falls back to WebVTT/TTML.
 */
export class BilibiliSubtitleParser {
    /**
     * Parse raw Bilibili subtitle string into normalized SubtitleCueData array
     */
    static parse(raw: string): SubtitleCueData[] {
        if (!raw || typeof raw !== 'string') return [];

        const trimmed = raw.trim();

        // 1. Try Bilibili BCC JSON format
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                const parsed = JSON.parse(trimmed) as BilibiliBccPayload;
                if (Array.isArray(parsed.body)) {
                    const cues: SubtitleCueData[] = [];
                    for (let i = 0; i < parsed.body.length; i++) {
                        const item = parsed.body[i];
                        const start = typeof item.from === 'number' ? item.from : parseFloat(String(item.from));
                        const end = typeof item.to === 'number' ? item.to : parseFloat(String(item.to));
                        const text = String(item.content || '').trim();

                        if (!isNaN(start) && !isNaN(end) && text) {
                            cues.push({
                                id: i + 1,
                                start,
                                end,
                                text,
                                position: 'bottom',
                            });
                        }
                    }
                    if (cues.length > 0) {
                        return cues;
                    }
                }
            } catch {
                // Ignore JSON parse failure and fallback
            }
        }

        // 2. Fallback to generic parser (VTT / TTML / SRT)
        return SubtitleParser.parse(trimmed);
    }
}
