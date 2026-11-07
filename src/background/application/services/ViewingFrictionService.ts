/**
 * ViewingFrictionService
 * Background central coordinator for Viewing Static Friction (Mindful Viewing).
 *
 * Enforces cross-tab continuous viewing tracking and mandatory health intermission:
 * - Aggregates playback heartbeats across all streaming tabs into a single global counter.
 * - Manages the ActiveFrictionBreak state machine (cannot be bypassed by refreshing or closing tabs).
 * - Tracks remaining break seconds, requiring full completion before playback is unlocked.
 */

import { ActiveFrictionBreak } from '@shared/domain/entities/ViewingFriction';
import { ExtensionSettings } from '@shared/domain/constants/SettingsDefaults';
import { NCW_STORAGE_KEYS } from '@shared/domain/constants/StorageKeys';
import { IBrowserStorage } from '@shared/infrastructure/storage/IBrowserStorage';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { WatchHistoryService } from './WatchHistoryService';
import { Logger } from '@shared/utils/logger';

interface PersistedFrictionState {
    globalContinuousSeconds: number;
    activeBreak: ActiveFrictionBreak | null;
    isStoppedForToday: boolean;
    lastStoppedDate: string;
    lastCurfewTriggerKey: string;
    lastDailyTriggerKey: string;
    savedAt: number;
}

export class ViewingFrictionService {
    private static instance: ViewingFrictionService | null = null;
    private readonly logger = new Logger('ViewingFrictionService');

    private globalContinuousSeconds: number = 0;
    private lastHeartbeatTimestamp: number = 0;
    private activeBreak: ActiveFrictionBreak | null = null;
    private isStoppedForToday: boolean = false;
    private lastStoppedDate: string = '';

    private lastCurfewTriggerKey: string = '';
    private lastDailyTriggerKey: string = '';

    private isLoaded: boolean = false;
    private loadPromise: Promise<void> | null = null;

    private constructor(
        private readonly storage: IBrowserStorage = BrowserStorageFactory.getStorage(),
        private readonly watchHistoryService: WatchHistoryService = WatchHistoryService.getInstance(),
    ) {
        this.loadPromise = this.loadPersistedState();
    }

    static getInstance(): ViewingFrictionService {
        if (!ViewingFrictionService.instance) {
            ViewingFrictionService.instance = new ViewingFrictionService();
        }
        return ViewingFrictionService.instance;
    }

    private async loadPersistedState(): Promise<void> {
        try {
            const res = await this.storage.get<PersistedFrictionState>(
                NCW_STORAGE_KEYS.FRICTION_GLOBAL_STATE,
            );
            const state = res?.[NCW_STORAGE_KEYS.FRICTION_GLOBAL_STATE];
            if (state) {
                this.globalContinuousSeconds = state.globalContinuousSeconds || 0;
                this.activeBreak = state.activeBreak || null;
                this.isStoppedForToday = Boolean(state.isStoppedForToday);
                this.lastStoppedDate = state.lastStoppedDate || '';
                this.lastCurfewTriggerKey = state.lastCurfewTriggerKey || '';
                this.lastDailyTriggerKey = state.lastDailyTriggerKey || '';

                // Reset isStoppedForToday if day changed and past 05:00 AM
                const todayStr = new Date().toDateString();
                if (
                    this.isStoppedForToday &&
                    this.lastStoppedDate !== todayStr &&
                    new Date().getHours() >= 5
                ) {
                    this.isStoppedForToday = false;
                    this.lastCurfewTriggerKey = '';
                    this.lastDailyTriggerKey = '';
                }
            }
        } catch {
            // Ignore storage load failure
        } finally {
            this.isLoaded = true;
        }
    }

    private async persistState(): Promise<void> {
        try {
            const state: PersistedFrictionState = {
                globalContinuousSeconds: this.globalContinuousSeconds,
                activeBreak: this.activeBreak,
                isStoppedForToday: this.isStoppedForToday,
                lastStoppedDate: this.lastStoppedDate,
                lastCurfewTriggerKey: this.lastCurfewTriggerKey,
                lastDailyTriggerKey: this.lastDailyTriggerKey,
                savedAt: Date.now(),
            };
            await this.storage.set({
                [NCW_STORAGE_KEYS.FRICTION_GLOBAL_STATE]: state,
            });
        } catch {
            // Ignore storage set failure
        }
    }

    /**
     * Process heartbeat from content script.
     * Called every second when video is playing or active in a tab.
     */
    async handleHeartbeat(params: {
        isPlaying: boolean;
        platform: string;
        showTitle?: string;
    }): Promise<{
        shouldPause: boolean;
        activeBreak: ActiveFrictionBreak | null;
        continuousSeconds: number;
        todaySeconds: number;
        todayRestSeconds: number;
        todayBreakCount: number;
        isStoppedForToday: boolean;
    }> {
        if (!this.isLoaded && this.loadPromise) {
            await this.loadPromise;
        }

        const settingsRes = await this.storage.get<ExtensionSettings>(
            NCW_STORAGE_KEYS.SETTINGS,
        );
        const settings = settingsRes?.[NCW_STORAGE_KEYS.SETTINGS] || {};

        const excluded = settings.frictionExcludedPlatforms || [];
        const todayStats = await this.watchHistoryService.getTodayWatchStats(excluded);

        // Daily reset check for stopped status
        const todayStr = new Date().toDateString();
        if (
            this.isStoppedForToday &&
            this.lastStoppedDate !== todayStr &&
            new Date().getHours() >= 5
        ) {
            this.isStoppedForToday = false;
            this.lastCurfewTriggerKey = '';
            this.lastDailyTriggerKey = '';
            await this.persistState();
        }

        // 1. If static friction is globally disabled, do not pause or enforce breaks
        if (!settings.staticFrictionEnabled) {
            if (this.isStoppedForToday || this.activeBreak) {
                this.isStoppedForToday = false;
                this.activeBreak = null;
                this.globalContinuousSeconds = 0;
                await this.persistState();
            }
            return {
                shouldPause: false,
                activeBreak: null,
                continuousSeconds: 0,
                todaySeconds: todayStats.todaySeconds,
                todayRestSeconds: todayStats.todayRestSeconds,
                todayBreakCount: todayStats.todayBreakCount,
                isStoppedForToday: false,
            };
        }

        // 2. If platform is specifically disabled in rules
        const platformRules = settings.frictionPlatformRules?.[params.platform];
        if (platformRules?.enabled === false) {
            return {
                shouldPause: false,
                activeBreak: null,
                continuousSeconds: Math.round(this.globalContinuousSeconds),
                todaySeconds: todayStats.todaySeconds,
                todayRestSeconds: todayStats.todayRestSeconds,
                todayBreakCount: todayStats.todayBreakCount,
                isStoppedForToday: false,
            };
        }

        // 3. If user already clicked "I'm Done for Today", lock playback
        if (this.isStoppedForToday) {
            return {
                shouldPause: true,
                activeBreak: this.activeBreak,
                continuousSeconds: Math.round(this.globalContinuousSeconds),
                todaySeconds: todayStats.todaySeconds,
                todayRestSeconds: todayStats.todayRestSeconds,
                todayBreakCount: todayStats.todayBreakCount,
                isStoppedForToday: true,
            };
        }

        // 4. If an active mandatory break is already pending, player MUST pause and serve the break!
        if (this.activeBreak) {
            return {
                shouldPause: true,
                activeBreak: this.activeBreak,
                continuousSeconds: Math.round(this.globalContinuousSeconds),
                todaySeconds: todayStats.todaySeconds,
                todayRestSeconds: todayStats.todayRestSeconds,
                todayBreakCount: todayStats.todayBreakCount,
                isStoppedForToday: false,
            };
        }

        const effectiveIntervalMin =
            typeof platformRules?.intervalMinutes === 'number' &&
            platformRules.intervalMinutes > 0
                ? platformRules.intervalMinutes
                : Number(settings.frictionIntervalMinutes) || 45;

        const effectiveDailyLimitMin =
            typeof platformRules?.dailyLimitMinutes === 'number' &&
            platformRules.dailyLimitMinutes > 0
                ? platformRules.dailyLimitMinutes
                : Number(settings.frictionDailyLimitMinutes) || 0;

        const now = Date.now();

        // Accumulate continuous seconds across active playback tabs
        if (params.isPlaying) {
            if (this.lastHeartbeatTimestamp > 0) {
                const deltaSec = (now - this.lastHeartbeatTimestamp) / 1000;
                // Allow up to 30s delta to properly support browser background tab throttling
                if (deltaSec > 0 && deltaSec <= 30) {
                    this.globalContinuousSeconds += deltaSec;
                } else {
                    this.globalContinuousSeconds += 1;
                }
            } else {
                this.globalContinuousSeconds += 1;
            }
            this.lastHeartbeatTimestamp = now;

            // Periodically persist running continuous seconds
            if (Math.round(this.globalContinuousSeconds) % 5 === 0) {
                this.persistState().catch(() => {});
            }
        } else {
            // When playback is paused or inactive, reset timestamp to prevent gap overcrediting
            this.lastHeartbeatTimestamp = 0;
        }

        // 1. Check Late-Night Curfew
        if (settings.frictionCurfewEnabled) {
            const curfewTimeStr = settings.frictionCurfewTime || '23:30';
            if (this.isPastCurfew(curfewTimeStr)) {
                if (this.lastCurfewTriggerKey !== todayStr) {
                    this.lastCurfewTriggerKey = todayStr;
                    this.activeBreak = {
                        id: `brk_${now}_${Math.random().toString(36).slice(2, 6)}`,
                        reason: 'curfew',
                        totalSeconds: 0,
                        remainingSeconds: 0,
                        startedAt: now,
                        isHardBlock: true,
                        curfewTime: curfewTimeStr,
                        showTitle: params.showTitle,
                        platform: params.platform,
                    };
                    await this.persistState();
                    return {
                        shouldPause: true,
                        activeBreak: this.activeBreak,
                        continuousSeconds: Math.round(this.globalContinuousSeconds),
                        todaySeconds: todayStats.todaySeconds,
                        todayRestSeconds: todayStats.todayRestSeconds,
                        todayBreakCount: todayStats.todayBreakCount,
                        isStoppedForToday: false,
                    };
                }
            }
        }

        // 2. Check Daily Limit
        if (effectiveDailyLimitMin > 0) {
            if (todayStats.todaySeconds / 60 >= effectiveDailyLimitMin) {
                if (
                    this.lastDailyTriggerKey !== todayStr ||
                    effectiveDailyLimitMin <= 1
                ) {
                    if (effectiveDailyLimitMin > 1) {
                        this.lastDailyTriggerKey = todayStr;
                    }
                    this.activeBreak = {
                        id: `brk_${now}_${Math.random().toString(36).slice(2, 6)}`,
                        reason: 'daily_limit',
                        totalSeconds: 0,
                        remainingSeconds: 0,
                        startedAt: now,
                        isHardBlock: true,
                        showTitle: params.showTitle,
                        platform: params.platform,
                    };
                    await this.persistState();
                    return {
                        shouldPause: true,
                        activeBreak: this.activeBreak,
                        continuousSeconds: Math.round(this.globalContinuousSeconds),
                        todaySeconds: todayStats.todaySeconds,
                        todayRestSeconds: todayStats.todayRestSeconds,
                        todayBreakCount: todayStats.todayBreakCount,
                        isStoppedForToday: false,
                    };
                }
            }
        }

        // 3. Check Continuous Interval
        if (
            effectiveIntervalMin > 0 &&
            this.globalContinuousSeconds >= effectiveIntervalMin * 60
        ) {
            const duration = settings.frictionBreakDurationSeconds || 20;
            this.activeBreak = {
                id: `brk_${now}_${Math.random().toString(36).slice(2, 6)}`,
                reason: 'interval',
                totalSeconds: duration,
                remainingSeconds: duration,
                startedAt: now,
                isHardBlock: false,
                showTitle: params.showTitle,
                platform: params.platform,
            };
            await this.persistState();
            return {
                shouldPause: true,
                activeBreak: this.activeBreak,
                continuousSeconds: Math.round(this.globalContinuousSeconds),
                todaySeconds: todayStats.todaySeconds,
                todayRestSeconds: todayStats.todayRestSeconds,
                todayBreakCount: todayStats.todayBreakCount,
                isStoppedForToday: false,
            };
        }

        return {
            shouldPause: false,
            activeBreak: null,
            continuousSeconds: Math.round(this.globalContinuousSeconds),
            todaySeconds: todayStats.todaySeconds,
            todayRestSeconds: todayStats.todayRestSeconds,
            todayBreakCount: todayStats.todayBreakCount,
            isStoppedForToday: false,
        };
    }

    /**
     * Decrement remaining seconds while user sits in front of the active break overlay.
     */
    async handleTickBreak(breakId: string): Promise<{
        remainingSeconds: number;
        isCompleted: boolean;
    }> {
        if (!this.activeBreak || this.activeBreak.id !== breakId) {
            return { remainingSeconds: 0, isCompleted: true };
        }

        this.activeBreak.remainingSeconds = Math.max(
            0,
            this.activeBreak.remainingSeconds - 1,
        );

        this.persistState().catch(() => {});
        return {
            remainingSeconds: this.activeBreak.remainingSeconds,
            isCompleted:
                this.activeBreak.remainingSeconds <= 0 &&
                !this.activeBreak.isHardBlock,
        };
    }

    /**
     * Update challenge failure count, sequence length, and button lockout timestamp.
     */
    async handleUpdatePenalty(params: {
        breakId: string;
        consecutiveFailures: number;
        sequenceLength: number;
        lockoutUntil?: number;
    }): Promise<{ success: boolean }> {
        if (!this.activeBreak || this.activeBreak.id !== params.breakId) {
            return { success: false };
        }
        this.activeBreak.consecutiveFailures = params.consecutiveFailures;
        this.activeBreak.sequenceLength = params.sequenceLength;
        this.activeBreak.lockoutUntil = params.lockoutUntil;
        await this.persistState();
        return { success: true };
    }

    /**
     * Complete the mandatory break.
     * Records rest time, clears active break, resets continuous counter to 0, and unlocks playback.
     */
    async handleCompleteBreak(
        breakId: string,
        _passedChallenge: boolean = false,
    ): Promise<{ success: boolean; canResume: boolean }> {
        if (!this.activeBreak || this.activeBreak.id !== breakId) {
            return { success: false, canResume: true };
        }

        const duration = this.activeBreak.totalSeconds || 20;
        await this.watchHistoryService.recordRestTime(duration);

        this.logger.info(
            'ViewingFrictionService',
            `Break fulfilled (${duration}s). Resetting global continuous timer.`,
        );

        this.activeBreak = null;
        this.globalContinuousSeconds = 0;
        this.lastHeartbeatTimestamp = Date.now();
        await this.persistState();

        return { success: true, canResume: true };
    }

    /**
     * User clicked "I'm Done for Today" on a hard block (Curfew / Daily Limit) or interval.
     */
    async handleDismissHardBlock(breakId: string): Promise<{ success: boolean }> {
        if (this.activeBreak && this.activeBreak.id === breakId) {
            const duration = this.activeBreak.totalSeconds || 20;
            if (duration > 0) {
                await this.watchHistoryService.recordRestTime(duration);
            }
        }

        this.isStoppedForToday = true;
        this.lastStoppedDate = new Date().toDateString();
        this.activeBreak = null;
        this.globalContinuousSeconds = 0;
        await this.persistState();

        return { success: true };
    }

    /**
     * User clicked "Continue Watching" from a stopped / resting state.
     * Clears isStoppedForToday and resets continuous timer.
     */
    async handleWakeUp(): Promise<{ success: boolean; canResume: boolean }> {
        this.isStoppedForToday = false;
        this.activeBreak = null;
        this.globalContinuousSeconds = 0;
        this.lastHeartbeatTimestamp = Date.now();
        await this.persistState();
        return { success: true, canResume: true };
    }

    private isPastCurfew(curfewTimeStr: string): boolean {
        const parts = curfewTimeStr.split(':').map(Number);
        const curfewHour = !isNaN(parts[0]) ? parts[0] : 23;
        const curfewMinute = !isNaN(parts[1]) ? parts[1] : 30;

        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        // Curfew active from curfew time until 05:00 AM next morning
        if (currentHour < 5) return true;
        if (currentHour > curfewHour) return true;
        if (currentHour === curfewHour && currentMinute >= curfewMinute) {
            return true;
        }
        return false;
    }
}
