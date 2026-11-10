import { Logger } from '@shared/utils/logger';
import {
    IAdDetector,
    AdDetectorOptions,
} from '../../../domain/adapters/IAdDetector';
import { NCW_MESSAGE_TYPES } from '@shared/domain/constants/MessageTypes';

export class Channel4AdDetector implements IAdDetector {
    readonly onAdStart: () => void;
    readonly onAdEnd: () => void;
    isAdPlaying: boolean = false;

    private observer: MutationObserver | null = null;
    private checkInterval: NodeJS.Timeout | number | null = null;
    private messageListener: ((e: MessageEvent) => void) | null = null;
    private readonly logger: Logger = new Logger('Channel4AdDetector');

    constructor(options: AdDetectorOptions = {}) {
        this.onAdStart = options.onAdStart || (() => {});
        this.onAdEnd = options.onAdEnd || (() => {});
    }

    startMonitoring(): void {
        this.stopMonitoring();

        // 1. Authoritative ad state messages from Channel4InjectedAdapter
        this.messageListener = (event: MessageEvent) => {
            if (event.source !== window || !event.data) return;
            if (event.data.type === NCW_MESSAGE_TYPES.AD_STATE_CHANGED) {
                this.setAdState(Boolean(event.data.isAd));
            }
        };
        window.addEventListener('message', this.messageListener);

        // 2. DOM Mutation Observer for Channel 4 FreeWheel ad elements and vod-player
        let debounceTimer: NodeJS.Timeout | number | null = null;
        this.observer = new MutationObserver(() => {
            if (debounceTimer) return;
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                this.checkAdStatus();
            }, 250);
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'id', 'src'],
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
        const fwContainer = document.querySelector('#freewheelContainer');
        const fwPlayer = document.querySelector(
            '#freewheelPlayer',
        ) as HTMLVideoElement | null;
        const adPauseControls = document.querySelector('#adPauseControls');
        const vodPlayer = document.querySelector(
            'video.vod-player',
        ) as HTMLVideoElement | null;

        const isContainerActive = Boolean(
            fwContainer &&
            fwContainer.classList.contains('show') &&
            !fwContainer.classList.contains('hide'),
        );

        const isFwPlayerActive = Boolean(
            fwPlayer &&
            (fwPlayer.classList.contains('show') ||
                (fwPlayer.src && fwPlayer.src.length > 0 && !fwPlayer.paused)),
        );

        const isAdPauseControlsActive = Boolean(
            adPauseControls &&
            adPauseControls.classList.contains('show') &&
            !adPauseControls.classList.contains('hide'),
        );

        const isVodHidden = Boolean(
            vodPlayer &&
            (vodPlayer.classList.contains('hidden') ||
                vodPlayer.style.display === 'none' ||
                vodPlayer.style.visibility === 'hidden'),
        );

        const adDetected =
            isContainerActive ||
            isFwPlayerActive ||
            isAdPauseControlsActive ||
            (isVodHidden && Boolean(fwPlayer?.src));

        this.setAdState(adDetected);
    }

    private setAdState(isAd: boolean): void {
        if (this.isAdPlaying === isAd) return;

        this.isAdPlaying = isAd;
        this.logger.info(
            'Channel4AdDetector',
            `Ad state changed: ${isAd ? 'AD_START' : 'AD_END'}`,
        );

        if (isAd) {
            this.onAdStart();
        } else {
            this.onAdEnd();
        }
    }
}
