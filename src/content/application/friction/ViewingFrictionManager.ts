/**
 * ViewingFrictionManager
 * Client-side sensor and actuator for Viewing Static Friction (Mindful Viewing).
 *
 * Coordinates with Background ViewingFrictionService:
 * - Emits periodic playback heartbeats.
 * - Enforces mandatory pause when Background reports an active break.
 * - Drives tick countdown synchronized with Background remainingSeconds.
 * - Renders and manages the ViewingFrictionOverlay lifecycle.
 */

import { IStreamingAdapter } from '../../domain/adapters/IStreamingAdapter';
import { ContentMessageService } from '../services/ContentMessageService';
import { ExtensionSettings } from '@shared/domain/constants/SettingsDefaults';
import {
    ActiveFrictionBreak,
    FrictionBreakContext,
} from '@shared/domain/entities/ViewingFriction';
import {
    ViewingFrictionOverlay,
    ViewingFrictionOverlayCallbacks,
} from '../../presentation/ViewingFrictionOverlay';
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

    private isPlaying: boolean = false;
    private isStoppedForToday: boolean = false;
    private checkInterval: ReturnType<typeof setInterval> | null = null;
    private isEvaluating: boolean = false;

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

        // Fast periodic heartbeat check (every 1 second)
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
        if (newSettings.uiLanguage) {
            this.overlay.setLanguage(newSettings.uiLanguage);
        }
        if (!this.settings.staticFrictionEnabled && this.overlay.isVisible()) {
            this.overlay.hide();
        }
    }

    private onPlay(): void {
        if (this.isStoppedForToday) {
            this.boundVideo?.pause();
            return;
        }
        this.isPlaying = true;
        this.evaluateTriggers();
    }

    private onPause(): void {
        this.isPlaying = false;
    }

    private onTimeUpdate(): void {
        // Fast path: if video is paused, no heartbeat
        if (this.boundVideo && (this.boundVideo.paused || this.boundVideo.ended)) {
            return;
        }
        this.isPlaying = true;
    }

    private async evaluateTriggers(): Promise<void> {
        if (this.isEvaluating) return;
        this.isEvaluating = true;

        try {
            const video = this.boundVideo || this.adapter.getVideoElement?.();
            if (video && !this.boundVideo) {
                this.attachVideo(video);
            }

            if (this.isStoppedForToday) {
                if (video && !video.paused) {
                    video.pause();
                }
                return;
            }

            const isCurrentlyPlaying = Boolean(
                video && !video.paused && !video.ended && video.readyState >= 2,
            );

            if (this.isAdPlaying && this.isAdPlaying()) {
                return;
            }

            const platform = this.adapter.platformName || 'unknown';
            const showTitle = this.getShowTitle?.() || undefined;

            const res = await this.messageService.sendFrictionHeartbeat({
                isPlaying: isCurrentlyPlaying,
                platform,
                showTitle,
            });

            if (res.isStoppedForToday) {
                this.isStoppedForToday = true;
                if (video && !video.paused) {
                    video.pause();
                }
                return;
            }

            if (res.shouldPause && res.activeBreak) {
                // Mandatory break active! Force video pause.
                if (video && !video.paused) {
                    video.pause();
                }

                // If overlay is not visible, or showing a different break, show it
                const currentContext = this.overlay.getContext();
                if (
                    !this.overlay.isVisible() ||
                    currentContext?.breakId !== res.activeBreak.id
                ) {
                    this.showBreakOverlay(
                        res.activeBreak,
                        res.continuousSeconds,
                        res.todaySeconds,
                        res.todayRestSeconds,
                        res.todayBreakCount,
                    );
                }
            } else if (
                !res.shouldPause &&
                this.overlay.isVisible() &&
                this.overlay.getContext()?.reason !== 'curfew' &&
                this.overlay.getContext()?.reason !== 'daily_limit'
            ) {
                this.overlay.hide();
            }
        } catch {
            // Comms or video error
        } finally {
            this.isEvaluating = false;
        }
    }

    private showBreakOverlay(
        activeBreak: ActiveFrictionBreak,
        continuousSeconds: number,
        todaySeconds: number,
        todayRestSeconds: number,
        todayBreakCount: number,
    ): void {
        const continuousMinutes = Math.floor(continuousSeconds / 60);
        const todayMinutes = Math.floor(todaySeconds / 60);

        const context: FrictionBreakContext = {
            breakId: activeBreak.id,
            reason: activeBreak.reason,
            continuousMinutes,
            todayMinutes,
            continuousSeconds,
            todaySeconds,
            todayRestSeconds,
            todayBreakCount,
            curfewTime: activeBreak.curfewTime,
            showTitle: activeBreak.showTitle || this.getShowTitle?.(),
            platform: this.adapter.platformName,
            unlockDifficulty: this.settings.frictionUnlockDifficulty || 'none',
            autoResumeOnTimer:
                activeBreak.reason === 'interval'
                    ? this.settings.frictionAutoResumeOnTimer !== false
                    : false,
            countdownSeconds: activeBreak.totalSeconds,
            remainingSeconds: activeBreak.remainingSeconds,
        };

        const callbacks: ViewingFrictionOverlayCallbacks = {
            onTick: async () => {
                return await this.messageService.tickFrictionBreak(activeBreak.id);
            },
            onContinue: async () => {
                const compRes = await this.messageService.completeFrictionBreak(
                    activeBreak.id,
                    true,
                );
                this.overlay.hide();
                if (compRes.canResume) {
                    this.boundVideo?.play().catch(() => {});
                }
            },
            onDone: async () => {
                await this.messageService.dismissHardBlock(activeBreak.id);
                this.isStoppedForToday = true;
                try {
                    this.boundVideo?.pause();
                } catch {}
                if (document.fullscreenElement) {
                    document.exitFullscreen?.().catch(() => {});
                }
            },
        };

        const screenType = this.settings.frictionScreenType || 'screensaver';
        this.overlay.show(context, screenType, callbacks);

        // Fetch AI advice asynchronously if enabled
        if (this.settings.frictionEnableLlmAdvice) {
            this.messageService
                .getFrictionAdvice({
                    reason: activeBreak.reason,
                    showTitle: context.showTitle,
                    watchMinutes: continuousMinutes,
                    todayMinutes,
                    watchSeconds: continuousSeconds,
                    todaySeconds,
                    todayRestSeconds,
                    todayBreakCount,
                    platform: this.adapter.platformName,
                    curfewTime: activeBreak.curfewTime,
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
