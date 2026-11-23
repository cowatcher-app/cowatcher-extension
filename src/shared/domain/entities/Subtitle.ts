import { TranslationStatus } from './Translation';

export type SubtitlePosition =
    | 'bottom'
    | 'top'
    | 'left-vertical'
    | 'right-vertical'
    | 'left'
    | 'up'
    | 'right';

/**
 * Standard Subtitle Cue interface used across domain, application, and presentation layers.
 * Time units are in seconds (floating point precision).
 */
export interface SubtitleCue {
    id: number;
    startTime: number; // in seconds
    endTime: number; // in seconds
    rawText: string;
    transText: string | null;
    status: TranslationStatus;
    usedTerms?: Record<string, number>; // term/character key -> version
    merged?: number[]; // ordered cue IDs in the same merged translation group
    vocabScanned?: boolean;
    position?: SubtitlePosition;
    updatedAt?: number;
}

/**
 * Raw cue item used during ASR fragment merging.
 */
export interface MergeAsrCueItem {
    id: number;
    startTime: number;
    endTime: number;
    rawText: string;
}

/**
 * Creates a normalized SubtitleCue instance.
 */
export function createSubtitleCue(params: {
    id: number;
    startTime: number;
    endTime: number;
    rawText: string;
    transText?: string;
    status?: TranslationStatus;
    usedTerms?: Record<string, number>;
    merged?: number[];
    vocabScanned?: boolean;
    position?: SubtitlePosition;
    updatedAt?: number;
}): SubtitleCue {
    const startTime = params.startTime;
    const endTime = params.endTime;
    const rawText = params.rawText;
    const transText = params.transText;

    const cue: SubtitleCue = {
        id: params.id,
        startTime,
        endTime,
        rawText,
        transText: transText ?? null,
        status: params.status ?? (transText ? 'raw' : 'untranslated'),
        usedTerms: params.usedTerms,
        merged: params.merged,
        vocabScanned: params.vocabScanned ?? false,
        position: params.position ?? 'bottom',
        updatedAt: params.updatedAt ?? Date.now(),
    };

    return cue;
}

/**
 * SubtitleTrack domain entity encapsulating an entire subtitle sequence and lookup algorithms.
 */
export class SubtitleTrack {
    readonly id: string;
    readonly hash: string;
    readonly language: string;
    readonly cues: SubtitleCue[] = [];
    private readonly _cuesById: Map<number, SubtitleCue> = new Map();

    constructor(
        id: string,
        hash: string,
        cues: SubtitleCue[],
        language: string = '',
    ) {
        this.id = id;
        this.hash = hash;
        this.language = language;
        this.cues = cues;
        for (const cue of cues) {
            this._cuesById.set(cue.id, cue);
        }
    }

    getCueById(id: number): SubtitleCue | undefined {
        return this._cuesById.get(id);
    }

    findCueAt(timeSec: number): SubtitleCue | null {
        return (
            this.cues.find(
                (c) => c.startTime <= timeSec && timeSec < c.endTime,
            ) ?? null
        );
    }

    findCuesAt(timeSec: number): SubtitleCue[] {
        return this.cues.filter(
            (c) => c.startTime <= timeSec && timeSec < c.endTime,
        );
    }

    findCuesInRange(startTimeSec: number, endTimeSec: number): SubtitleCue[] {
        return this.cues.filter(
            (c) => c.startTime < endTimeSec && c.endTime > startTimeSec,
        );
    }

    findCuesWithContext(
        timeSec: number,
        beforeSec: number = 2.0,
        afterSec: number = 2.0,
    ): {
        before: SubtitleCue[];
        current: SubtitleCue[];
        after: SubtitleCue[];
    } {
        const rangeStart = timeSec - beforeSec;
        const rangeEnd = timeSec + afterSec;

        const current = this.findCuesAt(timeSec);
        const currentIds = new Set(current.map((cue) => cue.id));

        return {
            before: this.cues.filter(
                (cue) =>
                    cue.endTime <= timeSec &&
                    cue.endTime > rangeStart &&
                    !currentIds.has(cue.id),
            ),
            current,
            after: this.cues.filter(
                (cue) =>
                    cue.startTime >= timeSec &&
                    cue.startTime < rangeEnd &&
                    !currentIds.has(cue.id),
            ),
        };
    }
}

/**
 * Persistent cache record representing an entire subtitle track in IndexedDB / storage.
 */
export interface TrackCacheRecord {
    cacheKey: string;
    trackHash: string;
    movieId: string;
    showTitle: string;
    targetLanguage: string;
    provider: string;
    translationModel: string;
    supervisorModel: string;
    cues: Record<string | number, SubtitleCue>;
    vocabScannedChunks?: string[];
    translatedCount?: number;
    reviewedCount?: number;
    totalCues?: number;
    createdAt?: number;
    updatedAt?: number;
}
