import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@shared/domain/entities/Context';
import { Language } from '@shared/domain/value-objects/Language';

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

function createWarmedContext(overrides?: Partial<ConstructorParameters<typeof Context>[0]>) {
    return new Context({
        showId: 'show-1',
        title: 'Doraemon Demo',
        mainTitle: 'Doraemon Demo',
        targetLanguage: Language.resolve('简体中文'),
        isWarmedUp: true,
        manualSetupCharacters: {
            'nobi nobida': {
                canonical: '野比大雄',
                aliases: [],
                setByUser: true,
            },
            nobi: {
                canonical: '阿比',
                aliases: [],
                setByUser: true,
            },
            Scott: {
                canonical: '苏克特',
                aliases: ['Sco'],
                setByUser: true,
            },
        },
        manualSetupTerms: {
            'Anywhere Door': '任意门',
            'Bamboo Copter': '竹蜻蜓',
        },
        ...overrides,
    });
}

describe('LlmTranslatorService glossary scoping & programmatic self-repair', () => {
    let translator: LlmTranslatorService;

    beforeEach(() => {
        mockCallChat.mockReset();
        translator = new LlmTranslatorService('ollama');
    });

    it('injects only glossary entries relevant to the current batch & context', async () => {
        const ctx = createWarmedContext();
        mockCallChat.mockResolvedValueOnce('[1]: 快用任意门！');

        const res = await translator.translateBatch({
            items: [{ id: 1, rawText: 'Use the Anywhere Door now!' }],
            targetLang: Language.resolve('简体中文'),
            context: ctx,
        });

        expect(res.success).toBe(true);
        expect(mockCallChat).toHaveBeenCalledTimes(1);

        const [, payload] = mockCallChat.mock.calls[0];
        const systemPrompt = payload.messages[0].content as string;
        expect(systemPrompt).toContain('Anywhere Door -> 任意门');
        expect(systemPrompt).not.toContain('Bamboo Copter');
        expect(systemPrompt).not.toContain('Scott');
    });

    it('does not false-match short ASCII aliases inside longer words (e.g. "Sco" in "school")', async () => {
        const ctx = createWarmedContext();
        mockCallChat.mockResolvedValueOnce('[1]: 我们去学校吧。');

        const res = await translator.translateBatch({
            items: [{ id: 1, rawText: 'Let\'s go to school.' }],
            targetLang: Language.resolve('简体中文'),
            context: ctx,
        });

        expect(res.success).toBe(true);
        expect(mockCallChat).toHaveBeenCalledTimes(1);
        const [, payload] = mockCallChat.mock.calls[0];
        expect(payload.messages[0].content).not.toContain('Scott');
    });

    it('uses longest-match span masking so "nobi nobida" does not double-trigger shorter "nobi"', async () => {
        const ctx = createWarmedContext();
        mockCallChat.mockResolvedValueOnce('[1]: 野比大雄又迟到了。');

        const res = await translator.translateBatch({
            items: [{ id: 1, rawText: 'nobi nobida is late again.' }],
            targetLang: Language.resolve('简体中文'),
            context: ctx,
        });

        expect(res.success).toBe(true);
        expect(res.results?.[1]).toBe('野比大雄又迟到了。');
        // No false violation for "nobi -> 阿比", so no repair call should be made
        expect(mockCallChat).toHaveBeenCalledTimes(1);
    });

    it('checks both "nobi nobida" and an independent "nobi" in the same line', async () => {
        const ctx = createWarmedContext();
        mockCallChat
            .mockResolvedValueOnce('[1]: 野比大雄叫了大雄。')
            .mockResolvedValueOnce('[1]: 野比大雄叫了阿比。');

        const res = await translator.translateBatch({
            items: [{ id: 1, rawText: 'nobi nobida called nobi.' }],
            targetLang: Language.resolve('简体中文'),
            context: ctx,
        });

        expect(res.success).toBe(true);
        expect(mockCallChat).toHaveBeenCalledTimes(2);
        const [role, repairPayload] = mockCallChat.mock.calls[1];
        expect(role).toBe('translator');
        const userMsg = repairPayload.messages[1].content as string;
        expect(userMsg).toContain('ADVISORY (character): Source contains "nobi"');
        expect(userMsg).toContain('glossary canonical: "阿比"');
        expect(res.results?.[1]).toBe('野比大雄叫了阿比。');
    });

    it('routes programmatic glossary advisories to translator model first with explicit context details', async () => {
        const ctx = createWarmedContext();
        mockCallChat
            .mockResolvedValueOnce(
                '[1]: 大雄打开了传送门。\n[2]: 今天天气不错。',
            )
            .mockResolvedValueOnce('[1]: 野比大雄打开了任意门。');

        const res = await translator.translateBatch({
            items: [
                { id: 1, rawText: 'nobi nobida opened the Anywhere Door.' },
                { id: 2, rawText: 'Nice weather today.' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: ctx,
        });

        expect(res.success).toBe(true);
        expect(mockCallChat).toHaveBeenCalledTimes(2);

        const [repairRole, repairPayload] = mockCallChat.mock.calls[1];
        expect(repairRole).toBe('translator');
        const repairUserPrompt = repairPayload.messages[1].content as string;
        expect(repairUserPrompt).toContain('[1]');
        expect(repairUserPrompt).not.toContain('[2]');
        expect(repairUserPrompt).toContain('ADVISORY (character): Source contains "nobi nobida"');
        expect(repairUserPrompt).toContain('glossary canonical: "野比大雄"');
        expect(repairUserPrompt).toContain('ADVISORY (term): Source contains "Anywhere Door"');
        expect(repairUserPrompt).toContain('glossary canonical: "任意门"');

        expect(res.results?.[1]).toBe('野比大雄打开了任意门。');
        expect(res.results?.[2]).toBe('今天天气不错。');
    });

    it('allows translator to keep natural translation unchanged when advisory matches a compound or ordinary word', async () => {
        const ctx = createWarmedContext({
            manualSetupTerms: {
                Light: '莱特',
            },
        });
        mockCallChat
            .mockResolvedValueOnce('[1]: 请把灯打开。')
            .mockResolvedValueOnce('[1]: 请把灯打开。');

        const res = await translator.translateBatch({
            items: [{ id: 1, rawText: 'Please turn on the light.' }],
            targetLang: Language.resolve('简体中文'),
            context: ctx,
        });

        expect(res.success).toBe(true);
        expect(mockCallChat).toHaveBeenCalledTimes(2);
        expect(res.results?.[1]).toBe('请把灯打开。');
    });
});

describe('LlmTranslatorService merged subtitle splitting & supervisor grouping', () => {
    let translator: LlmTranslatorService;

    beforeEach(() => {
        mockCallChat.mockReset();
        translator = new LlmTranslatorService('ollama');
    });

    it('detects [start-end] merge, records merged group IDs, and asks translator to split', async () => {
        mockCallChat
            .mockResolvedValueOnce(
                '[1-2]: (仲井户)我认为下下个月的党首选举是绝佳的机会。',
            )
            .mockResolvedValueOnce(
                '[1]: (仲井户)我认为下下个月的党首选举\n[2]: 是绝佳的机会。',
            );

        const res = await translator.translateBatch({
            items: [
                { id: 1, rawText: '(仲井戸)再来月の党首選が' },
                { id: 2, rawText: '絶好の機会と思うんですよ。' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(mockCallChat).toHaveBeenCalledTimes(2);
        expect(mockCallChat.mock.calls[1][0]).toBe('translator');
        expect(res.merged).toEqual({ 1: [1, 2], 2: [1, 2] });
        expect(res.results?.[1]).toBe('(仲井户)我认为下下个月的党首选举');
        expect(res.results?.[2]).toBe('是绝佳的机会。');
    });

    it('falls back to keeping full translation only on first cue (never duplicating N copies) if split fails', async () => {
        mockCallChat
            .mockResolvedValueOnce(
                '[1-2]: (仲井户)我认为下下个月的党首选举是绝佳的机会。',
            )
            .mockRejectedValueOnce(new Error('Split request timeout'));

        const res = await translator.translateBatch({
            items: [
                { id: 1, rawText: '(仲井戸)再来月の党首選が' },
                { id: 2, rawText: '絶好の機会と思うんですよ。' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.merged).toEqual({ 1: [1, 2], 2: [1, 2] });
        expect(res.results?.[1]).toBe(
            '(仲井户)我认为下下个月的党首选举是绝佳的机会。',
        );
        expect(res.results?.[2]).toBe('');
    });

    it('combines merged cues into a single semantic unit for supervisor review without generating duplicate lines', async () => {
        mockCallChat
            .mockResolvedValueOnce(
                JSON.stringify({
                    corrections: {
                        '1-2': '(仲井户)下下个月的党首选举正是绝佳良机。',
                    },
                    new_characters: {},
                    new_terms: {},
                }),
            )
            .mockResolvedValueOnce(
                '[1]: (仲井户)下下个月的党首选举\n[2]: 正是绝佳良机。',
            );

        const res = await translator.reviewBatch({
            items: [
                {
                    id: 1,
                    rawText: '(仲井戸)再来月の党首選が',
                    transText: '(仲井户)我认为下下个月的党首选举',
                    merged: [1, 2],
                },
                {
                    id: 2,
                    rawText: '絶好の機会と思うんですよ。',
                    transText: '是绝佳的机会。',
                    merged: [1, 2],
                },
                {
                    id: 3,
                    rawText: '一時的に大嵐になると思います。',
                    transText: '我想暂时会掀起一场大风暴。',
                },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(mockCallChat).toHaveBeenCalledTimes(2);

        const [supRole, supPayload] = mockCallChat.mock.calls[0];
        expect(supRole).toBe('supervisor');
        const supUserPrompt = supPayload.messages[1].content as string;
        expect(supUserPrompt).toContain(
            '[1-2] Original: "(仲井戸)再来月の党首選が 絶好の機会と思うんですよ。" | Translated: "(仲井户)我认为下下个月的党首选举 是绝佳的机会。"',
        );
        expect(supUserPrompt).not.toContain('[1] Original:');
        expect(supUserPrompt).not.toContain('[2] Original:');
        expect(supUserPrompt).toContain('[3] Original:');

        expect(res.corrections?.[1]).toBe('(仲井户)下下个月的党首选举');
        expect(res.corrections?.[2]).toBe('正是绝佳良机。');
    });

    it('extracts new characters and terms cleanly from translator output when extractGlossary is enabled', async () => {
        const ctx = new Context({
            showId: 'show-2',
            title: 'Politics Drama',
            mainTitle: 'Politics Drama',
            targetLanguage: Language.resolve('简体中文'),
            isWarmedUp: true,
        });

        mockCallChat.mockResolvedValueOnce(
            [
                '[1]: (仲井户)准备参加党首选举。',
                '<glossary_json>',
                '{"new_characters":{"仲井戸":{"canonical":"仲井户","aliases":["Nakaido"]}},"new_terms":{"党首選":"党首选举"}}',
                '</glossary_json>',
            ].join('\n'),
        );

        const res = await translator.translateBatch({
            items: [{ id: 1, rawText: '(仲井戸)党首選に出馬する。' }],
            targetLang: Language.resolve('简体中文'),
            context: ctx,
            extractGlossary: true,
        });

        expect(res.success).toBe(true);
        // Ensure <glossary_json> is completely stripped from subtitle translation
        expect(res.results?.[1]).toBe('(仲井户)准备参加党首选举。');
        expect(res.newCharacters).toEqual({
            仲井戸: { canonical: '仲井户', aliases: ['Nakaido'] },
        });
        expect(res.newTerms).toEqual({
            党首選: '党首选举',
        });
    });
});
