export interface SubtitleCueData {
    id: number;
    start: number; // in seconds
    end: number; // in seconds
    text: string;
    position?: 'bottom' | 'top' | 'left-vertical' | 'right-vertical';
}

export interface VideoMetadata {
    mainTitle: string;
    episodeTitle: string;
    fullTitle: string;
    videoId: string;
    showId?: string;
    seasonId?: string;
    showSummary?: string;
    episodeSummary?: string;
    seasonNum?: number;
    episodeNum?: number;
    isLive?: boolean;
}

import { StreamingPlatformId } from '@shared/domain/constants/StreamingPlatforms';
import { IAdDetector, AdDetectorOptions } from './IAdDetector';
import {
    PlaybackDatasetPayload,
    NCW_DATASET_SYNC_KEY,
    PlaybackDatasetHelper,
} from '@shared/domain/entities/PlaybackDatasetPayload';

export type { IAdDetector, AdDetectorOptions, PlaybackDatasetPayload };
export { NCW_DATASET_SYNC_KEY, PlaybackDatasetHelper };

/**
 * Domain interface for Streaming Platform Content Adapters.
 *
 * Runs exclusively in the extension's ISOLATED execution world (Content Script).
 * Acts as the Anti-Corruption Layer (ACL) and bridge between platform-specific streaming players
 * (Netflix, Disney+, YouTube, etc.) and the platform-agnostic subtitle pipeline (`SubtitleManager`).
 *
 * Works in tandem with its corresponding `IInjectedAdapter` (which runs in the webpage's MAIN world).
 *
 * --- Primary Responsibilities ---
 * 1. DOM & Player Anchoring:
 *    - Locate the active HTMLVideoElement (`getVideoElement`) to bind play, pause, seek, and tick events.
 *    - Locate the presentation container (`getPlayerContainer`) for mounting custom subtitle overlays
 *      ensuring proper z-index and automatic scaling in fullscreen modes.
 *
 * 2. Playback Timeline & Ad Synchronization:
 *    - Provide authoritative content playback time (`getContentTime`), compensating for platform-specific
 *      segment offsets or clock drift (e.g. Netflix Kadmium atomic segments).
 *    - Detect active commercial advertisements (`isAdActive`) to pause translation and suppress overlays.
 *
 * 3. Identity & Metadata Extraction:
 *    - Match supported platform URLs (`matches`).
 *    - Extract current video / show identifiers (`extractVideoId`).
 *    - Query structured metadata (`queryMetadata`): showId, videoId, titles, synopses, season/episode numbers
 *      for AI context warmup and glossary tracking.
 *
 * 4. Injected Script Bridging & Subtitle Parsing:
 *    - Bridge window.postMessage events emitted by the companion `IInjectedAdapter`.
 *    - Parse intercepted raw subtitle payloads (WebVTT, TTML, DFXP, XML) into standardized `SubtitleCueData[]`.
 *    - Dispatch lifecycle events: episode changes, URL changes, metadata loading, time sync offsets.
 *
 * 5. Subtitle Fallback & Recovery:
 *    - Provide a retry mechanism (`requestSubtitleRetry`) via window.postMessage when subtitles fail to load.
 *
 * 6. Lifecycle Management:
 *    - Properly clean up all event listeners, MutationObservers, and background monitors (`dispose`).
 *
 * --- Step-by-Step Guide to Implement a New Platform ---
 * To support a new streaming service (e.g., Disney+, YouTube, Prime Video):
 *
 * Step 1: Implement the companion `IInjectedAdapter` in `src/injected/infrastructure/adapters/<platform>/`
 *         to run in the MAIN world, hook network requests (fetch / XHR) or player APIs, and emit standardized
 *         events (NCW_SUBTITLE_RAW_DATA, NCW_METADATA_LOADED, etc.) via window.postMessage.
 *         Register it in `src/injected/injected.ts` via `InjectedAdapterRegistry.register()`.
 *
 * Step 2: Implement this `IStreamingAdapter` in `src/content/infrastructure/adapters/<platform>/`.
 *         Implement DOM selectors for video and player container, parse raw subtitles using `SubtitleParser`,
 *         and forward events via the `onSubtitleData`, `onMetadataLoaded`, etc. listener hooks.
 *
 * Step 3: Register this adapter in `src/content/content.ts` via:
 *         `StreamingAdapterRegistry.register(new <Platform>ContentAdapter())`
 *
 * Step 4: Add the new platform identifier to `src/shared/domain/constants/StreamingPlatforms.ts`.
 *
 * Step 5: Add matching URL patterns to `manifest.json` under `content_scripts` and `web_accessible_resources`.
 */
export interface IStreamingAdapter {
    readonly platformName: StreamingPlatformId;

    /**
     * Check if current webpage matches this streaming platform
     */
    matches(url: string): boolean;

    /**
     * Extract video / episode ID from current page or URL
     */
    extractVideoId(url?: string): string | null;

    /**
     * Check if current page or URL is an active video playback / watch page for this platform
     */
    isPlaybackPage(url?: string): boolean;

    /**
     * Find video playback HTMLMediaElement
     */
    getVideoElement(): HTMLVideoElement | null;

    /**
     * Get the presentation mounting container for custom subtitle overlays
     */
    getPlayerContainer(): HTMLElement | null;

    /**
     * Check if commercial advertisements are currently active
     */
    isAdActive(): boolean;

    /**
     * Platform-adapted playback pause control (uses platform player API if available, fallback to video element)
     */
    pausePlayback(): void;

    /**
     * Platform-adapted playback resume control (uses platform player API if available, fallback to video element)
     */
    resumePlayback(): void;

    /**
     * Check if video playback is currently paused
     */
    isPlaybackPaused(): boolean;

    /**
     * Parse platform-specific raw subtitle text into standardized SubtitleCueData[]
     */
    parseSubtitle(rawText: string): SubtitleCueData[];

    /**
     * Create platform-specific ad detector
     */
    createAdDetector?(options?: AdDetectorOptions): IAdDetector;

    /**
     * Query authoritative content time (e.g. Kadmium segment time or fallback video currentTime)
     */
    getContentTime(): Promise<number | null | undefined>;

    /**
     * This is used to fetch subtitle.
     * null means confirmed no subttile to fetch.
     * undefined means we don't know if there is a subtitle to fetch.
     */
    fetchSubttile(
        movieId: string,
    ): Promise<{ rawText: string; bcp: string } | null | undefined>;

    /**
     * Actively query authoritative metadata for the current video from injected player/platform state.
     * Returns tri-state result:
     * - VideoMetadata: Confirmed metadata found
     * - null: Confirmed no episodic metadata exists (standalone video)
     * - undefined: Unknown / pending (in transition or loading, caller should schedule retry)
     */
    queryMetadata(movieId?: string): Promise<VideoMetadata | null | undefined>;

    /**
     * Query and fetch native official subtitle track matching target language if available
     */
    fetchNativeTargetTrack?(
        targetLang: import('@shared/domain/value-objects/Language').LanguageInfo,
        movieId?: string,
    ): Promise<SubtitleCueData[] | null | undefined>;

    /**
     * Listen for episode change events
     */
    onEpisodeChange(callback: (newEpisodeId: string) => void): () => void;

    /**
     * Listen for URL changes detected by the platform player
     */
    onUrlChange(callback: (url: string) => void): () => void;

    /**
     * Listen for player time synchronization offset events
     */
    onTimeSync(
        callback: (offsets: {
            movieId: string;
            cadmiumOffset?: number;
            adOffset?: number;
        }) => void,
    ): () => void;

    /**
     * Listen for metadata loaded events (show synopsis, show title, episode synopsis)
     */
    onMetadataLoaded?(callback: (metadata: VideoMetadata) => void): () => void;

    /**
     * Listen for preloaded / staged subtitle tracks for upcoming episodes
     */
    onSubtitlePreload(
        callback: (data: {
            movieId?: string;
            rawText: string;
            bcp47?: string | null;
            timestamp?: number;
        }) => void,
    ): () => void;

    /**
     * Listen for raw subtitle track data intercepted from platform
     */
    onSubtitleData(
        callback: (data: {
            movieId?: string;
            cues: SubtitleCueData[];
            language: string;
            isAsr?: boolean;
        }) => void,
    ): () => void;

    /**
     * Listen for subtitle track being turned OFF / disabled on the streaming platform
     */
    onSubtitleOff?(callback: (movieId: string) => void): () => void;

    /**
     * Listen for subtitle track incremental updates (e.g. in live streams)
     */
    onSubtitleUpdated?(callback: (movieId?: string) => void): () => void;

    /**
     * Cleanup observers and event hooks
     */
    dispose(): void;
}
