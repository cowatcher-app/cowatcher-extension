import { StreamingPlatformId } from '../constants/StreamingPlatforms';

/**
 * Domain entities for viewing history and playback analytics.
 */

export interface WatchSession {
    id: string; // Unique session ID (e.g. uuid or timestamp-based)
    platform: StreamingPlatformId;

    // Show & Episode Hierarchy
    showId: string;
    showTitle: string;
    seasonNum?: number;
    episodeNum?: number;
    episodeTitle?: string;
    videoId: string; // Movie/Episode ID

    // Real-world Time
    startedAt: number; // Unix timestamp (ms) when playback session began
    endedAt: number; // Unix timestamp (ms) when playback session stopped/flushed

    // Video Content Time Range (e.g. from 01:30 to 24:15)
    fromContentTime: number; // In seconds
    toContentTime: number; // In seconds
    videoDuration: number; // In seconds

    // Active watching metrics
    effectiveWatchSeconds: number; // Seconds actually elapsed during active playback
}

export interface ShowEpisodeProgress {
    seasonNum?: number;
    episodeNum?: number;
    episodeTitle?: string;
    videoId: string;
    lastContentTime: number; // Timestamp in video where user left off
    videoDuration: number;
    updatedAt: number;
}

export interface ShowWatchSummary {
    showId: string;
    showTitle: string;
    platform: StreamingPlatformId;
    totalWatchSeconds: number;
    firstWatchedAt: number;
    lastWatchedAt: number;
    sessionsCount: number;
    episodesCount: number;
    lastEpisode: ShowEpisodeProgress;
}

export interface DailyWatchStat {
    date: string; // YYYY-MM-DD
    watchSeconds: number;
    sessionsCount: number;
}

export interface WatchHistoryStats {
    totalWatchSeconds: number;
    totalShows: number;
    totalEpisodes: number;
    totalSessions: number;
    dailyStats: DailyWatchStat[];
}
