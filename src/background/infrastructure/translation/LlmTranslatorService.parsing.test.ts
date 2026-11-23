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

describe('LlmTranslatorService rich model response parsing', () => {
    let translator: LlmTranslatorService;

    beforeEach(() => {
        mockCallChat.mockReset();
        translator = new LlmTranslatorService('ollama');
    });

    it('parses mixed marker styles ([id]:, 【id】：, id., #id:) and strips wrapper quotes', async () => {
        mockCallChat.mockResolvedValueOnce(
            [
                '[1]: "First line"',
                '【2】： “第二句”',
                '3. \'Third line\'',
                '#4: 第四句',
            ].join('\n'),
        );

        const res = await translator.translateBatch({
            items: [
                { id: 1, rawText: 'One' },
                { id: 2, rawText: 'Two' },
                { id: 3, rawText: 'Three' },
                { id: 4, rawText: 'Four' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.results).toEqual({
            1: 'First line',
            2: '第二句',
            3: 'Third line',
            4: '第四句',
        });
    });

    it('strips <think> and <thought> reasoning blocks before parsing translations', async () => {
        mockCallChat.mockResolvedValueOnce(
            [
                '<think>Let me analyze the context carefully...\n[1]: fake note</think>',
                '<THOUGHT>Checking tone...</THOUGHT>',
                '[1]: 你好，世界。',
                '[2]: 再见。',
            ].join('\n'),
        );

        const res = await translator.translateBatch({
            items: [
                { id: 1, rawText: 'Hello world.' },
                { id: 2, rawText: 'Goodbye.' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.results).toEqual({
            1: '你好，世界。',
            2: '再见。',
        });
    });

    it('preserves multi-line dialogue inside a single cue without leaking into next cue', async () => {
        mockCallChat.mockResolvedValueOnce(
            '[1]: 第一行台词\n第二行续接\n[2]: 下一句台词',
        );

        const res = await translator.translateBatch({
            items: [
                { id: 1, rawText: 'Line 1a\nLine 1b' },
                { id: 2, rawText: 'Line 2' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.results?.[1]).toBe('第一行台词\n第二行续接');
        expect(res.results?.[2]).toBe('下一句台词');
    });

    it('detects range variants like [1~2] and 【1至2】 as merged groups and splits them', async () => {
        mockCallChat
            .mockResolvedValueOnce('【1至2】：虽然很突然，但我必须出发了。')
            .mockResolvedValueOnce('[1]: 虽然很突然，\n[2]: 但我必须出发了。');

        const res = await translator.translateBatch({
            items: [
                { id: 1, rawText: '突然だけど' },
                { id: 2, rawText: '出発しないと。' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.merged).toEqual({ 1: [1, 2], 2: [1, 2] });
        expect(res.results).toEqual({
            1: '虽然很突然，',
            2: '但我必须出发了。',
        });
    });

    it('retries when a cue is missing, and recovers partial results safely on final attempt', async () => {
        mockCallChat
            .mockResolvedValueOnce('[1]: 第一句')
            .mockResolvedValueOnce('[1]: 第一句（重试）');

        const res = await translator.translateBatch({
            items: [
                { id: 1, rawText: 'First' },
                { id: 2, rawText: 'Second fallback' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(mockCallChat).toHaveBeenCalledTimes(2);
        expect(res.success).toBe(true);
        expect(res.results?.[1]).toBe('第一句（重试）');
        expect(res.results?.[2]).toBe('Second fallback');
    });

    it('falls back to line-by-line mapping when unmarked output has exact line count (ignoring markdown noise)', async () => {
        mockCallChat.mockResolvedValueOnce(
            ['# Translations', '---', '第一句', '* note ignored', '第二句'].join(
                '\n',
            ),
        );

        const res = await translator.translateBatch({
            items: [
                { id: 10, rawText: 'Line A' },
                { id: 20, rawText: 'Line B' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.results).toEqual({
            10: '第一句',
            20: '第二句',
        });
    });

    it('rejects unmarked output with mismatched line count to prevent cue misalignment', async () => {
        mockCallChat
            .mockResolvedValueOnce('只有一行')
            .mockResolvedValueOnce('还是只有一行');

        const res = await translator.translateBatch({
            items: [
                { id: 1, rawText: 'Line 1' },
                { id: 2, rawText: 'Line 2' },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(false);
        expect(res.error).toContain('Safety Guard');
    });

    it('strips unclosed or markdown-fenced <glossary_json> and filters placeholder entries', async () => {
        const ctx = new Context({
            showId: 'show-parse',
            title: 'Test',
            mainTitle: 'Test',
            targetLanguage: Language.resolve('简体中文'),
            isWarmedUp: true,
        });

        mockCallChat.mockResolvedValueOnce(
            [
                '[1]: 佐藤今天坐新干线去东京。',
                '<glossary_json>',
                '```json',
                '{',
                '  "new_characters": {',
                '    "Original Name": { "canonical": "Target Name", "aliases": ["new_alias"] },',
                '    "佐藤": { "canonical": "佐藤", "aliases": ["Sato", "new_alias"] }',
                '  },',
                '  "new_terms": {',
                '    "Term": "Translation",',
                '    "新幹線": "新干线",',
                '  }',
                '}',
                '```',
            ].join('\n'),
        );

        const res = await translator.translateBatch({
            items: [{ id: 1, rawText: '佐藤は今日新幹線で東京へ行く。' }],
            targetLang: Language.resolve('简体中文'),
            context: ctx,
            extractGlossary: true,
        });

        expect(res.success).toBe(true);
        expect(res.results?.[1]).toBe('佐藤今天坐新干线去东京。');
        expect(res.newCharacters).toEqual({
            佐藤: { canonical: '佐藤', aliases: ['Sato'] },
        });
        expect(res.newTerms).toEqual({
            新幹線: '新干线',
        });
    });

    it('parses supervisor JSON wrapped in prose + markdown fences with trailing commas', async () => {
        mockCallChat.mockResolvedValueOnce(
            [
                'Sure, here is the reviewed JSON:',
                '```json',
                '{',
                '  "corrections": {',
                '    "1": "更自然的译文",',
                '  },',
                '  "new_characters": {',
                '    "太郎": "太郎",',
                '    "花子": { "name": "花子", "aliases": ["小花"] },',
                '  },',
                '  "new_terms": {',
                '    "部活": "社团活动",',
                '  },',
                '}',
                '```',
                'Let me know if you need anything else.',
            ].join('\n'),
        );

        const res = await translator.reviewBatch({
            items: [{ id: 1, rawText: '部活に行こう。', transText: '去部活吧。' }],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.corrections).toEqual({ 1: '更自然的译文' });
        expect(res.newCharacters).toEqual({
            太郎: { canonical: '太郎', aliases: [] },
            花子: { canonical: '花子', aliases: ['小花'] },
        });
        expect(res.newTerms).toEqual({ 部活: '社团活动' });
    });

    it('repairs unescaped double quotes inside supervisor JSON string values', async () => {
        mockCallChat.mockResolvedValueOnce(
            [
                '{',
                '  "corrections": {',
                '    "5": "他说"绝对不行"然后离开了",',
                '  },',
                '  "new_characters": {},',
                '  "new_terms": {}',
                '}',
            ].join('\n'),
        );

        const res = await translator.reviewBatch({
            items: [
                {
                    id: 5,
                    rawText: 'He said "No way" and left.',
                    transText: '他说不行然后走了。',
                },
            ],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.corrections?.[5]).toBe('他说"绝对不行"然后离开了');
    });

    it('falls back to regex extraction when supervisor JSON is truncated/malformed', async () => {
        mockCallChat.mockResolvedValueOnce(
            [
                '{',
                '  "corrections": {',
                '    "12": "修正后的台词",',
                '  "new_terms": {',
                '    "学園祭": "学园祭"',
                '  // truncated before closing brace',
            ].join('\n'),
        );

        const res = await translator.reviewBatch({
            items: [{ id: 12, rawText: '学園祭だ！', transText: '学校节！' }],
            targetLang: Language.resolve('简体中文'),
            context: null,
        });

        expect(res.success).toBe(true);
        expect(res.corrections?.[12]).toBe('修正后的台词');
        expect(res.newTerms).toEqual({ 学園祭: '学园祭' });
    });
});
