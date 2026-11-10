/**
 * Bilibili Injected Adapter Type Definitions
 */

export interface BilibiliSubtitleItem {
    id: number;
    lan: string; // e.g. "zh-CN", "en-US", "ja"
    lan_doc: string; // e.g. "中文（简体）", "English"
    is_machine: number; // 0: human, 1: AI
    subtitle_url: string; // URL to the BCC JSON subtitle, often protocol-relative e.g. "//i0.hdslb.com/bfs/subtitle/..."
    type?: number;
    id_str?: string;
    ai_type?: number;
    ai_status?: number;
}

export interface BilibiliBccCue {
    from: number; // in seconds, e.g. 1.25
    to: number; // in seconds, e.g. 3.82
    location?: number;
    content: string;
}

export interface BilibiliBccJson {
    font_size?: number;
    font_color?: string;
    background_alpha?: number;
    background_color?: string;
    Stroke?: string;
    type?: string;
    lang?: string;
    version?: string;
    body: BilibiliBccCue[];
}

export interface BilibiliCachedSubtitle {
    videoId: string;
    cid?: string | number;
    lan: string;
    lanDoc: string;
    isMachine: boolean;
    rawText: string;
    url: string;
    timestamp: number;
}

export interface BilibiliVideoInfo {
    bvid?: string;
    aid?: number;
    cid?: number;
    title?: string;
    desc?: string;
    owner?: {
        name?: string;
        mid?: number;
    };
    pages?: Array<{
        page: number;
        part: string;
        cid: number;
        duration?: number;
    }>;
    subtitle?: {
        list?: BilibiliSubtitleItem[];
        subtitles?: BilibiliSubtitleItem[];
    };
}

export interface BilibiliCachedMetadata {
    bvid: string;
    aid?: number | string;
    title: string;
    desc: string;
    ownerName?: string;
    pages: Array<{
        cid: number;
        page: number;
        part: string;
        duration?: number;
    }>;
    subtitles?: BilibiliSubtitleItem[];
}

export interface BilibiliBangumiMetadata {
    seasonId: string;
    title: string;
    evaluate: string;
    episodes: Array<{
        id: number;
        aid: number;
        cid: number;
        bvid: string;
        title: string;
        long_title: string;
    }>;
}

export interface BilibiliBangumiEpInfo {
    id?: number;
    aid?: number;
    cid?: number;
    bvid?: string;
    title?: string;
    long_title?: string;
    status?: number;
}

export interface BilibiliBangumiMediaInfo {
    title?: string;
    season_id?: number;
    season_title?: string;
    evaluate?: string;
    episodes?: Array<{
        id: number;
        aid: number;
        cid: number;
        bvid: string;
        title: string;
        long_title: string;
    }>;
}

declare global {
    interface Window {
        __NCW_BILIBILI_INTERCEPTOR_INITIALIZED__?: boolean;
        __INITIAL_STATE__?: {
            videoData?: BilibiliVideoInfo;
            mediaInfo?: BilibiliBangumiMediaInfo;
            epInfo?: BilibiliBangumiEpInfo;
            epList?: BilibiliBangumiEpInfo[];
            [key: string]: unknown;
        };
    }
}
