import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Language } from '@shared/domain/value-objects/Language';
import { createSubtitleCue } from '@shared/domain/entities/Subtitle';
import { SubtitleStore } from '@content/application/store/SubtitleStore';
import {
    SubtitlePipelineCoordinator,
    SubtitlePipelineDelegate,
} from '@content/application/pipeline/SubtitlePipelineCoordinator';
import { ContentMessageService } from '@content/application/services/ContentMessageService';

const mockCallChat = vi.fn();

vi.mock('../../application/services/LlmService', () => ({
    LlmService: {
        getInstance: () => ({
            init: vi.fn().mockResolvedValue(undefined),
            callChat: mockCallChat,
        }),
    },
}));

vi.mock('@shared/infrastructure/storage/BrowserStorageFactory', () => ({
    BrowserStorageFactory: {
        getStorage: () => ({
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
        }),
    },
}));

import { LlmTranslatorService } from './LlmTranslatorService';

describe('LlmTranslatorService merged subtitle detection, splitting & supervisor alignment (rich cases)', () => {
    let translator: LlmTranslatorService;

    beforeEach(() => {
        mockCallChat.mockReset();
        translator = new LlmTranslatorService('ollama');
    });

    it('handles 2-cue Japanese simultaneous overlap merge and splits back cleanly', async () => {
        mockCallChat
            .mockResolvedValueOnce('[1-2]: 我认为下下个月的党首选举是绝佳的机会。')
            .mockResolvedValueOnce(
                '[1]: 我认为下下个月的党首选举\n[2]: 是绝佳的机会。',
            );

        const res = await translator.translateBatch({
            items: [
                { id: 1, rawText: '再来月の党首選が' },
                { id: 2, rawText: '絶好の機会と思うんですよ。' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.merged).toEqual({ 1: [1, 2], 2: [1, 2] });
        expect(res.results).toEqual({
            1: '我认为下下个月的党首选举',
            2: '是绝佳的机会。',
        });
    });

    it('handles 3-cue English multi-clause merge ([10-12]) and splits into 3 parts', async () => {
        mockCallChat
            .mockResolvedValueOnce(
                '[10-12]: If you finish the report before Friday, we can ship the release on Monday.',
            )
            .mockResolvedValueOnce(
                '[10]: If you finish the report\n[11]: before Friday, we can ship\n[12]: the release on Monday.',
            );

        const res = await translator.translateBatch({
            items: [
                { id: 10, rawText: 'Si terminas el informe' },
                { id: 11, rawText: 'antes del viernes, podremos' },
                { id: 12, rawText: 'lanzar la versión el lunes.' },
            ],
            targetLang: Language.resolve('English'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.merged).toEqual({
            10: [10, 11, 12],
            11: [10, 11, 12],
            12: [10, 11, 12],
        });
        expect(res.results).toEqual({
            10: 'If you finish the report',
            11: 'before Friday, we can ship',
            12: 'the release on Monday.',
        });
    });

    it('handles 4-cue Korean SOV merge (100-103) and splits into 4 parts without duplicating N copies', async () => {
        mockCallChat
            .mockResolvedValueOnce(
                '100-103. 虽然昨天雨下得很大，但大家还是按时到达了约定的地点。',
            )
            .mockResolvedValueOnce(
                '[100]: 虽然昨天\n[101]: 雨下得很大，\n[102]: 但大家还是按时\n[103]: 到达了约定的地点。',
            );

        const res = await translator.translateBatch({
            items: [
                { id: 100, rawText: '어제 비가' },
                { id: 101, rawText: '정말 많이 왔지만' },
                { id: 102, rawText: '모두 약속 장소에' },
                { id: 103, rawText: '제시간에 도착했어요.' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.merged).toEqual({
            100: [100, 101, 102, 103],
            101: [100, 101, 102, 103],
            102: [100, 101, 102, 103],
            103: [100, 101, 102, 103],
        });
        expect(res.results).toEqual({
            100: '虽然昨天',
            101: '雨下得很大，',
            102: '但大家还是按时',
            103: '到达了约定的地点。',
        });
    });

    it('handles mixed batch with single cues, 2-cue merge, and 3-cue merge in one call', async () => {
        mockCallChat
            .mockResolvedValueOnce(
                [
                    '[1]: 早上好。',
                    '[2-3]: 我本来想今天早点出门，结果睡过头了。',
                    '[4]: 没关系。',
                    '【5至7】：反正会议改到了下午两点，我们还有时间。',
                ].join('\n'),
            )
            .mockResolvedValueOnce(
                '[2]: 我本来想今天早点出门，\n[3]: 结果睡过头了。',
            )
            .mockResolvedValueOnce(
                '[5]: 反正会议改到了\n[6]: 下午两点，\n[7]: 我们还有时间。',
            );

        const res = await translator.translateBatch({
            items: [
                { id: 1, rawText: 'Good morning.' },
                { id: 2, rawText: 'I planned to leave early today,' },
                { id: 3, rawText: 'but I overslept.' },
                { id: 4, rawText: 'No worries.' },
                { id: 5, rawText: 'Anyway, the meeting was moved' },
                { id: 6, rawText: 'to 2 PM,' },
                { id: 7, rawText: 'so we still have time.' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        // 1 main translate + 2 targeted split calls (for [2,3] and [5,6,7])
        expect(mockCallChat).toHaveBeenCalledTimes(3);
        expect(res.merged).toEqual({
            2: [2, 3],
            3: [2, 3],
            5: [5, 6, 7],
            6: [5, 6, 7],
            7: [5, 6, 7],
        });
        expect(res.results).toEqual({
            1: '早上好。',
            2: '我本来想今天早点出门，',
            3: '结果睡过头了。',
            4: '没关系。',
            5: '反正会议改到了',
            6: '下午两点，',
            7: '我们还有时间。',
        });
    });

    it('falls back to first cue only when 3-cue split is partial/incomplete', async () => {
        mockCallChat
            .mockResolvedValueOnce('[1-3]: 无论发生什么，我都站在你这边。')
            // Missing cue [3] in split response
            .mockResolvedValueOnce('[1]: 无论发生什么，\n[2]: 我都站在');

        const res = await translator.translateBatch({
            items: [
                { id: 1, rawText: '何があっても' },
                { id: 2, rawText: '僕は君の' },
                { id: 3, rawText: '味方だから。' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.results).toEqual({
            1: '无论发生什么，我都站在你这边。',
            2: '',
            3: '',
        });
    });

    it('falls back to first cue only when 4-cue split stubbornly returns nested range', async () => {
        mockCallChat
            .mockResolvedValueOnce('[10-13]: 这次调查比预想的还要复杂得多。')
            .mockResolvedValueOnce('[10-13]: 这次调查比预想的还要复杂得多。');

        const res = await translator.translateBatch({
            items: [
                { id: 10, rawText: 'This investigation' },
                { id: 11, rawText: 'is turning out' },
                { id: 12, rawText: 'to be far more' },
                { id: 13, rawText: 'complicated than expected.' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.results).toEqual({
            10: '这次调查比预想的还要复杂得多。',
            11: '',
            12: '',
            13: '',
        });
    });

    it('groups 2-cue, 3-cue (including empty fallback cues), and 4-cue merges into single supervisor entries', async () => {
        mockCallChat
            .mockResolvedValueOnce(
                JSON.stringify({
                    corrections: {
                        '10-12': '如果周五前完成报告，我们周一就能发布。',
                    },
                    new_characters: {},
                    new_terms: {},
                }),
            )
            .mockResolvedValueOnce(
                '[10]: 如果周五前\n[11]: 完成报告，\n[12]: 我们周一就能发布。',
            );

        const res = await translator.reviewBatch({
            items: [
                // 2-cue fallback (second cue empty)
                {
                    id: 1,
                    rawText: '再来月の党首選が',
                    transText: '下下个月的党首选举是绝佳机会。',
                    merged: [1, 2],
                },
                {
                    id: 2,
                    rawText: '絶好の機会と思うんですよ。',
                    transText: '',
                    merged: [1, 2],
                },
                // 3-cue split
                {
                    id: 10,
                    rawText: 'If you finish',
                    transText: '如果你完成',
                    merged: [10, 11, 12],
                },
                {
                    id: 11,
                    rawText: 'the report by Friday,',
                    transText: '报告在周五前，',
                    merged: [10, 11, 12],
                },
                {
                    id: 12,
                    rawText: 'we ship on Monday.',
                    transText: '我们周一发布。',
                    merged: [10, 11, 12],
                },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        const supUserPrompt = mockCallChat.mock.calls[0][1].messages[1]
            .content as string;

        expect(supUserPrompt).toContain(
            '[1-2] Original: "再来月の党首選が 絶好の機会と思うんですよ。" | Translated: "下下个月的党首选举是绝佳机会。"',
        );
        expect(supUserPrompt).toContain(
            '[10-12] Original: "If you finish the report by Friday, we ship on Monday." | Translated: "如果你完成 报告在周五前， 我们周一发布。"',
        );
        expect(supUserPrompt).not.toContain('[1] Original:');
        expect(supUserPrompt).not.toContain('[2] Original:');
        expect(supUserPrompt).not.toContain('[10] Original:');
        expect(supUserPrompt).not.toContain('[11] Original:');
        expect(supUserPrompt).not.toContain('[12] Original:');

        expect(res.corrections).toEqual({
            10: '如果周五前',
            11: '完成报告，',
            12: '我们周一就能发布。',
        });
    });

    it('keeps an entire merged group in the same supervisor batch across overlap, gap, and batchSize boundary', () => {
        const store = new SubtitleStore();
        // Cue 1: standalone
        // Cues 2, 3, 4: merged group [2, 3, 4] spanning overlap + 2s gap, crossing batchSize = 2!
        // Cue 5: standalone after group
        store.cues = [
            createSubtitleCue({ id: 1, startTime: 0, endTime: 2, rawText: 'A' }),
            createSubtitleCue({
                id: 2,
                startTime: 2,
                endTime: 4,
                rawText: 'B1',
                merged: [2, 3, 4],
            }),
            createSubtitleCue({
                id: 3,
                startTime: 2,
                endTime: 4,
                rawText: 'B2',
                merged: [2, 3, 4],
            }),
            createSubtitleCue({
                id: 4,
                startTime: 6,
                endTime: 8,
                rawText: 'B3',
                merged: [2, 3, 4],
            }),
            createSubtitleCue({ id: 5, startTime: 9, endTime: 11, rawText: 'C' }),
        ];

        store.setTranslation(1, '甲', 'raw');
        store.setTranslation(2, '乙全句', 'raw', undefined, [2, 3, 4]);
        // Simulate split fallback where 3 and 4 are intentionally ''
        store.setTranslation(3, '', 'raw', undefined, [2, 3, 4]);
        store.setTranslation(4, '', 'raw', undefined, [2, 3, 4]);
        store.setTranslation(5, '丙', 'raw');

        const sentBatches: number[][] = [];
        const mockMsg = {
            reviewBatch: vi.fn((params: { items: Array<{ id: number }> }) => {
                sentBatches.push(params.items.map((i) => i.id));
                return Promise.resolve({ success: false });
            }),
        } as unknown as ContentMessageService;

        const mockDelegate = {
            isContextValid: () => true,
            detachVideo: () => {},
            getCurrentShowId: () => 'show-1',
            getCurrentMovieId: () => 'ep-1',
        } as unknown as SubtitlePipelineDelegate;

        const coordinator = new SubtitlePipelineCoordinator(
            mockMsg,
            store,
            mockDelegate,
            () => ({
                enabled: true,
                enableSupervisor: true,
                reviewBatchSize: 2,
            }),
        );

        coordinator.processSupervisorReviewQueue({
            minTranslateCues: 1,
            maxTranslateCues: 30,
            refillThreshold: 10,
            reviewBatchSize: 2,
        });

        // Even though reviewBatchSize is 2, cues [2, 3, 4] must NOT be split across batches;
        // cue 5 stays out for the next batch.
        expect(sentBatches).toEqual([[1, 2, 3, 4]]);
    });
});
