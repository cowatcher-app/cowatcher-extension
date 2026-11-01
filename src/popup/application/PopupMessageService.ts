import { ContentBackgroundBus } from '@shared/infrastructure/bus/ContentBackgroundBus';
import { AiSubState } from '@shared/domain/entities/AiSubState';
import { ContextDTO } from '@shared/domain/entities/Context';
import { ExtensionSettings } from '@shared/domain/constants/SettingsDefaults';
import { EpisodeVocabData, OpenRouterModelItem } from '@shared/types/Messages';
import { OpenRouterCheckResult } from '@shared/domain/entities/PipelineTypes';
import { createSubtitleCue } from '@shared/domain/entities/Subtitle';
import { LanguageInfo } from '@shared/domain/value-objects/Language';
import {
    CharacterGlossaryMap,
    TermGlossaryMap,
} from '@shared/domain/entities/Glossary';
import { StreamingPlatformId } from '@shared/domain/constants/StreamingPlatforms';
import { CredentialVaultStatus } from '@shared/domain/entities/CredentialVault';
import NCW_CONSTANTS from '@shared/utils/constants';

export class PopupMessageService {
    private static instance: PopupMessageService | null = null;

    static getInstance(): PopupMessageService {
        if (!PopupMessageService.instance) {
            PopupMessageService.instance = new PopupMessageService();
        }
        return PopupMessageService.instance;
    }

    // --- AI Sub State ---

    async getAiSubState(): Promise<AiSubState | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_AI_SUB_STATE,
            undefined,
        );
        return res.success && res.state ? new AiSubState(res.state) : null;
    }

    async setAiSubEnabled(
        enabled: boolean,
        platform?: StreamingPlatformId,
    ): Promise<AiSubState | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.SET_AI_SUB_ENABLED,
            {
                enabled,
                platform,
            },
        );
        return res.success && res.state ? new AiSubState(res.state) : null;
    }

    onAiSubStateChanged(callback: (state: AiSubState) => void): () => void {
        return ContentBackgroundBus.onMessage(
            NCW_CONSTANTS.MESSAGE_TYPES.PUSH_AI_SUB_STATE_CHANGED,
            (payload) => {
                if (payload && payload.state) {
                    callback(new AiSubState(payload.state));
                }
            },
        );
    }

    // --- Glossary ---

    async getGlossaryContext(tabId: number): Promise<ContextDTO | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_CONTEXT,
            {
                tabId: tabId,
            },
        );
        return res.success ? res.context : null;
    }

    async updateTerm(
        key: string,
        value: string,
        showId: string,
        targetLanguage: LanguageInfo,
    ): Promise<ContextDTO | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.UPDATE_TERM,
            {
                key,
                value,
                showId,
                targetLanguage,
            },
        );
        return res.success ? res.context : null;
    }

    async deleteTerm(
        key: string,
        showId: string,
        targetLanguage: LanguageInfo,
    ): Promise<ContextDTO | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.DELETE_TERM,
            {
                key,
                showId,
                targetLanguage,
            },
        );
        return res.success ? res.context : null;
    }

    async updateCharacter(
        showId: string,
        targetLanguage: LanguageInfo,
        name: string,
        canonical: string,
        aliases?: string[],
    ): Promise<ContextDTO | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.UPDATE_CHARACTER,
            {
                showId: showId,
                targetLanguage: targetLanguage,
                name: name,
                canonical: canonical,
                aliases: aliases,
            },
        );
        return res.success ? res.context : null;
    }

    async deleteCharacter(
        showId: string,
        targetLanguage: LanguageInfo,
        name: string,
    ): Promise<ContextDTO | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.DELETE_CHARACTER,
            {
                showId,
                targetLanguage,
                name,
            },
        );
        return res.success ? res.context : null;
    }

    async resetGlossaryContext(
        showId: string,
        targetLanguage: LanguageInfo,
    ): Promise<ContextDTO | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.RESET_CONTEXT,
            {
                showId,
                targetLanguage,
            },
        );
        return res.success ? res.context : null;
    }

    onGlossaryChanged(callback: (context: ContextDTO) => void): () => void {
        return ContentBackgroundBus.onMessage(
            NCW_CONSTANTS.MESSAGE_TYPES.PUSH_GLOSSARY_CHANGED,
            (payload) => {
                if (payload && payload.context) {
                    callback(payload.context);
                }
            },
        );
    }

    // --- Vocabulary ---

    async getVocabData(movieId?: string): Promise<EpisodeVocabData | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_VOCAB_DATA,
            {
                movieId,
            },
        );
        return res.success ? res.data : null;
    }

    async resetVocabData(movieId: string): Promise<boolean> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.RESET_VOCAB_DATA,
            {
                movieId,
            },
        );
        return res.success;
    }

    // --- Provider Checks ---

    async checkOllama(): Promise<{
        success: boolean;
        models?: Array<{ name: string }>;
        error?: string;
    }> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.CHECK_OLLAMA,
            undefined,
        );
        return { success: res.success, models: res.data, error: res.error };
    }

    async checkOpenRouter(): Promise<{
        success: boolean;
        data?: OpenRouterCheckResult;
        error?: string;
    }> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.CHECK_OPENROUTER,
            undefined,
        );
        return res;
    }

    async fetchOpenRouterModels(): Promise<{
        success: boolean;
        models?: OpenRouterModelItem[];
        error?: string;
    }> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.FETCH_OPENROUTER_MODELS,
            undefined,
        );
        return { success: res.success, models: res.models, error: res.error };
    }

    // --- Translation Test & Supervision ---

    async translateBatch(
        items: Array<{ id: number; text: string }>,
    ): Promise<{
        success: boolean;
        results?: Record<number, string>;
        error?: string;
    }> {
        const cueItems = items.map((it) =>
            createSubtitleCue({
                id: it.id,
                rawText: it.text,
                startTime: 0,
                endTime: 0,
            }),
        );
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.TRANSLATE_BATCH,
            {
                items: cueItems,
            },
        );
        return res;
    }

    async supervisorReview(
        items: Array<{ id: number; orig: string; trans: string }>,
    ): Promise<{
        success: boolean;
        corrections?: Record<number, string>;
        updatedContext?: ContextDTO;
        error?: string;
    }> {
        const cueItems = items.map((it) =>
            createSubtitleCue({
                id: it.id,
                rawText: it.orig,
                transText: it.trans,
                status: 'raw',
                startTime: 0,
                endTime: 0,
            }),
        );
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.SUPERVISOR_REVIEW,
            {
                items: cueItems,
            },
        );
        return res;
    }

    onVocabChanged(callback: (data: EpisodeVocabData) => void): () => void {
        return ContentBackgroundBus.onMessage(
            NCW_CONSTANTS.MESSAGE_TYPES.PUSH_VOCAB_CHANGED,
            (payload) => {
                if (payload && payload.data) {
                    callback(payload.data);
                }
            },
        );
    }

    onSettingsChanged(
        callback: (settings: ExtensionSettings) => void,
    ): () => void {
        return ContentBackgroundBus.onMessage(
            NCW_CONSTANTS.MESSAGE_TYPES.PUSH_SETTINGS_CHANGED,
            (payload) => {
                if (payload && payload.settings) {
                    callback(payload.settings);
                }
            },
        );
    }

    // --- AI Glossary Extraction & Bulk Update ---

    async getAiCapability(): Promise<{
        success: boolean;
        hasAi: boolean;
        provider?: string;
        model?: string;
        isSupervisor: boolean;
    }> {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_AI_CAPABILITY,
            undefined,
        );
    }

    async extractGlossaryBilingual(params: {
        sourceText: string;
        targetText: string;
        targetLang: LanguageInfo;
    }): Promise<{
        success: boolean;
        data?: { characters: CharacterGlossaryMap; terms: TermGlossaryMap };
        error?: string;
    }> {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.EXTRACT_GLOSSARY_BILINGUAL,
            params,
        );
    }

    async extractGlossaryAndTranslate(params: {
        sourceText: string;
        targetLang: LanguageInfo;
    }): Promise<{
        success: boolean;
        data?: { characters: CharacterGlossaryMap; terms: TermGlossaryMap };
        error?: string;
    }> {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.EXTRACT_GLOSSARY_AND_TRANSLATE,
            params,
        );
    }

    async bulkUpdateGlossary(params: {
        showId: string;
        targetLanguage: LanguageInfo;
        characters?: CharacterGlossaryMap;
        terms?: TermGlossaryMap;
    }): Promise<{ success: boolean; context?: ContextDTO; error?: string }> {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.BULK_UPDATE_GLOSSARY,
            params,
        );
    }

    // --- Credential Vault Operations ---

    async getCredentialStatus(): Promise<CredentialVaultStatus> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_CREDENTIAL_STATUS,
            undefined,
        );
        return (
            res.status || {
                hasKey: false,
                isEncrypted: false,
                isUnlocked: true,
                maskedKey: '',
            }
        );
    }

    async saveCredentials(params: {
        apiKey?: string;
        masterPassword?: string;
        enableEncryption?: boolean;
    }) {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.SAVE_CREDENTIALS,
            params,
        );
    }

    async unlockCredentials(password: string) {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.UNLOCK_CREDENTIALS,
            { password },
        );
    }

    async lockCredentials() {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.LOCK_CREDENTIALS,
            undefined,
        );
    }

    async disableCredentialEncryption(password: string) {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.DISABLE_CREDENTIAL_ENCRYPTION,
            { password },
        );
    }

    async clearCredentials() {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.CLEAR_CREDENTIALS,
            undefined,
        );
    }
}
