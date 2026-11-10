import {
    IAdDetector,
    AdDetectorOptions,
} from '../../../domain/adapters/IAdDetector';

export class BilibiliAdDetector implements IAdDetector {
    readonly onAdStart: () => void;
    readonly onAdEnd: () => void;
    isAdPlaying: boolean = false;

    constructor(options: AdDetectorOptions = {}) {
        this.onAdStart = options.onAdStart || (() => {});
        this.onAdEnd = options.onAdEnd || (() => {});
    }

    startMonitoring(): void {
        // Bilibili does not use programmatic video pre-roll ad blocks that require timeline adjustments
        this.isAdPlaying = false;
    }

    stopMonitoring(): void {
        this.isAdPlaying = false;
    }

    reset(): void {
        this.isAdPlaying = false;
    }
}
