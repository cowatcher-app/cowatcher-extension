import { CacheKey } from '@shared/domain/value-objects/CacheKey';
import { TrackCacheRecord } from '@shared/types/Messages';
import { createSubtitleCue } from '@shared/domain/entities/Subtitle';
import {
    ITrackCacheRepository,
    TrackCacheQueryParams,
    SaveTranslatedCuesParams,
    SaveReviewedCuesParams,
    MarkCuesStaleParams,
    VocabScanCheckParams,
    MarkVocabScannedParams,
} from '@shared/domain/repositories/ITrackCacheRepository';
import {
    computeTrackHash as computeTrackHashUtil,
    CueItemForHash,
} from '@shared/utils/hash';
import { CachedCueEntry } from '@shared/domain/entities/PipelineTypes';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';

export { CueItemForHash };

export class ChromeCacheRepository implements ITrackCacheRepository {
    private static DB_NAME = 'NCW_SubtitleCacheDB';
    private static DB_VERSION = 1;
    private static STORE_NAME = 'track_caches';
    private static MAX_CACHE_ENTRIES = 120;

    private static _dbPromise: Promise<IDBDatabase | null> | null = null;
    private static _instance: ChromeCacheRepository | null = null;

    static getInstance(): ChromeCacheRepository {
        if (!this._instance) {
            this._instance = new ChromeCacheRepository();
        }
        return this._instance;
    }

    static async computeTrackHash(cues: CueItemForHash[]): Promise<string> {
        return computeTrackHashUtil(cues);
    }

    static async getDB(): Promise<IDBDatabase | null> {
        if (typeof indexedDB === 'undefined') {
            return null;
        }
        if (this._dbPromise) {
            return this._dbPromise;
        }

        this._dbPromise = new Promise((resolve) => {
            try {
                const req = indexedDB.open(
                    ChromeCacheRepository.DB_NAME,
                    ChromeCacheRepository.DB_VERSION,
                );

                req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
                    const db = (e.target as IDBOpenDBRequest).result;
                    if (
                        !db.objectStoreNames.contains(
                            ChromeCacheRepository.STORE_NAME,
                        )
                    ) {
                        const store = db.createObjectStore(
                            ChromeCacheRepository.STORE_NAME,
                            {
                                keyPath: 'cacheKey',
                            },
                        );
                        store.createIndex('trackHash', 'trackHash', {
                            unique: false,
                        });
                        store.createIndex('updatedAt', 'updatedAt', {
                            unique: false,
                        });
                        store.createIndex('movieId', 'movieId', {
                            unique: false,
                        });
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

        return this._dbPromise;
    }

    static getCacheKey(params: {
        trackHash: string;
        targetLanguage: string;
        provider: string;
        translationModel: string;
    }): string {
        return CacheKey.create(params).toString();
    }

    static async getTrackCache(
        params:
            | {
                  trackHash: string;
                  targetLanguage: string;
                  provider: string;
                  translationModel: string;
              }
            | string,
    ): Promise<TrackCacheRecord | null> {
        const cacheKey =
            typeof params === 'string' ? params : this.getCacheKey(params);
        if (!cacheKey) return null;

        const db = await this.getDB();
        if (db) {
            try {
                const record = await new Promise<TrackCacheRecord | null>(
                    (resolve) => {
                        const tx = db.transaction(
                            ChromeCacheRepository.STORE_NAME,
                            'readonly',
                        );
                        const store = tx.objectStore(
                            ChromeCacheRepository.STORE_NAME,
                        );
                        const req = store.get(cacheKey);
                        req.onsuccess = () =>
                            resolve((req.result as TrackCacheRecord) || null);
                        req.onerror = () => resolve(null);
                    },
                );
                if (record) return record;
            } catch (_e) {
                // Fallback
            }
        }

        try {
            const storage = BrowserStorageFactory.getStorage();
            const res = await storage.get<TrackCacheRecord>([cacheKey]);
            return res && res[cacheKey] ? res[cacheKey] : null;
        } catch (_e) {
            return null;
        }
    }

    static async saveTranslatedCues(params: {
        trackHash: string;
        movieId: string;
        showTitle: string;
        targetLanguage: string;
        provider: string;
        translationModel: string;
        supervisorModel?: string;
        items?: Array<{ id: number; text?: string }>;
        results: Record<string | number, string>;
        status?: 'raw' | 'reviewed';
        usedTermsMap?: Record<number, Record<string, number>>;
    }): Promise<boolean> {
        const {
            trackHash,
            movieId,
            showTitle,
            targetLanguage,
            provider,
            translationModel,
            supervisorModel,
            items,
            results,
            status,
            usedTermsMap,
        } = params;
        if (!trackHash || !results || Object.keys(results).length === 0)
            return false;

        const cacheKey = this.getCacheKey({
            trackHash,
            targetLanguage,
            provider,
            translationModel,
        });
        let record = (await this.getTrackCache(cacheKey)) || {
            cacheKey,
            trackHash,
            movieId: movieId || '',
            showTitle: showTitle || '',
            targetLanguage: targetLanguage || 'English',
            provider: provider || 'ollama',
            translationModel: translationModel || '',
            supervisorModel: supervisorModel || '',
            cues: {},
            vocabScannedChunks: [],
            createdAt: Date.now(),
        };

        const itemsMap = new Map<
            number,
            { text?: string; start?: number; end?: number }
        >();
        if (Array.isArray(items)) {
            items.forEach((it) => {
                if (it && it.id !== undefined) itemsMap.set(it.id, it);
            });
        }

        const now = Date.now();
        for (const [idStr, translatedText] of Object.entries(results)) {
            const id = parseInt(idStr, 10);
            if (isNaN(id) || !translatedText) continue;

            const existing = record.cues[id];
            if (
                existing &&
                existing.status === 'reviewed' &&
                existing.transText
            ) {
                continue;
            }

            record.cues[id] = createSubtitleCue({
                id,
                rawText: existing?.rawText,
                transText: translatedText,
                status:
                    status === 'reviewed' ||
                    existing?.status === 'reviewed' ||
                    provider === 'netflix_native'
                        ? 'reviewed'
                        : existing?.status === 'pre_reviewed'
                          ? 'pre_reviewed'
                          : 'raw',
                vocabScanned: existing?.vocabScanned || false,
                usedTerms: usedTermsMap?.[id] ?? existing?.usedTerms,
                startTime: existing?.startTime ?? 0,
                endTime: existing?.endTime ?? 0,
                updatedAt: now,
            });
        }

        record.updatedAt = now;
        record.translatedCount = Object.keys(record.cues).length;
        record.reviewedCount = Object.values(record.cues).filter(
            (c) => c.status === 'reviewed' || c.status === 'pre_reviewed',
        ).length;

        await this._writeRecord(record);
        return true;
    }

    static async saveReviewedCues(params: {
        trackHash: string;
        movieId: string;
        showTitle: string;
        targetLanguage: string;
        provider: string;
        translationModel: string;
        supervisorModel?: string;
        items: CachedCueEntry[];
        corrections?: Record<string | number, string>;
        status?: 'reviewed' | 'pre_reviewed';
        usedTermsMap?: Record<number, Record<string, number>>;
    }): Promise<boolean> {
        const {
            trackHash,
            movieId,
            showTitle,
            targetLanguage,
            provider,
            translationModel,
            supervisorModel,
            items,
            corrections = {},
            status = 'reviewed',
            usedTermsMap = {},
        } = params;
        if (!trackHash || !items || items.length === 0) return false;

        const cacheKey = this.getCacheKey({
            trackHash,
            targetLanguage,
            provider,
            translationModel,
        });
        let record = (await this.getTrackCache(cacheKey)) || {
            cacheKey,
            trackHash,
            movieId: movieId || '',
            showTitle: showTitle || '',
            targetLanguage: targetLanguage || 'English',
            provider: provider || 'ollama',
            translationModel: translationModel || '',
            supervisorModel: supervisorModel || '',
            cues: {},
            vocabScannedChunks: [],
            createdAt: Date.now(),
        };

        const now = Date.now();
        for (const item of items) {
            if (!item || item.id === undefined) continue;
            const id = item.id;
            const corrected = corrections[id] || corrections[String(id)];
            const finalText =
                corrected && corrected.trim().length > 0
                    ? corrected.trim()
                    : item.transText || '';
            const existing = record.cues[id];

            record.cues[id] = createSubtitleCue({
                id,
                rawText: item?.rawText || existing?.rawText || '',
                transText: finalText,
                status,
                usedTerms: usedTermsMap[id] || existing?.usedTerms,
                vocabScanned: existing?.vocabScanned || false,
                startTime: item?.startTime ?? existing?.startTime ?? 0,
                endTime: item.endTime ?? existing?.endTime ?? 0,
                updatedAt: now,
            });
        }

        record.updatedAt = now;
        record.translatedCount = Object.keys(record.cues).length;
        record.reviewedCount = Object.values(record.cues).filter(
            (c) => c.status === 'reviewed' || c.status === 'pre_reviewed',
        ).length;

        await this._writeRecord(record);
        return true;
    }

    static async markCuesStaleByTimeRange(params: {
        trackHash?: string;
        cacheKey?: string;
        movieId?: string;
        movieIds?: string[];
        showTitle?: string;
        showId?: string;
        startTime?: number;
        endTime?: number;
    }): Promise<number> {
        const {
            trackHash,
            cacheKey: explicitKey,
            movieId,
            movieIds,
            showTitle,
            showId,
            startTime = 0,
            endTime = Number.MAX_SAFE_INTEGER,
        } = params;
        let recordsToUpdate: TrackCacheRecord[] = [];

        if (explicitKey) {
            const rec = await this.getTrackCache(explicitKey);
            if (rec) recordsToUpdate.push(rec);
        } else {
            const all = await this.getAllTrackCaches();
            const movieIdSet = new Set<string>();
            if (movieId) movieIdSet.add(String(movieId));
            if (Array.isArray(movieIds)) {
                movieIds.forEach((id) => {
                    if (id) movieIdSet.add(String(id));
                });
            }

            recordsToUpdate = all.filter((t) => {
                if (trackHash && t.trackHash === trackHash) return true;
                if (
                    movieIdSet.size > 0 &&
                    t.movieId &&
                    movieIdSet.has(String(t.movieId))
                )
                    return true;
                if (showId && t.showTitle && t.showTitle.includes(showId))
                    return true;
                if (showTitle && t.showTitle) {
                    const sTitle = showTitle.trim().toLowerCase();
                    const tTitle = t.showTitle.trim().toLowerCase();
                    if (
                        tTitle === sTitle ||
                        tTitle.includes(sTitle) ||
                        sTitle.includes(tTitle)
                    ) {
                        return true;
                    }
                }
                return false;
            });
        }

        let totalInvalidated = 0;
        const now = Date.now();

        for (const record of recordsToUpdate) {
            let changed = false;
            for (const cue of Object.values(record.cues || {})) {
                const cueStart = cue.startTime ?? 0;
                const cueEnd = cue.endTime ?? cueStart + 5;
                // Check if cue overlaps with [startTime, endTime]
                const inRange = cueStart <= endTime && cueEnd >= startTime;
                if (inRange && cue.status !== 'stale') {
                    cue.status = 'stale';
                    cue.updatedAt = now;
                    changed = true;
                    totalInvalidated++;
                }
            }

            if (changed) {
                record.updatedAt = now;
                record.reviewedCount = Object.values(record.cues).filter(
                    (c) =>
                        c.status === 'reviewed' || c.status === 'pre_reviewed',
                ).length;
                await this._writeRecord(record);
            }
        }

        return totalInvalidated;
    }

    static async isVocabScanned(params: {
        trackHash: string;
        targetLanguage: string;
        provider: string;
        translationModel: string;
        chunkSig: string;
        cueIds?: number[];
    }): Promise<boolean> {
        const {
            trackHash,
            targetLanguage,
            provider,
            translationModel,
            chunkSig,
            cueIds,
        } = params;
        if (!trackHash) return false;
        const cacheKey = this.getCacheKey({
            trackHash,
            targetLanguage,
            provider,
            translationModel,
        });
        const record = await this.getTrackCache(cacheKey);
        if (!record) return false;

        if (
            chunkSig &&
            Array.isArray(record.vocabScannedChunks) &&
            record.vocabScannedChunks.includes(chunkSig)
        ) {
            return true;
        }

        if (Array.isArray(cueIds) && cueIds.length > 0 && record.cues) {
            return cueIds.every(
                (id) => record.cues[id] && record.cues[id].vocabScanned,
            );
        }

        return false;
    }

    static async markVocabScanned(params: {
        trackHash: string;
        targetLanguage: string;
        provider: string;
        translationModel: string;
        chunkSig: string;
        cueIds?: number[];
    }): Promise<boolean> {
        const {
            trackHash,
            targetLanguage,
            provider,
            translationModel,
            chunkSig,
            cueIds,
        } = params;
        if (!trackHash) return false;
        const cacheKey = this.getCacheKey({
            trackHash,
            targetLanguage,
            provider,
            translationModel,
        });
        let record = await this.getTrackCache(cacheKey);
        if (!record) return false;

        if (!Array.isArray(record.vocabScannedChunks)) {
            record.vocabScannedChunks = [];
        }
        if (chunkSig && !record.vocabScannedChunks.includes(chunkSig)) {
            record.vocabScannedChunks.push(chunkSig);
        }

        if (Array.isArray(cueIds) && record.cues) {
            cueIds.forEach((id) => {
                if (record.cues[id]) {
                    record.cues[id].vocabScanned = true;
                }
            });
        }

        record.updatedAt = Date.now();
        await this._writeRecord(record);
        return true;
    }

    private static async _writeRecord(record: TrackCacheRecord): Promise<void> {
        const db = await this.getDB();
        if (db) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const tx = db.transaction(
                        ChromeCacheRepository.STORE_NAME,
                        'readwrite',
                    );
                    const store = tx.objectStore(
                        ChromeCacheRepository.STORE_NAME,
                    );
                    store.put(record);
                    tx.oncomplete = () => resolve();
                    tx.onerror = (e) => reject(e);
                });

                this._pruneOldRecords(db).catch(() => {});
                return;
            } catch (_e) {
                // Fallback
            }
        }

        try {
            const storage = BrowserStorageFactory.getStorage();
            await storage.set({ [record.cacheKey]: record });
        } catch (_e) {
            // Ignore fallback error
        }
    }

    static async getAllTrackCaches(): Promise<TrackCacheRecord[]> {
        const listMap = new Map<string, TrackCacheRecord>();

        const db = await this.getDB();
        if (db) {
            try {
                const records = await new Promise<TrackCacheRecord[]>(
                    (resolve) => {
                        const tx = db.transaction(
                            ChromeCacheRepository.STORE_NAME,
                            'readonly',
                        );
                        const store = tx.objectStore(
                            ChromeCacheRepository.STORE_NAME,
                        );
                        const req = store.getAll();
                        req.onsuccess = () =>
                            resolve((req.result as TrackCacheRecord[]) || []);
                        req.onerror = () => resolve([]);
                    },
                );
                records.forEach((r) => {
                    if (r && r.cacheKey) listMap.set(r.cacheKey, r);
                });
            } catch (_e) {
                // Fallback
            }
        }

        try {
            const storage = BrowserStorageFactory.getStorage();
            const all = await storage.get<TrackCacheRecord>(null);
            if (all) {
                for (const [k, v] of Object.entries(all)) {
                    if (
                        k.startsWith('ncw_sub_') &&
                        v &&
                        (v as TrackCacheRecord).cacheKey &&
                        !listMap.has(k)
                    ) {
                        listMap.set(k, v as TrackCacheRecord);
                    }
                }
            }
        } catch (_e) {
            // Ignore fallback error
        }

        const arr = Array.from(listMap.values());
        arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return arr;
    }

    static async deleteTrackCache(cacheKey: string): Promise<boolean> {
        if (!cacheKey) return false;
        let success = true;
        const db = await this.getDB();
        if (db) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const tx = db.transaction(
                        ChromeCacheRepository.STORE_NAME,
                        'readwrite',
                    );
                    const store = tx.objectStore(
                        ChromeCacheRepository.STORE_NAME,
                    );
                    const req = store.delete(cacheKey);
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                });
            } catch (_e) {
                success = false;
            }
        }

        try {
            const storage = BrowserStorageFactory.getStorage();
            await storage.remove([cacheKey]);
        } catch (_e) {
            // Ignore fallback error
        }
        return success;
    }

    static getRetentionMs(period: '1w' | '1m' | '1y' = '1m'): number {
        switch (period) {
            case '1w':
                return 7 * 24 * 60 * 60 * 1000;
            case '1m':
                return 30 * 24 * 60 * 60 * 1000;
            case '1y':
                return 365 * 24 * 60 * 60 * 1000;
            default:
                return 30 * 24 * 60 * 60 * 1000;
        }
    }

    static async cleanExpiredRecords(
        retention: '1w' | '1m' | '1y' = '1m',
    ): Promise<number> {
        let deletedCount = 0;
        const db = await this.getDB();
        if (db) {
            try {
                const ttlMs = this.getRetentionMs(retention);
                const cutoff = Date.now() - ttlMs;
                deletedCount = await new Promise<number>((resolve) => {
                    const tx = db.transaction(
                        ChromeCacheRepository.STORE_NAME,
                        'readwrite',
                    );
                    const store = tx.objectStore(
                        ChromeCacheRepository.STORE_NAME,
                    );
                    const index = store.index('updatedAt');
                    const range = IDBKeyRange.upperBound(cutoff);
                    const req = index.openCursor(range);
                    let count = 0;

                    req.onsuccess = (e) => {
                        const cursor = (e.target as IDBRequest)
                            .result as IDBCursorWithValue;
                        if (cursor) {
                            cursor.delete();
                            count++;
                            cursor.continue();
                        } else {
                            resolve(count);
                        }
                    };

                    req.onerror = () => resolve(count);
                });
            } catch (_e) {}
        }
        return deletedCount;
    }

    static async clearAllTrackCaches(): Promise<boolean> {
        let success = true;
        const db = await this.getDB();
        if (db) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const tx = db.transaction(
                        ChromeCacheRepository.STORE_NAME,
                        'readwrite',
                    );
                    const store = tx.objectStore(
                        ChromeCacheRepository.STORE_NAME,
                    );
                    const req = store.clear();
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                });
            } catch (_e) {
                success = false;
            }
        }

        try {
            const storage = BrowserStorageFactory.getStorage();
            const all = await storage.get<unknown>(null);
            if (all) {
                const toRemove = Object.keys(all).filter((k) =>
                    k.startsWith('ncw_sub_'),
                );
                if (toRemove.length > 0) {
                    await storage.remove(toRemove);
                }
            }
        } catch (_e) {
            // Ignore fallback error
        }
        return success;
    }

    // --- ITrackCacheRepository Instance Implementation ---
    async getTrackCache(
        params: TrackCacheQueryParams | string,
    ): Promise<TrackCacheRecord | null> {
        return ChromeCacheRepository.getTrackCache(params);
    }

    async saveTranslatedCues(
        params: SaveTranslatedCuesParams,
    ): Promise<boolean> {
        return ChromeCacheRepository.saveTranslatedCues(params);
    }

    async saveReviewedCues(params: SaveReviewedCuesParams): Promise<boolean> {
        return ChromeCacheRepository.saveReviewedCues(params);
    }

    async markCuesStaleByTimeRange(
        params: MarkCuesStaleParams,
    ): Promise<number> {
        return ChromeCacheRepository.markCuesStaleByTimeRange(params);
    }

    async isVocabScanned(params: VocabScanCheckParams): Promise<boolean> {
        return ChromeCacheRepository.isVocabScanned(params);
    }

    async markVocabScanned(params: MarkVocabScannedParams): Promise<boolean> {
        return ChromeCacheRepository.markVocabScanned(params);
    }

    async getAllTrackCaches(): Promise<TrackCacheRecord[]> {
        return ChromeCacheRepository.getAllTrackCaches();
    }

    async deleteTrackCache(cacheKey: string): Promise<boolean> {
        return ChromeCacheRepository.deleteTrackCache(cacheKey);
    }

    async clearAllTrackCaches(): Promise<boolean> {
        return ChromeCacheRepository.clearAllTrackCaches();
    }

    async cleanExpiredRecords(
        retention: '1w' | '1m' | '1y' = '1m',
    ): Promise<number> {
        return ChromeCacheRepository.cleanExpiredRecords(retention);
    }

    private static async _pruneOldRecords(db: IDBDatabase): Promise<void> {
        if (!db) return;
        try {
            const storage = BrowserStorageFactory.getStorage();
            const res = await storage.get<Record<string, unknown>>(['settings']);
            const settings = res?.settings as { cacheRetention?: '1w' | '1m' | '1y' } | undefined;
            const retention = settings?.cacheRetention || '1m';
            await this.cleanExpiredRecords(retention);
        } catch (_e) {}
        try {
            const tx = db.transaction(
                ChromeCacheRepository.STORE_NAME,
                'readwrite',
            );
            const store = tx.objectStore(ChromeCacheRepository.STORE_NAME);
            const index = store.index('updatedAt');
            const countReq = store.count();

            countReq.onsuccess = () => {
                const count = countReq.result;
                if (count > ChromeCacheRepository.MAX_CACHE_ENTRIES) {
                    const excess =
                        count - ChromeCacheRepository.MAX_CACHE_ENTRIES;
                    let deleted = 0;
                    const cursorReq = index.openCursor();

                    cursorReq.onsuccess = (e) => {
                        const cursor = (e.target as IDBRequest)
                            .result as IDBCursorWithValue;
                        if (cursor && deleted < excess) {
                            cursor.delete();
                            deleted++;
                            cursor.continue();
                        }
                    };
                }
            };
        } catch (_e) {}
    }
}

export default ChromeCacheRepository;
