import {
    WatchSession,
    ShowWatchSummary,
    WatchHistoryStats,
    DailyWatchStat,
} from '@shared/domain/entities/WatchHistory';
import { Logger } from '@shared/utils/logger';
import { IBrowserStorage } from '@shared/infrastructure/storage/IBrowserStorage';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { NCW_STORAGE_KEYS } from '@shared/domain/constants/StorageKeys';

export class WatchHistoryService {
    private static instance: WatchHistoryService | null = null;
    private readonly logger: Logger = new Logger('WatchHistoryService');

    private static DB_NAME = 'NCW_WatchHistoryDB';
    private static DB_VERSION = 1;
    private static STORE_SESSIONS = 'watch_sessions';
    private static STORE_SHOWS = 'show_summaries';

    private dbPromise: Promise<IDBDatabase | null> | null = null;

    constructor(
        private readonly storage: IBrowserStorage = BrowserStorageFactory.getStorage(),
    ) {}

    static getInstance(): WatchHistoryService {
        if (!WatchHistoryService.instance) {
            WatchHistoryService.instance = new WatchHistoryService();
        }
        return WatchHistoryService.instance;
    }

    private getDB(): Promise<IDBDatabase | null> {
        if (typeof indexedDB === 'undefined') {
            return Promise.resolve(null);
        }
        if (this.dbPromise) {
            return this.dbPromise;
        }

        this.dbPromise = new Promise((resolve) => {
            try {
                const req = indexedDB.open(
                    WatchHistoryService.DB_NAME,
                    WatchHistoryService.DB_VERSION,
                );

                req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
                    const db = (e.target as IDBOpenDBRequest).result;
                    if (
                        !db.objectStoreNames.contains(
                            WatchHistoryService.STORE_SESSIONS,
                        )
                    ) {
                        const sessionsStore = db.createObjectStore(
                            WatchHistoryService.STORE_SESSIONS,
                            {
                                keyPath: 'id',
                            },
                        );
                        sessionsStore.createIndex('showId', 'showId', {
                            unique: false,
                        });
                        sessionsStore.createIndex('startedAt', 'startedAt', {
                            unique: false,
                        });
                        sessionsStore.createIndex('videoId', 'videoId', {
                            unique: false,
                        });
                    }
                    if (
                        !db.objectStoreNames.contains(
                            WatchHistoryService.STORE_SHOWS,
                        )
                    ) {
                        const showsStore = db.createObjectStore(
                            WatchHistoryService.STORE_SHOWS,
                            {
                                keyPath: 'showId',
                            },
                        );
                        showsStore.createIndex(
                            'lastWatchedAt',
                            'lastWatchedAt',
                            { unique: false },
                        );
                    }
                };

                req.onsuccess = (e: Event) => {
                    resolve((e.target as IDBOpenDBRequest).result);
                };

                req.onerror = () => {
                    resolve(null);
                };
            } catch (_err) {
                resolve(null);
            }
        });

        return this.dbPromise;
    }

    /**
     * Record or update an active viewing session.
     */
    async recordSession(session: WatchSession): Promise<boolean> {
        if (!session || !session.id || !session.showId) return false;

        const db = await this.getDB();
        if (!db) return false;

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(
                    [
                        WatchHistoryService.STORE_SESSIONS,
                        WatchHistoryService.STORE_SHOWS,
                    ],
                    'readwrite',
                );
                const sessionStore = tx.objectStore(
                    WatchHistoryService.STORE_SESSIONS,
                );
                const showStore = tx.objectStore(
                    WatchHistoryService.STORE_SHOWS,
                );

                // 1. Check if session already exists to prevent duplicate heartbeat counting
                const prevSessionReq = sessionStore.get(session.id);
                prevSessionReq.onsuccess = () => {
                    const prevSession: WatchSession | undefined =
                        prevSessionReq.result;
                    const isNewSession = !prevSession;
                    const prevSeconds = prevSession?.effectiveWatchSeconds || 0;
                    const deltaSeconds = Math.max(
                        0,
                        (session.effectiveWatchSeconds || 0) - prevSeconds,
                    );

                    // Save or update session
                    sessionStore.put(session);

                    // 2. Update show summary with delta seconds only
                    const showReq = showStore.get(session.showId);
                    showReq.onsuccess = () => {
                        let summary: ShowWatchSummary = showReq.result;
                        if (!summary) {
                            summary = {
                                showId: session.showId,
                                showTitle: session.showTitle || 'Unknown Show',
                                platform: session.platform,
                                totalWatchSeconds:
                                    session.effectiveWatchSeconds || 0,
                                firstWatchedAt: session.startedAt,
                                lastWatchedAt:
                                    session.endedAt || session.startedAt,
                                sessionsCount: 1,
                                episodesCount: 1,
                                lastEpisode: {
                                    seasonNum: session.seasonNum,
                                    episodeNum: session.episodeNum,
                                    episodeTitle: session.episodeTitle,
                                    videoId: session.videoId,
                                    lastContentTime: session.toContentTime,
                                    videoDuration: session.videoDuration,
                                    updatedAt:
                                        session.endedAt || session.startedAt,
                                },
                            };
                        } else {
                            summary.totalWatchSeconds =
                                (summary.totalWatchSeconds || 0) + deltaSeconds;
                            summary.lastWatchedAt = Math.max(
                                summary.lastWatchedAt || 0,
                                session.endedAt || session.startedAt,
                            );
                            if (isNewSession) {
                                summary.sessionsCount =
                                    (summary.sessionsCount || 0) + 1;
                            }
                            summary.showTitle =
                                session.showTitle || summary.showTitle;
                            summary.platform =
                                session.platform || summary.platform;

                            // Update last episode progress
                            summary.lastEpisode = {
                                seasonNum:
                                    session.seasonNum !== undefined
                                        ? session.seasonNum
                                        : summary.lastEpisode?.seasonNum,
                                episodeNum:
                                    session.episodeNum !== undefined
                                        ? session.episodeNum
                                        : summary.lastEpisode?.episodeNum,
                                episodeTitle:
                                    session.episodeTitle ||
                                    summary.lastEpisode?.episodeTitle,
                                videoId: session.videoId,
                                lastContentTime: session.toContentTime,
                                videoDuration:
                                    session.videoDuration ||
                                    summary.lastEpisode?.videoDuration ||
                                    0,
                                updatedAt: session.endedAt || session.startedAt,
                            };
                        }

                        showStore.put(summary);
                    };
                };

                tx.oncomplete = () => {
                    this.logger.info(
                        'Record',
                        `Recorded session for "${session.showTitle}" (${session.effectiveWatchSeconds}s watched)`,
                    );
                    resolve(true);
                };

                tx.onerror = () => {
                    this.logger.warn(
                        'Record',
                        'Transaction error recording watch session',
                    );
                    resolve(false);
                };
            } catch (err) {
                this.logger.warn(
                    'Record',
                    'Failed to record watch session:',
                    err,
                );
                resolve(false);
            }
        });
    }

    /**
     * Get full watch history data including show summaries, recent sessions, and analytics stats.
     */
    async getWatchHistory(): Promise<{
        shows: ShowWatchSummary[];
        recentSessions: WatchSession[];
        stats: WatchHistoryStats;
    }> {
        const db = await this.getDB();
        if (!db) {
            return {
                shows: [],
                recentSessions: [],
                stats: {
                    totalWatchSeconds: 0,
                    totalShows: 0,
                    totalEpisodes: 0,
                    totalSessions: 0,
                    dailyStats: [],
                },
            };
        }

        const [shows, sessions] = await Promise.all([
            this.getAllShows(db),
            this.getAllSessions(db),
        ]);

        // Compute accurate stats per show from stored sessions
        const showEpMap = new Map<string, Set<string>>();
        const showStatsMap = new Map<
            string,
            { seconds: number; count: number }
        >();
        const allUniqueEpisodes = new Set<string>();
        let totalWatchSeconds = 0;
        const dailyMap = new Map<string, { seconds: number; count: number }>();

        for (const s of sessions) {
            totalWatchSeconds += s.effectiveWatchSeconds || 0;
            if (s.showId) {
                const st = showStatsMap.get(s.showId) || {
                    seconds: 0,
                    count: 0,
                };
                st.seconds += s.effectiveWatchSeconds || 0;
                st.count += 1;
                showStatsMap.set(s.showId, st);
            }
            if (s.videoId) {
                allUniqueEpisodes.add(s.videoId);
                if (!showEpMap.has(s.showId)) {
                    showEpMap.set(s.showId, new Set());
                }
                showEpMap.get(s.showId)!.add(s.videoId);
            }

            // Group by daily date
            const d = new Date(s.startedAt);
            const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const existingDaily = dailyMap.get(dateKey) || {
                seconds: 0,
                count: 0,
            };
            existingDaily.seconds += s.effectiveWatchSeconds || 0;
            existingDaily.count += 1;
            dailyMap.set(dateKey, existingDaily);
        }

        // Attach accurate episode counts & heal any heartbeat-inflated stats
        for (const show of shows) {
            const eps = showEpMap.get(show.showId);
            show.episodesCount = eps ? eps.size : show.episodesCount || 1;
            const st = showStatsMap.get(show.showId);
            if (st) {
                show.totalWatchSeconds = st.seconds;
                show.sessionsCount = st.count;
            }
        }

        // Build sorted daily trends
        const dailyStats: DailyWatchStat[] = Array.from(dailyMap.entries())
            .map(([date, val]) => ({
                date,
                watchSeconds: val.seconds,
                sessionsCount: val.count,
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        // Sort shows by lastWatchedAt descending
        shows.sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0));

        // Sort recent sessions descending, take top 500
        sessions.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
        const recentSessions = sessions.slice(0, 500);

        return {
            shows,
            recentSessions,
            stats: {
                totalWatchSeconds,
                totalShows: shows.length,
                totalEpisodes: allUniqueEpisodes.size,
                totalSessions: sessions.length,
                dailyStats,
            },
        };
    }

    private getAllShows(db: IDBDatabase): Promise<ShowWatchSummary[]> {
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(
                    WatchHistoryService.STORE_SHOWS,
                    'readonly',
                );
                const store = tx.objectStore(WatchHistoryService.STORE_SHOWS);
                const req = store.getAll();
                req.onsuccess = () =>
                    resolve((req.result || []) as ShowWatchSummary[]);
                req.onerror = () => resolve([]);
            } catch {
                resolve([]);
            }
        });
    }

    private getAllSessions(db: IDBDatabase): Promise<WatchSession[]> {
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(
                    WatchHistoryService.STORE_SESSIONS,
                    'readonly',
                );
                const store = tx.objectStore(
                    WatchHistoryService.STORE_SESSIONS,
                );
                const req = store.getAll();
                req.onsuccess = () =>
                    resolve((req.result || []) as WatchSession[]);
                req.onerror = () => resolve([]);
            } catch {
                resolve([]);
            }
        });
    }

    /**
     * Clear all viewing history.
     */
    async clearWatchHistory(): Promise<boolean> {
        const db = await this.getDB();
        if (!db) return false;

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(
                    [
                        WatchHistoryService.STORE_SESSIONS,
                        WatchHistoryService.STORE_SHOWS,
                    ],
                    'readwrite',
                );
                tx.objectStore(WatchHistoryService.STORE_SESSIONS).clear();
                tx.objectStore(WatchHistoryService.STORE_SHOWS).clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch {
                resolve(false);
            }
        });
    }

    /**
     * Delete viewing history for a single show.
     */
    async deleteShowHistory(showId: string): Promise<boolean> {
        const db = await this.getDB();
        if (!db || !showId) return false;

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(
                    [
                        WatchHistoryService.STORE_SESSIONS,
                        WatchHistoryService.STORE_SHOWS,
                    ],
                    'readwrite',
                );
                const showStore = tx.objectStore(
                    WatchHistoryService.STORE_SHOWS,
                );
                const sessionStore = tx.objectStore(
                    WatchHistoryService.STORE_SESSIONS,
                );

                showStore.delete(showId);

                const index = sessionStore.index('showId');
                const req = index.openCursor(IDBKeyRange.only(showId));
                req.onsuccess = () => {
                    const cursor = req.result;
                    if (cursor) {
                        cursor.delete();
                        cursor.continue();
                    }
                };

                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch {
                resolve(false);
            }
        });
    }

    /**
     * Fast aggregation of today's watch time, sessions, and platform breakdown, along with mindful rest stats.
     */
    async getTodayWatchStats(excludedPlatforms: string[] = []): Promise<{
        todaySeconds: number;
        todaySessions: number;
        platformSeconds: Record<string, number>;
        todayRestSeconds: number;
        todayBreakCount: number;
    }> {
        const restStats = await this.getTodayRestStats();
        const db = await this.getDB();
        if (!db) {
            return {
                todaySeconds: 0,
                todaySessions: 0,
                platformSeconds: {},
                todayRestSeconds: restStats.totalRestSeconds,
                todayBreakCount: restStats.breakCount,
            };
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const minTimestamp = todayStart.getTime();

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(
                    WatchHistoryService.STORE_SESSIONS,
                    'readonly',
                );
                const store = tx.objectStore(WatchHistoryService.STORE_SESSIONS);
                const index = store.index('startedAt');
                const range = IDBKeyRange.lowerBound(minTimestamp);
                const req = index.getAll(range);

                req.onsuccess = () => {
                    const sessions: WatchSession[] = req.result || [];
                    let todaySeconds = 0;
                    let todaySessions = 0;
                    const platformSeconds: Record<string, number> = {};
                    const excludedSet = new Set(excludedPlatforms);

                    for (const s of sessions) {
                        const sec = s.effectiveWatchSeconds || 0;
                        const p = s.platform || 'unknown';
                        platformSeconds[p] = (platformSeconds[p] || 0) + sec;
                        if (!excludedSet.has(p)) {
                            todaySeconds += sec;
                            todaySessions += 1;
                        }
                    }

                    resolve({
                        todaySeconds,
                        todaySessions,
                        platformSeconds,
                        todayRestSeconds: restStats.totalRestSeconds,
                        todayBreakCount: restStats.breakCount,
                    });
                };

                req.onerror = () => {
                    resolve({
                        todaySeconds: 0,
                        todaySessions: 0,
                        platformSeconds: {},
                        todayRestSeconds: restStats.totalRestSeconds,
                        todayBreakCount: restStats.breakCount,
                    });
                };
            } catch {
                resolve({
                    todaySeconds: 0,
                    todaySessions: 0,
                    platformSeconds: {},
                    todayRestSeconds: restStats.totalRestSeconds,
                    todayBreakCount: restStats.breakCount,
                });
            }
        });
    }

    /**
     * Record completed mindful break rest time.
     */
    async recordRestTime(seconds: number): Promise<{
        totalRestSeconds: number;
        breakCount: number;
    }> {
        if (!seconds || seconds <= 0) {
            return this.getTodayRestStats();
        }

        const d = new Date();
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const storageKey = `${NCW_STORAGE_KEYS.DAILY_REST_PREFIX}${dateKey}`;

        const res = await this.storage.get<{ totalRestSeconds?: number; breakCount?: number }>(storageKey);
        const raw = res[storageKey];
        const stats = {
            totalRestSeconds: (raw?.totalRestSeconds || 0) + seconds,
            breakCount: (raw?.breakCount || 0) + 1,
        };

        await this.storage.set({ [storageKey]: stats });
        this.logger.info(
            'Rest',
            `Recorded mindful rest: +${seconds}s (Today total: ${stats.totalRestSeconds}s, ${stats.breakCount} breaks)`,
        );
        return stats;
    }

    /**
     * Get today's mindful break rest stats.
     */
    async getTodayRestStats(): Promise<{
        totalRestSeconds: number;
        breakCount: number;
    }> {
        const d = new Date();
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const storageKey = `${NCW_STORAGE_KEYS.DAILY_REST_PREFIX}${dateKey}`;

        const res = await this.storage.get<{ totalRestSeconds?: number; breakCount?: number }>(storageKey);
        const raw = res[storageKey];
        return {
            totalRestSeconds: raw?.totalRestSeconds || 0,
            breakCount: raw?.breakCount || 0,
        };
    }
}
