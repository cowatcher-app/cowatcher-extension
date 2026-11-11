import {
    TVerTrackDetail,
    TVerUnknownTrackDetail,
    TVerStreaksPlayer,
    TVerTextTrackLike,
} from './TVerTypes';
import { Language } from '@shared/domain/value-objects/Language';
import { Logger } from '@shared/utils/logger';

export class TVerTrackRegistry {
    private readonly logger = new Logger('TVerTrackRegistry');

    // Two-level table: episodeId -> lang (lowercase) -> TVerTrackDetail
    private readonly knownTracks = new Map<string, Map<string, TVerTrackDetail>>();

    // Unknown intercepted tracks: url -> TVerUnknownTrackDetail
    private readonly unknownTracks = new Map<string, TVerUnknownTrackDetail>();

    // Fast reverse index: url -> TVerTrackDetail
    private readonly urlToKnownTrackIndex = new Map<string, TVerTrackDetail>();

    static isSubtitleContent(text: string): boolean {
        if (!text || typeof text !== 'string') return false;
        const clean = text.replace(/^\uFEFF/, '').trim();
        const snippet = clean.slice(0, 2000);

        if (
            snippet.startsWith('WEBVTT') ||
            snippet.includes('WEBVTT') ||
            snippet.includes('-->')
        ) {
            return true;
        }
        if (
            snippet.includes('<tt') ||
            snippet.includes('<timedtext') ||
            snippet.includes('begin="')
        ) {
            return true;
        }
        return false;
    }

    static formatVttTime(seconds: number): string {
        if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0)
            seconds = 0;
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        const pad = (n: number | string, z = 2) => String(n).padStart(z, '0');
        return `${pad(h)}:${pad(m)}:${pad(s.toFixed(3), 6)}`;
    }

    static textTrackToWebVTT(track: TVerTextTrackLike | null | undefined): string | null {
        const cues = track?.cues_ || track?.cues;
        if (!cues || cues.length === 0) return null;

        interface TVerCueLike {
            startTime?: number;
            endTime?: number;
            text?: string;
            rawText?: string;
            getCueAsHTML?: () => HTMLElement | null;
        }

        let out = 'WEBVTT\n\n';
        for (let i = 0; i < cues.length; i++) {
            const cue = cues[i] as unknown as TVerCueLike;
            if (
                typeof cue.startTime !== 'number' ||
                typeof cue.endTime !== 'number'
            )
                continue;
            const start = this.formatVttTime(cue.startTime);
            const end = this.formatVttTime(cue.endTime);
            const text =
                cue.text ||
                cue.rawText ||
                cue.getCueAsHTML?.()?.textContent ||
                '';
            if (!text.trim()) continue;
            out += `${i + 1}\n${start} --> ${end}\n${text.trim()}\n\n`;
        }
        return out.length > 20 ? out : null;
    }

    static parseVttTime(str: string): number {
        str = str.replace(',', '.').trim();
        const parts = str.split(':');
        let h = 0, m = 0, s = 0;
        if (parts.length === 3) {
            h = parseFloat(parts[0]);
            m = parseFloat(parts[1]);
            s = parseFloat(parts[2]);
        } else if (parts.length === 2) {
            m = parseFloat(parts[0]);
            s = parseFloat(parts[1]);
        }
        return h * 3600 + m * 60 + s;
    }

    static parseVttToCues(vtt: string): Array<{ start: number; end: number; text: string }> {
        const cues: Array<{ start: number; end: number; text: string }> = [];
        if (!vtt) return cues;

        const lines = vtt.split(/\r?\n/);
        const timeRegex = /((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[.,]\d{3})/;

        let i = 0;
        while (i < lines.length) {
            const line = lines[i].trim();
            const match = line.match(timeRegex);
            if (match) {
                const start = TVerTrackRegistry.parseVttTime(match[1]);
                const end = TVerTrackRegistry.parseVttTime(match[2]);
                i++;
                const textLines: string[] = [];
                while (i < lines.length && lines[i].trim() !== '') {
                    textLines.push(lines[i].trim());
                    i++;
                }
                const text = textLines.join('\n').trim();
                if (text && end > start) {
                    cues.push({ start, end, text });
                }
            } else {
                i++;
            }
        }
        return cues;
    }

    static mergeWebVTT(
        existingVtt: string,
        newVtt: string,
    ): { mergedVtt: string; hasNewCues: boolean } {
        if (!existingVtt || existingVtt.length < 10) {
            return { mergedVtt: newVtt, hasNewCues: true };
        }
        if (!newVtt || newVtt.length < 10) {
            return { mergedVtt: existingVtt, hasNewCues: false };
        }

        const existingCues = TVerTrackRegistry.parseVttToCues(existingVtt);
        const incomingCues = TVerTrackRegistry.parseVttToCues(newVtt);

        const existingKeys = new Set(
            existingCues.map((c) => `${c.start.toFixed(3)}_${c.text}`),
        );

        let hasNewCues = false;
        for (const cue of incomingCues) {
            const key = `${cue.start.toFixed(3)}_${cue.text}`;
            if (!existingKeys.has(key)) {
                existingKeys.add(key);
                existingCues.push(cue);
                hasNewCues = true;
            }
        }

        if (!hasNewCues) {
            return { mergedVtt: existingVtt, hasNewCues: false };
        }

        existingCues.sort((a, b) => a.start - b.start);

        let out = 'WEBVTT\n\n';
        for (let i = 0; i < existingCues.length; i++) {
            const cue = existingCues[i];
            const start = TVerTrackRegistry.formatVttTime(cue.start);
            const end = TVerTrackRegistry.formatVttTime(cue.end);
            out += `${i + 1}\n${start} --> ${end}\n${cue.text}\n\n`;
        }

        return { mergedVtt: out, hasNewCues: true };
    }

    mergeOrRegisterTrack(
        episodeId: string,
        lang: string,
        data: Omit<TVerTrackDetail, 'episodeId' | 'lang'>,
    ): { detail: TVerTrackDetail; hasNewCues: boolean } {
        const normalizedLang = (lang || 'ja').toLowerCase();
        const existing = this.getCachedTrack(episodeId, normalizedLang);
        if (existing && existing.rawText) {
            const { mergedVtt, hasNewCues } = TVerTrackRegistry.mergeWebVTT(
                existing.rawText,
                data.rawText,
            );
            const updated: TVerTrackDetail = {
                ...existing,
                rawText: mergedVtt,
                interceptedAt: Date.now(),
            };
            let langMap = this.knownTracks.get(episodeId);
            if (!langMap) {
                langMap = new Map();
                this.knownTracks.set(episodeId, langMap);
            }
            langMap.set(normalizedLang, updated);
            if (updated.url) {
                this.urlToKnownTrackIndex.set(updated.url, updated);
            }
            if (hasNewCues) {
                this.logger.info(
                    'TVer-AI-Sub',
                    `Accumulated new cues for ep ${episodeId} (${normalizedLang}): total len=${mergedVtt.length}`,
                );
            }
            return { detail: updated, hasNewCues };
        }

        const detail = this.registerKnownTrack(episodeId, normalizedLang, data);
        return { detail, hasNewCues: true };
    }

    addInterceptedTrack(
        url: string,
        rawText: string,
        activeEpisodeId?: string | null,
        lang = 'ja',
    ): TVerTrackDetail | null {
        if (!rawText || rawText.length < 20) return null;

        const episodeId = this.extractEpisodeIdFromUrl(url) || activeEpisodeId;
        if (!episodeId) {
            this.unknownTracks.set(url, {
                url,
                rawText,
                interceptedAt: Date.now(),
            });
            this.logger.info(
                'TVer-AI-Sub',
                `Stored unknown intercepted track: ${url.slice(0, 80)}`,
            );
            return null;
        }

        const { detail } = this.mergeOrRegisterTrack(episodeId, lang, {
            trackId: url,
            url,
            rawText,
            interceptedAt: Date.now(),
        });
        return detail;
    }

    registerKnownTrack(
        episodeId: string,
        lang: string,
        data: Omit<TVerTrackDetail, 'episodeId' | 'lang'>,
    ): TVerTrackDetail {
        const normalizedLang = (lang || 'ja').toLowerCase();
        let langMap = this.knownTracks.get(episodeId);
        if (!langMap) {
            langMap = new Map();
            this.knownTracks.set(episodeId, langMap);
        }

        const detail: TVerTrackDetail = {
            episodeId,
            lang: normalizedLang,
            trackId: data.trackId,
            label: data.label,
            kind: data.kind,
            url: data.url,
            rawText: data.rawText,
            interceptedAt: data.interceptedAt,
        };

        langMap.set(normalizedLang, detail);
        if (detail.url) {
            this.urlToKnownTrackIndex.set(detail.url, detail);
        }

        this.logger.info(
            'TVer-AI-Sub',
            `Registered known track for ep ${episodeId} (${normalizedLang}): len=${detail.rawText.length}`,
        );
        return detail;
    }

    checkUnknownTracks(
        episodeId: string,
        candidateUrls: readonly string[] = [],
    ): TVerTrackDetail[] {
        const resolved: TVerTrackDetail[] = [];
        if (!episodeId) return resolved;

        for (const [url, unknownTrack] of Array.from(this.unknownTracks.entries())) {
            const matchesUrl = candidateUrls.some(
                (c) => c && (c === url || url.includes(c) || c.includes(url)),
            );
            const isFresh = Date.now() - unknownTrack.interceptedAt < 60000;

            if (matchesUrl || isFresh) {
                const known = this.registerKnownTrack(episodeId, 'ja', {
                    trackId: url,
                    url,
                    rawText: unknownTrack.rawText,
                    interceptedAt: unknownTrack.interceptedAt,
                });
                this.unknownTracks.delete(url);
                resolved.push(known);
                this.logger.info(
                    'TVer-AI-Sub',
                    `Resolved unknown track for episode ${episodeId}: ${url.slice(0, 80)}`,
                );
            }
        }
        return resolved;
    }

    getCachedTrack(episodeId: string, targetLang = 'ja'): TVerTrackDetail | null {
        const langMap = this.knownTracks.get(episodeId);
        if (!langMap) return null;

        const normalized = (targetLang || 'ja').toLowerCase();
        const direct = langMap.get(normalized);
        if (direct) return direct;

        for (const [storedLang, track] of langMap.entries()) {
            if (Language.matches(storedLang, normalized)) {
                return track;
            }
        }
        return null;
    }

    async getTrack(
        episodeId: string,
        lang = 'ja',
        player: TVerStreaksPlayer | null,
        video: HTMLVideoElement | null,
    ): Promise<TVerTrackDetail | null | undefined> {
        if (!episodeId) return undefined;

        // 1. Check in-memory cache
        const cached = this.getCachedTrack(episodeId, lang);
        if (cached) return cached;

        // 2. Extract from StreaksPlayer / Video text tracks
        const extracted = await this.extractFromPlayerTracks(episodeId, player, video);
        if (extracted) return extracted;

        // 3. Resolve from buffered unknown tracks if any match
        const resolved = this.checkUnknownTracks(episodeId);
        if (resolved.length > 0) {
            return resolved[0];
        }

        // 4. Tri-state confirmation of 'null' vs 'undefined'
        if (this.isConfirmedNoSubtitle(player, video)) {
            this.logger.info(
                'TVer-AI-Sub',
                `Confirmed no subtitle available for episode ${episodeId}. Returning null.`,
            );
            return null;
        }

        // 5. Still pending / initializing
        return undefined;
    }

    async extractOrUpdateFromPlayerTracks(
        episodeId: string,
        player: TVerStreaksPlayer | null,
        video: HTMLVideoElement | null,
    ): Promise<{ detail: TVerTrackDetail | null; hasNewCues: boolean }> {
        try {
            const rawTrackList = (
                player && typeof player.textTracks === 'function'
                    ? (player.textTracks() as { tracks_?: TVerTextTrackLike[] })?.tracks_ || player.textTracks()
                    : video && video.textTracks ? video.textTracks : null
            ) as ArrayLike<TVerTextTrackLike> | null;

            if (!rawTrackList) return { detail: null, hasNewCues: false };

            const length = typeof rawTrackList.length === 'number' ? rawTrackList.length : 0;
            if (length === 0) return { detail: null, hasNewCues: false };

            const tracks: TVerTextTrackLike[] = [];
            for (let i = 0; i < length; i++) {
                const t = rawTrackList[i];
                if (t) tracks.push(t);
            }

            for (const track of tracks) {
                const src = (track.src || '').toLowerCase();
                if (src.includes('thumbnail')) continue;

                const kind = (track.kind || '').toLowerCase();
                if (kind === 'metadata' || kind === 'chapters') continue;

                const cues = track.cues_ || track.cues;
                if (cues && cues.length > 0) {
                    const vtt = TVerTrackRegistry.textTrackToWebVTT(track);
                    if (vtt && vtt.length > 20) {
                        const trackLang = track.language || 'ja';
                        const trackId = `track_${track.label || trackLang}`;
                        return this.mergeOrRegisterTrack(episodeId, trackLang, {
                            trackId,
                            label: track.label,
                            kind: track.kind,
                            url: track.src,
                            rawText: vtt,
                            interceptedAt: Date.now(),
                        });
                    }
                } else if (track.src) {
                    try {
                        const resp = await fetch(track.src);
                        if (resp.ok) {
                            const text = await resp.text();
                            if (TVerTrackRegistry.isSubtitleContent(text)) {
                                const trackLang = track.language || 'ja';
                                return this.mergeOrRegisterTrack(episodeId, trackLang, {
                                    trackId: track.src,
                                    label: track.label,
                                    kind: track.kind,
                                    url: track.src,
                                    rawText: text,
                                    interceptedAt: Date.now(),
                                });
                            }
                        }
                    } catch {
                        // Ignore fetch failure
                    }
                }
            }
        } catch (err) {
            this.logger.warn('TVer-AI-Sub', 'Error extracting from player tracks:', err);
        }
        return { detail: null, hasNewCues: false };
    }

    private async extractFromPlayerTracks(
        episodeId: string,
        player: TVerStreaksPlayer | null,
        video: HTMLVideoElement | null,
    ): Promise<TVerTrackDetail | null> {
        const { detail } = await this.extractOrUpdateFromPlayerTracks(episodeId, player, video);
        return detail;
    }

    private isConfirmedNoSubtitle(
        player: TVerStreaksPlayer | null,
        video: HTMLVideoElement | null,
    ): boolean {
        if (!video) return false;
        // If video hasn't loaded metadata or is still in readyState 0/1, player is not ready
        if (video.readyState < 2) return false;

        const rawTrackList = (
            player && typeof player.textTracks === 'function'
                ? (player.textTracks() as { tracks_?: TVerTextTrackLike[] })?.tracks_ || player.textTracks()
                : video && video.textTracks ? video.textTracks : null
        ) as ArrayLike<TVerTextTrackLike> | null;

        if (!rawTrackList) return false;

        const length = typeof rawTrackList.length === 'number' ? rawTrackList.length : 0;

        // If player has explicitly 0 text tracks after readyState >= 2
        if (length === 0) return true;

        // If all existing tracks are non-subtitles (thumbnails/metadata/chapters)
        let validSubtitleTrackCount = 0;
        for (let i = 0; i < length; i++) {
            const t = rawTrackList[i];
            if (!t) continue;
            const src = (t.src || '').toLowerCase();
            const kind = (t.kind || '').toLowerCase();
            if (src.includes('thumbnail') || kind === 'metadata' || kind === 'chapters') {
                continue;
            }
            validSubtitleTrackCount++;
        }

        return validSubtitleTrackCount === 0;
    }

    private extractEpisodeIdFromUrl(url: string): string | null {
        const match = url.match(/\/episodes\/([a-zA-Z0-9_-]+)/);
        return match ? match[1] : null;
    }

    clear(): void {
        this.knownTracks.clear();
        this.unknownTracks.clear();
        this.urlToKnownTrackIndex.clear();
    }
}
