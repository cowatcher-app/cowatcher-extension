import {
    BilibiliSubtitleItem,
    BilibiliCachedSubtitle,
} from './BilibiliTypes';
import { Logger } from '@shared/utils/logger';

export class BilibiliTrackRegistry {
    private readonly logger = new Logger('BilibiliTrackRegistry');

    // videoId -> available subtitle items
    private readonly availableTracks = new Map<string, BilibiliSubtitleItem[]>();

    // videoId -> language code -> cached subtitle
    private readonly cachedSubtitles = new Map<string, Map<string, BilibiliCachedSubtitle>>();

    // cid -> videoId mapping
    private readonly cidToVideoId = new Map<string | number, string>();

    static isBccJson(text: string): boolean {
        if (!text || typeof text !== 'string') return false;
        const trimmed = text.trim();
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
        try {
            const parsed = JSON.parse(trimmed) as BccCheckPayload;
            return Boolean(
                parsed &&
                Array.isArray(parsed.body) &&
                (parsed.body.length === 0 ||
                    (typeof parsed.body[0]?.from === 'number' &&
                     typeof parsed.body[0]?.to === 'number' &&
                     typeof parsed.body[0]?.content === 'string'))
            );
        } catch {
            return false;
        }
    }

    bindCidToVideoId(cid: string | number, videoId: string): void {
        if (cid && videoId) {
            this.cidToVideoId.set(cid, videoId);
        }
    }

    getVideoIdByCid(cid: string | number): string | undefined {
        return this.cidToVideoId.get(cid);
    }

    registerAvailableTracks(videoId: string, items: BilibiliSubtitleItem[]): void {
        if (!videoId || !Array.isArray(items)) return;
        this.availableTracks.set(videoId, items);
        this.logger.info(
            'BilibiliTrackRegistry',
            `Registered ${items.length} tracks for ${videoId}: ${items.map((i) => i.lan).join(', ')}`,
        );
    }

    getAvailableTracks(videoId: string): BilibiliSubtitleItem[] {
        return this.availableTracks.get(videoId) || [];
    }

    /**
     * Pick best matching track for playback.
     * Prefers Chinese ("zh-CN", "zh", "zh-Hans", "zh-Hant") or first available.
     */
    getPreferredTrack(videoId: string): BilibiliSubtitleItem | null {
        const tracks = this.getAvailableTracks(videoId);
        if (tracks.length === 0) return null;

        // Prefer human over AI if both exist for same language
        const humanTracks = tracks.filter((t) => t.is_machine === 0);
        const candidates = humanTracks.length > 0 ? humanTracks : tracks;

        const zhTrack = candidates.find((t) =>
            /zh/i.test(t.lan) || /中文|汉语|普通话/i.test(t.lan_doc),
        );
        if (zhTrack) return zhTrack;

        return candidates[0] || null;
    }

    cacheSubtitle(item: BilibiliCachedSubtitle): void {
        if (!item || !item.videoId) return;
        let langMap = this.cachedSubtitles.get(item.videoId);
        if (!langMap) {
            langMap = new Map();
            this.cachedSubtitles.set(item.videoId, langMap);
        }
        langMap.set(item.lan.toLowerCase(), item);
        this.logger.info(
            'BilibiliTrackRegistry',
            `Cached subtitle for ${item.videoId} [${item.lan}] (${item.rawText.length} chars)`,
        );
    }

    getCachedSubtitle(
        videoId: string,
        preferredLang?: string,
    ): BilibiliCachedSubtitle | null {
        const langMap = this.cachedSubtitles.get(videoId);
        if (!langMap || langMap.size === 0) return null;

        if (preferredLang) {
            const exact = langMap.get(preferredLang.toLowerCase());
            if (exact) return exact;
        }

        // Try Chinese
        for (const [lan, sub] of langMap.entries()) {
            if (/zh/i.test(lan)) return sub;
        }

        // Fallback to first available
        return langMap.values().next().value || null;
    }

    clear(): void {
        this.availableTracks.clear();
        this.cachedSubtitles.clear();
        this.cidToVideoId.clear();
    }
}

interface BccCheckPayload {
    body?: Array<{
        from?: number;
        to?: number;
        content?: string;
    }>;
}
