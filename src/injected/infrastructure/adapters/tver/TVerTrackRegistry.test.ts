import { describe, expect, it } from 'vitest';
import { TVerTrackRegistry } from './TVerTrackRegistry';
import { TVerStreaksPlayer } from './TVerTypes';

const EP1_VTT = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
第一集台词一

2
00:00:04.000 --> 00:00:06.000
第一集台词二

3
00:00:07.000 --> 00:00:09.000
第一集台词三
`;

const EP2_VTT = `WEBVTT

1
00:00:02.000 --> 00:00:04.000
第二集台词一

2
00:00:05.000 --> 00:00:07.000
第二集台词二

3
00:00:08.000 --> 00:00:10.000
第二集台词三
`;

const EP1_TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="00:00:01.000" end="00:00:03.000">第一集台词一</p>
      <p begin="00:00:04.000" end="00:00:06.000">第一集台词二</p>
      <p begin="00:00:07.000" end="00:00:09.000">第一集台词三</p>
    </div>
  </body>
</tt>`;

describe('TVerTrackRegistry episode isolation & merge guard', () => {
    it('replaces instead of merging for non-live VOD tracks', () => {
        const registry = new TVerTrackRegistry();

        registry.mergeOrRegisterTrack(
            'ep2',
            'ja',
            { trackId: 't1', url: 'https://tver.jp/a.vtt', rawText: EP1_VTT, interceptedAt: 1000 },
            false,
        );

        const { detail, hasNewCues } = registry.mergeOrRegisterTrack(
            'ep2',
            'ja',
            { trackId: 't2', url: 'https://tver.jp/b.vtt', rawText: EP2_VTT, interceptedAt: 2000 },
            false,
        );

        expect(hasNewCues).toBe(true);
        expect(detail.rawText).toContain('第二集台词一');
        expect(detail.rawText).not.toContain('第一集台词一');
    });

    it('merges incremental cues only when allowMerge is true (live streams)', () => {
        const registry = new TVerTrackRegistry();

        registry.mergeOrRegisterTrack(
            'live1',
            'ja',
            { trackId: 'live', rawText: EP1_VTT, interceptedAt: 1000 },
            true,
        );

        const { detail, hasNewCues } = registry.mergeOrRegisterTrack(
            'live1',
            'ja',
            { trackId: 'live', rawText: EP2_VTT, interceptedAt: 2000 },
            true,
        );

        expect(hasNewCues).toBe(true);
        expect(detail.rawText).toContain('第一集台词一');
        expect(detail.rawText).toContain('第二集台词一');
    });

    it('ignores leftover TextTrack cues from previous episode (including TTML -> WebVTT cross-format)', async () => {
        const registry = new TVerTrackRegistry();

        registry.addInterceptedTrack(
            'https://cdn.tver.jp/sub/ep1.ttml',
            EP1_TTML,
            'ep1',
            'ja',
            false,
        );

        const stalePlayer = {
            textTracks: () => [
                {
                    kind: 'subtitles',
                    language: 'ja',
                    label: '日本語',
                    cues: [
                        { startTime: 1, endTime: 3, text: '第一集台词一' },
                        { startTime: 4, endTime: 6, text: '第一集台词二' },
                        { startTime: 7, endTime: 9, text: '第一集台词三' },
                    ],
                },
            ],
        } as unknown as TVerStreaksPlayer;

        const isStaleTrack = (rawText: string, url?: string) => {
            const prev = registry.getCachedTrack('ep1');
            if (!prev) return false;
            if (url && prev.url && url === prev.url) return true;
            return TVerTrackRegistry.isSameTrackContent(prev.rawText, rawText);
        };

        const staleAttempt = await registry.extractOrUpdateFromPlayerTracks(
            'ep2',
            stalePlayer,
            null,
            { allowMerge: false, isStaleTrack },
        );

        expect(staleAttempt.detail).toBeNull();
        expect(registry.getCachedTrack('ep2')).toBeNull();

        // Now ep2's real subtitle arrives
        const ep2Detail = registry.addInterceptedTrack(
            'https://cdn.tver.jp/sub/ep2.vtt',
            EP2_VTT,
            'ep2',
            'ja',
            false,
            isStaleTrack,
        );

        expect(ep2Detail?.rawText).toContain('第二集台词一');
        expect(ep2Detail?.rawText).not.toContain('第一集台词一');
    });

    it('clears unknownTracks on episode change so stale tracks are not bound to the next episode', () => {
        const registry = new TVerTrackRegistry();
        registry.addInterceptedTrack('https://cdn.tver.jp/unknown.vtt', EP1_VTT, null, 'ja');
        registry.clearUnknownTracks();

        const resolved = registry.checkUnknownTracks('ep2');
        expect(resolved).toHaveLength(0);
    });
});
