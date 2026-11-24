import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@shared/domain/entities/Context';
import { Language } from '@shared/domain/value-objects/Language';

const mockCallChat = vi.fn();
const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();

vi.mock('./LlmService', () => ({
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
            get: mockStorageGet,
            set: mockStorageSet,
        }),
    },
}));

vi.mock('@shared/infrastructure/bus/ContentBackgroundBus', () => ({
    ContentBackgroundBus: {
        broadcastToTabs: vi.fn().mockResolvedValue(undefined),
        sendToTab: vi.fn().mockResolvedValue(undefined),
    },
}));

import { GlossaryService } from './GlossaryService';
import { LlmTranslatorService } from '../../infrastructure/translation/LlmTranslatorService';

const ZH_CN = Language.resolve('简体中文');

describe('GlossaryService alias splitting and substring consistency', () => {
    let service: GlossaryService;

    beforeEach(() => {
        vi.clearAllMocks();
        mockStorageGet.mockResolvedValue({});
        mockStorageSet.mockResolvedValue(undefined);
        // Reset singleton between tests for clean in-memory cache isolation
        (GlossaryService as unknown as { instance: GlossaryService | null }).instance =
            null;
        service = GlossaryService.getInstance();
    });

    it('splits discovered aliases into standalone entries and clears aliases on parent', async () => {
        mockCallChat.mockResolvedValueOnce(
            JSON.stringify({
                aliases: { 伊丹: '伊丹' },
                substrings: {},
            }),
        );

        const ctx = await service.updateWarmupContext({
            showId: 'aibou-s1',
            targetLanguage: ZH_CN,
            title: '相棒',
            characters: {
                伊丹憲一: {
                    canonical: '伊丹宪一',
                    aliases: ['伊丹', '伊丹宪一'],
                },
            },
            role: 'supervisor',
        });

        expect(mockCallChat).toHaveBeenCalledTimes(1);
        expect(mockCallChat.mock.calls[0][0]).toBe('supervisor');
        const userPayload = JSON.parse(
            mockCallChat.mock.calls[0][1].messages[1].content,
        );
        expect(userPayload.aliasTranslations).toEqual([
            {
                alias: '伊丹',
                parentName: '伊丹憲一',
                parentCanonical: '伊丹宪一',
            },
        ]);

        expect(ctx.characters['伊丹憲一']).toEqual({
            canonical: '伊丹宪一',
            aliases: [],
            setByUser: undefined,
        });
        expect(ctx.characters['伊丹']).toEqual({
            canonical: '伊丹',
            aliases: [],
            setByUser: false,
        });
    });

    it('splits aliases and clears them when user manually updates character or bulk glossary', async () => {
        await service.updateWarmupContext({
            showId: 'aibou-manual',
            targetLanguage: ZH_CN,
            title: '相棒',
        });

        mockCallChat.mockResolvedValueOnce(
            JSON.stringify({
                aliases: { 右京: '右京', 右京さん: '右京先生' },
                substrings: {},
            }),
        );

        const afterSingle = await service.updateCharacter(
            'aibou-manual',
            ZH_CN,
            '杉下右京',
            '杉下右京',
            ['右京', '右京さん'],
        );

        expect(afterSingle.manualSetupCharacters['杉下右京']).toEqual({
            canonical: '杉下右京',
            aliases: [],
            setByUser: true,
        });
        expect(afterSingle.manualSetupCharacters['右京']).toEqual({
            canonical: '右京',
            aliases: [],
            setByUser: true,
        });
        expect(afterSingle.manualSetupCharacters['右京さん']).toEqual({
            canonical: '右京先生',
            aliases: [],
            setByUser: true,
        });

        mockCallChat.mockResolvedValueOnce(
            JSON.stringify({
                aliases: { 薫: '薰' },
                substrings: {},
            }),
        );

        const afterBulk = await service.bulkUpdateGlossary({
            showId: 'aibou-manual',
            targetLanguage: ZH_CN,
            characters: {
                亀山薫: {
                    canonical: '龟山薰',
                    aliases: ['薫'],
                    setByUser: true,
                },
            },
        });

        expect(afterBulk.manualSetupCharacters['亀山薫'].aliases).toEqual([]);
        expect(afterBulk.manualSetupCharacters['薫']).toEqual({
            canonical: '薰',
            aliases: [],
            setByUser: true,
        });
    });

    it('flags and re-translates substring key when translation equals full key translation', async () => {
        await service.updateWarmupContext({
            showId: 'doraemon-1',
            targetLanguage: ZH_CN,
            characters: {
                'nobi nobida': { canonical: '野比大雄', aliases: [] },
            },
        });
        expect(mockCallChat).not.toHaveBeenCalled();

        mockCallChat.mockResolvedValueOnce(
            JSON.stringify({
                aliases: {},
                substrings: { nobi: '大雄' },
            }),
        );

        const ctx = await service.updateWarmupContext({
            showId: 'doraemon-1',
            targetLanguage: ZH_CN,
            characters: {
                nobi: { canonical: '野比大雄', aliases: [] },
            },
            role: 'translator',
        });

        expect(mockCallChat).toHaveBeenCalledTimes(1);
        expect(ctx.characters['nobi'].canonical).toBe('大雄');
        expect(ctx.characters['nobi nobida'].canonical).toBe('野比大雄');
    });

    it('flags substring key when translation is not a substring of full key, and preserves valid transliterations', async () => {
        await service.updateWarmupContext({
            showId: 'sub-check',
            targetLanguage: ZH_CN,
            characters: {
                杉下右京: { canonical: '杉下右京', aliases: [] },
                Alexander: { canonical: '亚历山大', aliases: [] },
            },
        });

        mockCallChat.mockResolvedValueOnce(
            JSON.stringify({
                aliases: {},
                substrings: {
                    右京: '右京',
                    Alex: '亚历克斯',
                },
            }),
        );

        const ctx = await service.updateWarmupContext({
            showId: 'sub-check',
            targetLanguage: ZH_CN,
            characters: {
                右京: { canonical: '友京', aliases: [] },
                Alex: { canonical: '亚历克斯', aliases: [] },
            },
        });

        expect(mockCallChat).toHaveBeenCalledTimes(1);
        expect(ctx.characters['右京'].canonical).toBe('右京');
        expect(ctx.characters['Alex'].canonical).toBe('亚历克斯');
    });

    it('skips LLM call when substring translation is already consistent', async () => {
        await service.updateWarmupContext({
            showId: 'consistent-1',
            targetLanguage: ZH_CN,
            characters: {
                伊丹憲一: { canonical: '伊丹宪一', aliases: [] },
            },
        });

        const ctx = await service.updateWarmupContext({
            showId: 'consistent-1',
            targetLanguage: ZH_CN,
            characters: {
                伊丹: { canonical: '伊丹', aliases: [] },
            },
        });

        expect(mockCallChat).not.toHaveBeenCalled();
        expect(ctx.characters['伊丹'].canonical).toBe('伊丹');
    });

    it('does not include Aliases/Called in translator or supervisor prompts even for legacy contexts', async () => {
        const legacyCtx = new Context({
            showId: 'legacy-1',
            title: '相棒',
            mainTitle: '相棒',
            targetLanguage: ZH_CN,
            isWarmedUp: true,
            characters: {
                伊丹憲一: {
                    canonical: '伊丹宪一',
                    aliases: ['伊丹'],
                },
            },
        });

        const translator = new LlmTranslatorService('ollama');
        mockCallChat.mockResolvedValueOnce(
            JSON.stringify({
                translations: [{ id: 1, text: '伊丹宪一来了' }],
                newCharacters: {},
                newTerms: {},
            }),
        );

        await translator.translateBatch({
            items: [{ id: 1, rawText: '伊丹憲一が来た' }],
            context: legacyCtx,
            targetLang: ZH_CN,
        });

        const systemPrompt = mockCallChat.mock.calls[0][1].messages[0].content;
        expect(systemPrompt).toContain('伊丹憲一 -> 伊丹宪一');
        expect(systemPrompt).not.toContain('Aliases/Called');
    });
});
