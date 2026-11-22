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
