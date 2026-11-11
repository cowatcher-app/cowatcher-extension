import { SubtitleCue } from '@shared/domain/entities/Subtitle';
import { SubtitleOverlay } from '../../presentation/SubtitleOverlay';
import { Logger } from '@shared/utils/logger';
import { ExtensionSettings } from '@shared/utils/constants';
import { TranslationItem } from '../store/SubtitleStore';
import { PlaybackDatasetHelper } from '@shared/domain/entities/PlaybackDatasetPayload';

export interface SubtitlePlaybackDelegate {
    isContextValid(): boolean;
    isAdPlaying(): boolean;
    getCues(): SubtitleCue[];
    getRawAsrCues(): SubtitleCue[];
    isAsrTrack(): boolean;
    getTranslation(cueId: number): TranslationItem | undefined;
    checkCueStaleness(cueId: number): void;
    onPipelineTick(effectiveTime: number): void;
    onSeeked(effectiveTime: number): void;
    getCurrentMovieId?(): string | null;
    isLive?(): boolean;
    onVideoAttached?(video: HTMLVideoElement): void;
    onVideoDetached?(): void;
}

interface DatasetTiming {
    readonly baseTime: number;
    readonly syncAt: number;
    readonly isPaused: boolean;
    readonly rate: number;
}

export class SubtitlePlaybackSyncer {
    private readonly logger = new Logger('SubtitlePlaybackSyncer');

    video: HTMLVideoElement | null = null;
    rafId: number | null = null;
    lastContentTime: number | null = null;
    emptyCueSince: number | null = null;

    cadmiumOffset = 0;
    domOffset = 0;
    manualOffset = 0;
    lastNativeCalibAt = 0;
    hasLoggedEndOfCues = false;
    isLiveMode = false;

    activeCueId: number | null = null;
    lastCueSig = '';

    setIsLive(live: boolean): void {
        this.isLiveMode = live;
        if (live) {
            this.hasLoggedEndOfCues = false;
        }
    }

    constructor(
        private readonly overlay: SubtitleOverlay,
        private readonly delegate: SubtitlePlaybackDelegate,
        private readonly getSettings: () => Partial<ExtensionSettings>,
    ) {
        this.onTick = this.onTick.bind(this);
        this.onSeeking = this.onSeeking.bind(this);
        this.onSeeked = this.onSeeked.bind(this);
    }

    attachVideo(videoEl: HTMLVideoElement): void {
        if (this.video === videoEl) return;
        this.detachVideo();
        this.video = videoEl;

        this.delegate.onVideoAttached?.(videoEl);

        this.video.addEventListener('timeupdate', this.onTick);
        this.video.addEventListener('seeking', this.onSeeking);
        this.video.addEventListener('seeked', this.onSeeked);
        this.video.addEventListener('play', this.startRafLoop.bind(this));
        this.video.addEventListener('pause', this.stopRafLoop.bind(this));

        this.logger.info(
            'SubtitlePlaybackSyncer',
            'Attached to video element.',
        );
        if (!this.video.paused) {
            this.startRafLoop();
        }
    }

    detachVideo(): void {
        this.delegate.onVideoDetached?.();
        if (this.video) {
            this.video.removeEventListener('timeupdate', this.onTick);
            this.video.removeEventListener('seeking', this.onSeeking);
            this.video.removeEventListener('seeked', this.onSeeked);
            this.stopRafLoop();
            this.video = null;
        }
    }

    bindVideoEvents(): void {
        if (typeof document === 'undefined') return;
        const video = document.querySelector('video');
        if (video) {
            this.attachVideo(video);
        }
    }

    startRafLoop(): void {
        this.stopRafLoop();
        const loop = () => {
            this.onTick();
            if (this.video && !this.video.paused) {
                this.rafId = requestAnimationFrame(loop);
            }
        };
        this.rafId = requestAnimationFrame(loop);
    }

    stopRafLoop(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    private readDatasetSyncFromDOM(): DatasetTiming | null {
        if (typeof document === 'undefined' || !document.documentElement)
            return null;
        const currentMid = this.delegate.getCurrentMovieId?.();
        const payload = PlaybackDatasetHelper.read(
            currentMid,
            document.documentElement,
        );
        if (!payload) return null;

        if (
            typeof payload.offset === 'number' &&
            !isNaN(payload.offset) &&
            Math.abs(payload.offset) <= 180
        ) {
            this.cadmiumOffset = payload.offset;
        }

        const baseTime = payload.currentTime;
        if (isNaN(baseTime) || !isFinite(baseTime)) return null;

        const syncAt = payload.syncAt;
        const fallbackPaused = Boolean(this.video && this.video.paused);
        const isPaused = payload.isPaused || fallbackPaused;
        const rate =
            payload.playbackRate || this.video?.playbackRate || 1.0;

        return { baseTime, syncAt, isPaused, rate };
    }

    private readAtomicSyncFromDOM(): DatasetTiming | null {
        if (typeof document === 'undefined' || !document.documentElement)
            return null;
        const atomicStr = document.documentElement.dataset?.ncwSegmentAtomic;
        if (!atomicStr) return null;

        const parts = atomicStr.split('|');
        if (parts.length < 4) return null;

        const baseTime = parseFloat(parts[0]);
        if (isNaN(baseTime)) return null;

        const syncAt = parseFloat(parts[1]);
        const fallbackPaused = Boolean(this.video && this.video.paused);
        const isPaused = parts[2] === '1' || fallbackPaused;
        const rate = parseFloat(parts[3]) || this.video?.playbackRate || 1.0;

        return { baseTime, syncAt, isPaused, rate };
    }

    private readLegacySyncFromDOM(): DatasetTiming | null {
        if (typeof document === 'undefined' || !document.documentElement)
            return null;
        const segStr = document.documentElement.dataset?.ncwSegmentTime;
        if (segStr === undefined || segStr === '') return null;

        const baseTime = parseFloat(segStr);
        if (isNaN(baseTime)) return null;

        const syncStr = document.documentElement.dataset?.ncwSegmentSyncAt;
        const syncAt = parseFloat(syncStr || '0');
        const isPausedStr = document.documentElement.dataset?.ncwIsPaused;
        const fallbackPaused = Boolean(this.video && this.video.paused);
        const isPaused = isPausedStr === 'true' || fallbackPaused;
        const rateStr = document.documentElement.dataset?.ncwPlaybackRate;
        const rate =
            parseFloat(rateStr || '1') || this.video?.playbackRate || 1.0;

        return { baseTime, syncAt, isPaused, rate };
    }

    private extrapolatePlaybackTime(
        baseTime: number,
        syncAt: number,
        rate: number,
    ): number {
        if (isNaN(syncAt) || !isFinite(syncAt)) return baseTime;
        const now =
            typeof performance !== 'undefined' && performance.now
                ? performance.now()
                : Date.now();
        const elapsedMs = Math.max(0, now - syncAt);
        if (elapsedMs < 5000) {
            return baseTime + (elapsedMs / 1000) * rate;
        }
        return baseTime;
    }

    getContentTime(): number {
        if (!this.video) return 0;
        const timing =
            this.readDatasetSyncFromDOM() ||
            this.readAtomicSyncFromDOM() ||
            this.readLegacySyncFromDOM();

        if (timing && timing.baseTime >= 0) {
            if (timing.isPaused) {
                this.lastContentTime = timing.baseTime;
                return timing.baseTime;
            }
            let calculatedTime = this.extrapolatePlaybackTime(
                timing.baseTime,
                timing.syncAt,
                timing.rate,
            );
            if (
                !this.video.seeking &&
                typeof this.lastContentTime === 'number' &&
                this.lastContentTime > 0
            ) {
                const delta = calculatedTime - this.lastContentTime;
                if (delta < 0 && delta > -0.25) {
                    calculatedTime = this.lastContentTime;
                }
            }
            this.lastContentTime = calculatedTime;
            return calculatedTime;
        }

        const rawTime =
            typeof this.video.currentTime === 'number'
                ? this.video.currentTime
                : 0;
        this.lastContentTime = rawTime;
        return rawTime;
    }

    getTotalOffset(): number {
        this.syncCadmiumOffsetFromDOM();
        const validCadmium =
            Math.abs(this.cadmiumOffset) <= 180 ? this.cadmiumOffset : 0;
        const settings = this.getSettings();
        const domOffset =
            settings.enableDomSubtitleSync && typeof this.domOffset === 'number'
                ? this.domOffset
                : 0;
        const manualOffset =
            typeof settings.subSyncOffset === 'number'
                ? settings.subSyncOffset
                : this.manualOffset || 0;
        this.manualOffset = manualOffset;
        return validCadmium + domOffset + manualOffset;
    }

    getEffectiveTime(): number {
        if (!this.video) return 0;
        const contentTime = this.getContentTime();
        return Math.max(0, contentTime + this.getTotalOffset());
    }

    private syncCadmiumOffsetFromDOM(): void {
        if (typeof document === 'undefined' || !document.documentElement)
            return;
        const rawCadmium = document.documentElement.dataset?.ncwCadmiumOffset;
        const datasetCadmium = rawCadmium ? parseFloat(rawCadmium) : NaN;
        if (!isNaN(datasetCadmium) && Math.abs(datasetCadmium) <= 180) {
            this.cadmiumOffset = datasetCadmium;
        }
    }

    setCadmiumOffset(offset: number): void {
        if (typeof offset === 'number' && !isNaN(offset)) {
            this.cadmiumOffset = offset;
        }
    }

    setAdOffset(offset: number): void {
        if (typeof offset === 'number' && !isNaN(offset)) {
            this.cadmiumOffset = -offset;
        }
    }

    invalidateCueSig(): void {
        this.lastCueSig = '';
    }

    reset(): void {
        this.activeCueId = null;
        this.lastCueSig = '';
        this.lastContentTime = null;
        this.emptyCueSince = null;
        this.cadmiumOffset = 0;
        this.domOffset = 0;
        this.lastNativeCalibAt = 0;
        this.hasLoggedEndOfCues = false;
        this.isLiveMode = false;
        this.overlay.hide(true);
    }

    private findMatchingCueForNative(
        cleanNative: string,
        objectiveTime: number,
    ): SubtitleCue | null {
        const cues = this.delegate.getCues();
        const norm = (s: string) =>
            s.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
        const candidates = cues.filter((c) => {
            const cleanCue = norm(c.rawText);
            return (
                cleanCue.length >= 3 &&
                (cleanCue === cleanNative ||
                    cleanCue.includes(cleanNative) ||
                    cleanNative.includes(cleanCue))
            );
        });
        if (candidates.length === 0) return null;

        return candidates.reduce((prev, curr) => {
            return Math.abs(curr.startTime - objectiveTime) <
                Math.abs(prev.startTime - objectiveTime)
                ? curr
                : prev;
        });
    }

    calibrateOffsetFromNativeSubtitles(): void {
        const settings = this.getSettings();
        if (!settings.enableDomSubtitleSync || typeof document === 'undefined')
            return;
        const cues = this.delegate.getCues();
        if (!this.video || cues.length === 0) return;

        const timedTextContainer = document.querySelector('.player-timedtext');
        const nativeText = timedTextContainer?.textContent?.trim();
        if (!nativeText || nativeText.length < 3) return;

        const norm = (s: string) =>
            s.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
        const cleanNative = norm(nativeText);
        if (cleanNative.length < 3) return;

        const apiTime = this.getContentTime() + (this.cadmiumOffset || 0);
        const match = this.findMatchingCueForNative(
            cleanNative,
            apiTime + (this.domOffset || 0),
        );
        if (!match) return;

        const cueMid = (match.startTime + match.endTime) / 2;
        const neededDomOffset = Math.round((cueMid - apiTime) * 10) / 10;
        if (
            neededDomOffset >= -120 &&
            neededDomOffset <= 300 &&
            Math.abs(this.domOffset - neededDomOffset) > 1.0
        ) {
            this.logger.info(
                'SubtitlePlaybackSyncer',
                `Auto-calibrated DOM offset: ${this.domOffset.toFixed(2)}s -> ${neededDomOffset.toFixed(2)}s`,
            );
            this.domOffset = neededDomOffset;
        }
    }

    onSeeking(): void {
        if (!this.delegate.isContextValid()) {
            this.detachVideo();
            return;
        }
        this.lastContentTime = null;
        this.emptyCueSince = null;
        this.overlay.hide(true);
        this.activeCueId = null;
        this.lastCueSig = '';
    }

    onSeeked(): void {
        if (!this.delegate.isContextValid()) {
            this.detachVideo();
            return;
        }
        this.lastContentTime = null;
        this.emptyCueSince = null;
        if (!this.video || this.delegate.isAdPlaying()) return;

        const effectiveTime = this.getEffectiveTime();
        this.logger.info(
            'SubtitlePlaybackSyncer',
            `Timeline jump detected at ${effectiveTime.toFixed(2)}s (contentTime: ${this.getContentTime().toFixed(2)}s)`,
        );
        this.onTick();
        this.delegate.onSeeked(effectiveTime);
    }

    private binarySearchNearestCueIndex(
        cues: SubtitleCue[],
        time: number,
    ): number {
        let low = 0;
        let high = cues.length - 1;
        let startIdx = 0;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (cues[mid].startTime <= time) {
                startIdx = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return startIdx;
    }

    findActiveCues(time: number): SubtitleCue[] {
        const cues = this.delegate.getCues();
        if (cues.length === 0) {
            return this.delegate.isAsrTrack()
                ? this.delegate
                      .getRawAsrCues()
                      .filter((c) => time >= c.startTime && time <= c.endTime)
                : [];
        }

        const startIdx = this.binarySearchNearestCueIndex(cues, time);
        const active: SubtitleCue[] = [];
        for (let i = startIdx; i >= 0 && time - cues[i].startTime <= 30; i--) {
            if (time >= cues[i].startTime && time <= cues[i].endTime) {
                active.unshift(cues[i]);
            }
        }
        for (
            let i = startIdx + 1;
            i < cues.length && cues[i].startTime <= time;
            i++
        ) {
            if (time >= cues[i].startTime && time <= cues[i].endTime) {
                active.push(cues[i]);
            }
        }

        if (active.length === 0 && this.delegate.isAsrTrack()) {
            return this.resolveAsrFallbackActive(cues, startIdx, time);
        }
        return active;
    }

    private resolveAsrFallbackActive(
        cues: SubtitleCue[],
        startIdx: number,
        time: number,
    ): SubtitleCue[] {
        if (startIdx >= 0 && startIdx < cues.length) {
            const prevCue = cues[startIdx];
            const nextCue =
                startIdx + 1 < cues.length ? cues[startIdx + 1] : null;
            if (
                time >= prevCue.endTime &&
                time <= prevCue.endTime + 3.0 &&
                (!nextCue || time < nextCue.startTime)
            ) {
                return [prevCue];
            }
        }
        const rawAsr = this.delegate.getRawAsrCues();
        return rawAsr.filter((c) => time >= c.startTime && time <= c.endTime);
    }

    findActiveCue(time: number): SubtitleCue | null {
        const active = this.findActiveCues(time);
        return active.length > 0 ? active[0] : null;
    }

    findCueIndexAtTime(time: number): number {
        const cues = this.delegate.getCues();
        for (let i = 0; i < cues.length; i++) {
            if (cues[i].endTime >= time) return i;
        }
        return Math.max(0, cues.length - 1);
    }

    getCurrentCueIndex(): number {
        const cues = this.delegate.getCues();
        if (!cues || cues.length === 0) return -1;
        const time = this.getEffectiveTime();

        // 1. Is playback within any active cue?
        for (let i = 0; i < cues.length; i++) {
            if (time >= cues[i].startTime && time <= cues[i].endTime) {
                return i;
            }
        }

        // 2. Is playback in gap between cues?
        for (let i = 0; i < cues.length; i++) {
            if (cues[i].startTime > time) {
                // If previous cue ended recently (<= 2.0s), prioritize it
                if (i > 0 && time - cues[i - 1].endTime <= 2.0) {
                    return i - 1;
                }
                return i;
            }
        }

        // 3. Past the last cue: if ended within 2.5s, prioritize last cue
        const lastIdx = cues.length - 1;
        if (time - cues[lastIdx].endTime <= 2.5) {
            return lastIdx;
        }

        return lastIdx;
    }

    seekToCue(index: number, autoPlay = false): boolean {
        const cues = this.delegate.getCues();
        if (!cues || index < 0 || index >= cues.length) return false;

        let video = this.video;
        if (
            !video ||
            (typeof document !== 'undefined' &&
                document.body &&
                !document.body.contains(video))
        ) {
            const candidate =
                typeof document !== 'undefined'
                    ? document.querySelector('video')
                    : null;
            if (candidate) {
                this.attachVideo(candidate);
                video = candidate;
            }
        }
        if (!video) return false;

        const targetCue = cues[index];
        const preRoll = 0.12; // 120ms audio pre-roll
        const totalOffset = this.getTotalOffset();
        const targetVideoTime = Math.max(
            0,
            targetCue.startTime - preRoll - totalOffset,
        );

        const wasPaused = video.paused;
        video.currentTime = targetVideoTime;
        if (autoPlay || !wasPaused) {
            video.play().catch(() => {});
        }
        return true;
    }

    repeatCurrentCue(): boolean {
        const idx = this.getCurrentCueIndex();
        if (idx === -1) return false;
        return this.seekToCue(idx, true);
    }

    seekPreviousCue(): boolean {
        const cues = this.delegate.getCues();
        if (!cues || cues.length === 0) return false;

        const currentIdx = this.getCurrentCueIndex();
        if (currentIdx === -1) return false;

        const prevIdx = Math.max(0, currentIdx - 1);
        return this.seekToCue(prevIdx, false);
    }

    seekNextCue(): boolean {
        const cues = this.delegate.getCues();
        if (!cues || cues.length === 0) return false;

        const currentIdx = this.getCurrentCueIndex();
        if (currentIdx === -1) return false;

        const nextIdx = Math.min(cues.length - 1, currentIdx + 1);
        return this.seekToCue(nextIdx, false);
    }

    onTick(): void {
        if (!this.delegate.isContextValid()) {
            this.detachVideo();
            return;
        }
        const cues = this.delegate.getCues();
        if (!this.video || cues.length === 0) return;

        if (
            this.getSettings().enabled === false ||
            this.delegate.isAdPlaying()
        ) {
            this.hideOverlayIfVisible();
            return;
        }

        const effectiveTime = this.getEffectiveTime();
        this.throttleNativeCalibration();
        const activeCues = this.findActiveCues(effectiveTime);

        if (activeCues.length > 0) {
            this.renderActiveCues(activeCues, effectiveTime);
        } else {
            this.handleEmptyCues(effectiveTime);
        }

        this.checkEndOfDialogue(cues, effectiveTime);
        this.delegate.onPipelineTick(effectiveTime);
    }

    private hideOverlayIfVisible(): void {
        this.emptyCueSince = null;
        if (
            this.overlay.isVisible ||
            this.activeCueId !== null ||
            this.lastCueSig !== ''
        ) {
            this.overlay.hide(true);
            this.activeCueId = null;
            this.lastCueSig = '';
        }
    }

    private throttleNativeCalibration(): void {
        const now = Date.now();
        if (!this.lastNativeCalibAt || now - this.lastNativeCalibAt > 1500) {
            this.lastNativeCalibAt = now;
            this.calibrateOffsetFromNativeSubtitles();
        }
    }

    private renderActiveCues(
        activeCues: SubtitleCue[],
        effectiveTime: number,
    ): void {
        this.emptyCueSince = null;
        for (const c of activeCues) {
            this.delegate.checkCueStaleness(c.id);
        }

        const cueSig = activeCues
            .map(
                (c) =>
                    `${c.id}:${this.delegate.getTranslation(c.id)?.text || ''}`,
            )
            .join('|');

        if (this.lastCueSig === cueSig) return;
        this.lastCueSig = cueSig;
        this.activeCueId = activeCues[0].id;

        const cueItems = activeCues.map((c) => ({
            id: c.id,
            originalText: c.rawText,
            translatedText: this.delegate.getTranslation(c.id)?.text || null,
            position: c.position || 'bottom',
        }));

        this.overlay.showCues(cueItems);
        this.logger.info(
            'SubtitlePlaybackSyncer',
            `Cue #${activeCues[0].id} [${activeCues[0].startTime.toFixed(2)}s] (time: ${effectiveTime.toFixed(2)}s)`,
        );
    }

    private handleEmptyCues(effectiveTime: number): void {
        const nowMs =
            typeof performance !== 'undefined' && performance.now
                ? performance.now()
                : Date.now();
        if (!this.emptyCueSince) this.emptyCueSince = nowMs;

        const isPaused = this.video?.paused || false;
        const emptyElapsed = nowMs - this.emptyCueSince;
        const hideGraceMs = isPaused
            ? 0
            : this.delegate.isAsrTrack()
              ? 600
              : 80;

        if (
            emptyElapsed >= hideGraceMs &&
            (this.activeCueId !== null || this.lastCueSig !== '')
        ) {
            if (this.delegate.isAsrTrack() && !isPaused) {
                this.logger.info(
                    'SubtitlePlaybackSyncer',
                    `Overlay hidden at ${effectiveTime.toFixed(2)}s (silence: ${Math.round(emptyElapsed)}ms >= ${hideGraceMs}ms).`,
                );
            }
            this.activeCueId = null;
            this.lastCueSig = '';
            this.overlay.hide();
        }
    }

    private checkEndOfDialogue(
        cues: SubtitleCue[],
        effectiveTime: number,
    ): void {
        if (this.isLiveMode || this.delegate.isLive?.()) {
            this.hasLoggedEndOfCues = false;
            return;
        }
        const lastCue = cues[cues.length - 1];
        if (lastCue && effectiveTime > lastCue.endTime) {
            if (!this.hasLoggedEndOfCues) {
                this.hasLoggedEndOfCues = true;
                this.logger.info(
                    'SubtitlePlaybackSyncer',
                    `Reached end of subtitle dialogue at ${effectiveTime.toFixed(1)}s (total: ${cues.length}).`,
                );
            }
        } else {
            this.hasLoggedEndOfCues = false;
        }
    }
}
