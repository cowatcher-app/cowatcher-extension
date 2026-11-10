import { Logger } from '@shared/utils/logger';
import {
    IAdDetector,
    AdDetectorOptions,
} from '../../../domain/adapters/IAdDetector';
import { NCW_MESSAGE_TYPES } from '@shared/domain/constants/MessageTypes';

export class ItvxAdDetector implements IAdDetector {
    readonly onAdStart: () => void;
    readonly onAdEnd: () => void;
    isAdPlaying: boolean = false;

    private observer: MutationObserver | null = null;
    private checkInterval: NodeJS.Timeout | number | null = null;
    private messageListener: ((e: MessageEvent) => void) | null = null;
    private readonly logger: Logger = new Logger('ItvxAdDetector');

    constructor(options: AdDetectorOptions = {}) {
        this.onAdStart = options.onAdStart || (() => {});
        this.onAdEnd = options.onAdEnd || (() => {});
    }

    startMonitoring(): void {
        this.stopMonitoring();

        // 1. Authoritative ad state messages from ItvxInjectedAdapter
        this.messageListener = (event: MessageEvent) => {
            if (event.source !== window || !event.data) return;
            if (event.data.type === NCW_MESSAGE_TYPES.AD_STATE_CHANGED) {
                this.setAdState(Boolean(event.data.isAd));
            }
        };
        window.addEventListener('message', this.messageListener);

        // 2. DOM Mutation Observer for ITVX advert player elements and subtitle container
        let debounceTimer: NodeJS.Timeout | number | null = null;
        this.observer = new MutationObserver(() => {
            if (debounceTimer) return;
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                this.checkAdStatus();
            }, 300);
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'id', 'src', 'data-testid'],
        });

        // 3. Periodic polling fallback
        this.checkInterval = setInterval(() => {
            this.checkAdStatus();
        }, 1000);

        this.checkAdStatus();
    }

    stopMonitoring(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        if (this.messageListener) {
            window.removeEventListener('message', this.messageListener);
            this.messageListener = null;
        }
        this.isAdPlaying = false;
    }

    reset(): void {
        this.isAdPlaying = false;
    }

    private checkAdStatus(): void {
        // Method 1: Check advert player elements (advertPlayerA, advertPlayerB)
        const adPlayerA = document.querySelector(
            '#advertPlayerA',
        ) as HTMLVideoElement | null;
        const adPlayerB = document.querySelector(
            '#advertPlayerB',
        ) as HTMLVideoElement | null;

        const isPlayerAActive = Boolean(
            adPlayerA &&
            adPlayerA.style.display !== 'none' &&
            adPlayerA.src &&
            adPlayerA.src.length > 0 &&
            !adPlayerA.paused &&
            adPlayerA.currentTime >= 0,
        );

        const isPlayerBActive = Boolean(
            adPlayerB &&
            adPlayerB.style.display !== 'none' &&
            adPlayerB.src &&
            adPlayerB.src.length > 0 &&
            !adPlayerB.paused &&
            adPlayerB.currentTime >= 0,
        );

        // Method 2: Check ad subtitle overlay container vs content subtitles
        const adSubtitles = document.querySelector(
            '[data-testid="ad-subtitles"]',
        );
        const contentSubtitles = document.querySelector(
            '[data-testid="content-subtitles"]',
        );
        const isAdSubtitleActive = Boolean(adSubtitles && !contentSubtitles);

        // Method 3: Check content video element visibility
        const contentVideo = document.querySelector(
            '.fe-mrphs__videoParent video:not(#advertPlayerA):not(#advertPlayerB)',
        ) as HTMLVideoElement | null;
        const isContentHidden = Boolean(
            contentVideo &&
            (contentVideo.style.display === 'none' ||
                contentVideo.style.visibility === 'hidden'),
        );

        const adDetected =
            isPlayerAActive ||
            isPlayerBActive ||
            (isAdSubtitleActive && isContentHidden);

        this.setAdState(adDetected);
    }

    private setAdState(isAd: boolean): void {
        if (this.isAdPlaying === isAd) return;

        this.isAdPlaying = isAd;
        this.logger.info(
            'ItvxAdDetector',
            `Ad state changed: ${isAd ? 'AD_START' : 'AD_END'}`,
        );

        if (isAd) {
            this.onAdStart();
        } else {
            this.onAdEnd();
        }
    }
}
