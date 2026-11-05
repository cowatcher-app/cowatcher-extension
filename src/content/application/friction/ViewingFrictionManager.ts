/**
 * ViewingFrictionManager
 * Content-side controller for viewing static friction, break scheduling, and mindful interventions.
 */

import { IStreamingAdapter } from '../../domain/adapters/IStreamingAdapter';
import { ContentMessageService } from '../services/ContentMessageService';
import { ExtensionSettings } from '@shared/domain/constants/SettingsDefaults';
import {
    ViewingFrictionOverlay,
    ViewingFrictionOverlayCallbacks,
} from '../../presentation/ViewingFrictionOverlay';
import {
    FrictionBreakContext,
    FrictionTriggerReason,
} from '@shared/domain/entities/ViewingFriction';
import { Logger } from '@shared/utils/logger';

export class ViewingFrictionManager {
    private readonly adapter: IStreamingAdapter;
    private readonly messageService: ContentMessageService;
    private readonly isAdPlaying?: () => boolean;
    private readonly getShowTitle?: () => string | undefined;
    private readonly logger = new Logger('ViewingFrictionManager');

    private settings: ExtensionSettings;
    private overlay: ViewingFrictionOverlay;
    private boundVideo: HTMLVideoElement | null = null;

    private continuousSeconds: number = 0;
    private sessionAccumulatedSeconds: number = 0;
    private lastTickTimestamp: number = 0;
    private isPlaying: boolean = false;
    private snoozeUntilTimestamp: number = 0;

    private cachedTodaySeconds: number = 0;
    private cachedTodayRestSeconds: number = 0;
    private cachedTodayBreakCount: number = 0;
    private breakStartTime: number = 0;
    private lastTodayFetchTime: number = 0;

    private lastCurfewTriggerKey: string = '';
    private lastDailyTriggerKey: string = '';
    private lastLoggedSecond: number = -1;

    private checkInterval: ReturnType<typeof setInterval> | null = null;

    constructor(
        adapter: IStreamingAdapter,
        messageService: ContentMessageService,
        initialSettings: ExtensionSettings,
        options?: {
            isAdPlaying?: () => boolean;
            getShowTitle?: () => string | undefined;
        },
    ) {
        this.adapter = adapter;
        this.messageService = messageService;
        this.settings = initialSettings;
        this.isAdPlaying = options?.isAdPlaying;
        this.getShowTitle = options?.getShowTitle;

        this.overlay = new ViewingFrictionOverlay(
            () => this.adapter.getPlayerContainer?.() || null,
        );
        this.overlay.setLanguage(this.settings.uiLanguage || 'en');

        this.onPlay = this.onPlay.bind(this);
        this.onPause = this.onPause.bind(this);
        this.onTimeUpdate = this.onTimeUpdate.bind(this);

        // Fetch remote settings directly and subscribe to live changes
        this.messageService.fetchSettings().then((s) => {
            if (s) {
                this.updateSettings(s);
            }
        });
        this.messageService.onSettingsChanged((s) => {
            if (s) {
                this.updateSettings(s);
            }
        });

        // Fast periodic check (every 1 second) to catch thresholds smoothly
        this.checkInterval = setInterval(() => {
            this.evaluateTriggers();
        }, 1000);

        // Proactively attach if adapter already has a video element
        const candidateVideo = this.adapter.getVideoElement?.();
        if (candidateVideo) {
            this.attachVideo(candidateVideo);
        }
    }

    attachVideo(video: HTMLVideoElement): void {
        if (this.boundVideo === video) return;
        this.detachVideo();

        this.boundVideo = video;
        this.logger.info(
            'ViewingFrictionManager',
            `Attached video element: paused=${video.paused}, ended=${video.ended}, currentTime=${video.currentTime.toFixed(1)}`,
        );

        video.addEventListener('play', this.onPlay);
        video.addEventListener('pause', this.onPause);
        video.addEventListener('ended', this.onPause);
        video.addEventListener('timeupdate', this.onTimeUpdate);

        if (!video.paused && !video.ended) {
            this.onPlay();
        }
    }

    detachVideo(): void {
        if (!this.boundVideo) return;
        this.isPlaying = false;
        this.boundVideo.removeEventListener('play', this.onPlay);
        this.boundVideo.removeEventListener('pause', this.onPause);
        this.boundVideo.removeEventListener('ended', this.onPause);
        this.boundVideo.removeEventListener('timeupdate', this.onTimeUpdate);
        this.boundVideo = null;
    }

    updateSettings(newSettings: Partial<ExtensionSettings>): void {
        this.settings = { ...this.settings, ...newSettings };
        this.logger.info(
            'ViewingFrictionManager',
            `Settings updated: enabled=${Boolean(this.settings.staticFrictionEnabled)}, interval=${this.settings.frictionIntervalMinutes}m, dailyLimit=${this.settings.frictionDailyLimitMinutes}m`,
        );
        this.lastDailyTriggerKey = '';
        this.lastCurfewTriggerKey = '';
        this.snoozeUntilTimestamp = 0;
        if (newSettings.uiLanguage) {
            this.overlay.setLanguage(newSettings.uiLanguage);
        }
        if (!this.settings.staticFrictionEnabled && this.overlay.isVisible()) {
            this.overlay.hide();
        }
    }

    private onPlay(): void {
        this.isPlaying = true;
        this.lastTickTimestamp = Date.now();
        this.refreshTodayStatsAsync();
    }

    private onPause(): void {
        this.isPlaying = false;
    }

    private onTimeUpdate(): void {
        const video = this.boundVideo || this.adapter.getVideoElement?.();
        if (!video || video.paused || video.ended) return;
        if (this.isAdPlaying && this.isAdPlaying()) return;

        const now = Date.now();
        if (this.lastTickTimestamp > 0) {
            const deltaSec = (now - this.lastTickTimestamp) / 1000;
            // Guard against wall-clock leaps or system sleeps
            if (deltaSec > 0 && deltaSec < 3) {
                this.continuousSeconds += deltaSec;
                this.sessionAccumulatedSeconds += deltaSec;
            }
        }
        this.lastTickTimestamp = now;
        this.isPlaying = true;

        // Instant trigger evaluation
        this.evaluateTriggers();
    }

    private async refreshTodayStatsAsync(): Promise<void> {
        const now = Date.now();
        // Throttle background queries to once every 60 seconds
        if (now - this.lastTodayFetchTime < 60000) return;
        this.lastTodayFetchTime = now;

        try {
            const stats = await this.messageService.getTodayWatchTime(
                this.settings.frictionExcludedPlatforms || [],
            );
            this.cachedTodaySeconds = stats.todaySeconds;
            this.cachedTodayRestSeconds = stats.todayRestSeconds || 0;
            this.cachedTodayBreakCount = stats.todayBreakCount || 0;
        } catch {
            // Ignore background comms error
        }
    }

    private evaluateTriggers(): void {
        const video = this.boundVideo || this.adapter.getVideoElement?.();
        if (video && !this.boundVideo) {
            this.attachVideo(video);
        }

        const isCurrentlyPlaying = Boolean(
            video && !video.paused && !video.ended && video.readyState >= 2,
        );

        // Fallback ticker: accumulate watch time even if timeupdate events are delayed
        const now = Date.now();
        if (isCurrentlyPlaying) {
            if (this.lastTickTimestamp > 0) {
                const deltaSec = (now - this.lastTickTimestamp) / 1000;
                if (deltaSec > 0 && deltaSec < 2.5) {
                    this.continuousSeconds += deltaSec;
                    this.sessionAccumulatedSeconds += deltaSec;
                }
            }
            this.lastTickTimestamp = now;
            this.isPlaying = true;
        } else {
            this.lastTickTimestamp = now;
            this.isPlaying = false;
        }

        if (!this.settings.staticFrictionEnabled) {
            return;
        }
        if (!isCurrentlyPlaying) return;
        if (this.overlay.isVisible()) return;
        if (this.isAdPlaying && this.isAdPlaying()) return;

        if (now < this.snoozeUntilTimestamp) return;

        const platform = this.adapter.platformName || 'unknown';
        const platformRules = this.settings.frictionPlatformRules?.[platform];
        if (platformRules?.enabled === false) {
            // Friction explicitly disabled for this platform
            return;
        }

        const effectiveIntervalMin =
            typeof platformRules?.intervalMinutes === 'number' &&
            platformRules.intervalMinutes > 0
                ? platformRules.intervalMinutes
                : Number(this.settings.frictionIntervalMinutes) || 45;

        const effectiveDailyLimitMin =
            typeof platformRules?.dailyLimitMinutes === 'number' &&
            platformRules.dailyLimitMinutes > 0
                ? platformRules.dailyLimitMinutes
                : Number(this.settings.frictionDailyLimitMinutes) || 0;

        // Periodic diagnostic log every 3 seconds so user/developer can inspect state in console
        const secFloor = Math.floor(this.continuousSeconds);
        if (secFloor % 3 === 0 && secFloor !== this.lastLoggedSecond) {
            this.lastLoggedSecond = secFloor;
            this.logger.info(
                'ViewingFrictionManager',
                `Tracking: continuous=${this.continuousSeconds.toFixed(1)}s (target=${(effectiveIntervalMin * 60).toFixed(0)}s), sessionAccum=${this.sessionAccumulatedSeconds.toFixed(1)}s, dailyLimitTarget=${(effectiveDailyLimitMin * 60).toFixed(0)}s`,
            );
        }

        // 1. Check Late-Night Curfew
        if (this.settings.frictionCurfewEnabled) {
            const curfewTimeStr = this.settings.frictionCurfewTime || '23:30';
            if (this.isPastCurfew(curfewTimeStr)) {
                const todayKey = new Date().toDateString();
                if (this.lastCurfewTriggerKey !== todayKey) {
                    this.lastCurfewTriggerKey = todayKey;
                    this.triggerBreak('curfew', curfewTimeStr);
                    return;
                }
            }
        }

        // 2. Check Daily Cumulative Limit (if configured > 0)
        if (effectiveDailyLimitMin > 0) {
            const todayMin =
                (this.cachedTodaySeconds + this.sessionAccumulatedSeconds) / 60;
            if (todayMin >= effectiveDailyLimitMin) {
                const todayKey = new Date().toDateString();
                if (
                    this.lastDailyTriggerKey !== todayKey ||
                    effectiveDailyLimitMin <= 1
                ) {
                    if (effectiveDailyLimitMin > 1) {
                        this.lastDailyTriggerKey = todayKey;
                    }
                    this.triggerBreak(
                        'daily_limit',
                        undefined,
                        effectiveDailyLimitMin,
                    );
                    return;
                }
            }
        }

        // 3. Check Continuous Viewing Interval
        if (
            effectiveIntervalMin > 0 &&
            this.continuousSeconds >= effectiveIntervalMin * 60
        ) {
            this.triggerBreak(
                'interval',
                undefined,
                effectiveDailyLimitMin,
            );
        }
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

    private triggerBreak(
        reason: FrictionTriggerReason,
        curfewTime?: string,
        effectiveDailyLimitMin?: number,
    ): void {
        this.logger.info(
            'ViewingFrictionManager',
            `Triggering static friction break: ${reason}`,
        );

        this.breakStartTime = Date.now();

        // Gracefully pause playback
        try {
            this.boundVideo?.pause();
        } catch {
            // Ignore video pause error
        }

        const continuousMinutes = Math.floor(this.continuousSeconds / 60);
        const todayMinutes = Math.floor(
            (this.cachedTodaySeconds + this.sessionAccumulatedSeconds) / 60,
        );
        const continuousSeconds = Math.round(this.continuousSeconds);
        const todaySeconds = Math.round(
            this.cachedTodaySeconds + this.sessionAccumulatedSeconds,
        );
        const showTitle = this.getShowTitle?.() || undefined;

        const countdownSeconds =
            this.settings.frictionBreakDurationSeconds !== undefined
                ? this.settings.frictionBreakDurationSeconds
                : 20;

        const context: FrictionBreakContext = {
            reason,
            continuousMinutes,
            todayMinutes,
            continuousSeconds,
            todaySeconds,
            todayRestSeconds: this.cachedTodayRestSeconds,
            todayBreakCount: this.cachedTodayBreakCount,
            curfewTime,
            showTitle,
            platform: this.adapter.platformName,
            unlockDifficulty: this.settings.frictionUnlockDifficulty || 'none',
            autoResumeOnTimer:
                reason === 'interval'
                    ? true
                    : this.settings.frictionAutoResumeOnTimer !== false,
            countdownSeconds,
        };

        const callbacks: ViewingFrictionOverlayCallbacks = {
            onContinue: () => {
                this.overlay.hide();

                const elapsedRestSec = this.breakStartTime > 0
                    ? Math.max(1, Math.round((Date.now() - this.breakStartTime) / 1000))
                    : (context.countdownSeconds || 20);
                this.breakStartTime = 0;
                this.cachedTodayRestSeconds += elapsedRestSec;
                this.cachedTodayBreakCount += 1;
                this.messageService.recordRestTime(elapsedRestSec).catch(() => {});

                this.continuousSeconds = 0;
                // Defer triggers by at least 15 min if daily/curfew was dismissed
                // In testing mode (limit <= 1 min), defer by 15 seconds to allow continuous testing
                if (reason === 'daily_limit' || reason === 'curfew') {
                    const deferMs =
                        effectiveDailyLimitMin !== undefined &&
                        effectiveDailyLimitMin <= 1
                            ? 15 * 1000
                            : 15 * 60 * 1000;
                    this.snoozeUntilTimestamp = Date.now() + deferMs;
                }
                this.boundVideo?.play().catch(() => {});
            },
            onDone: () => {
                const elapsedRestSec = this.breakStartTime > 0
                    ? Math.max(1, Math.round((Date.now() - this.breakStartTime) / 1000))
                    : (context.countdownSeconds || 20);
                this.breakStartTime = 0;
                this.cachedTodayRestSeconds += elapsedRestSec;
                this.cachedTodayBreakCount += 1;
                this.messageService.recordRestTime(elapsedRestSec).catch(() => {});

                this.continuousSeconds = 0;
                this.snoozeUntilTimestamp = Date.now() + 60 * 60 * 1000;
                // Keeps video paused
            },
        };

        const screenType = this.settings.frictionScreenType || 'screensaver';
        this.overlay.show(context, screenType, callbacks);

        // Asynchronously request AI companion advice if enabled
        if (this.settings.frictionEnableLlmAdvice) {
            this.messageService
                .getFrictionAdvice({
                    reason,
                    showTitle,
                    watchMinutes: continuousMinutes,
                    todayMinutes,
                    watchSeconds: continuousSeconds,
                    todaySeconds,
                    todayRestSeconds: this.cachedTodayRestSeconds,
                    todayBreakCount: this.cachedTodayBreakCount,
                    platform: this.adapter.platformName,
                    curfewTime,
                })
                .then((advice) => {
                    if (advice && this.overlay.isVisible()) {
                        this.overlay.updateAdvice(advice);
                    }
                })
                .catch(() => {});
        }
    }

    isPlaybackActive(): boolean {
        return this.isPlaying;
    }

    dispose(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.detachVideo();
        this.overlay.hide();
    }
}
