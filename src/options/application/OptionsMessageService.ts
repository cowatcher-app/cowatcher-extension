/**
 * OptionsMessageService
 * Strongly typed message service for the options UI.
 */

import { ContentBackgroundBus } from '@shared/infrastructure/bus/ContentBackgroundBus';
import { AiSubState } from '@shared/domain/entities/AiSubState';
import { ContextDTO } from '@shared/domain/entities/Context';
import { OpenRouterModelItem } from '@shared/types/Messages';
import { StreamingPlatformId } from '@shared/domain/constants/StreamingPlatforms';
import { LanguageInfo } from '@shared/domain/value-objects/Language';
import {
    WordLookupRequest,
    WordLookupResult,
} from '@shared/domain/entities/SubtitleLearning';
import { CredentialVaultStatus } from '@shared/domain/entities/CredentialVault';
import { ExtensionSettings } from '@shared/domain/constants/SettingsDefaults';
import NCW_CONSTANTS from '@shared/utils/constants';

export class OptionsMessageService {
    private static instance: OptionsMessageService | null = null;

    static getInstance(): OptionsMessageService {
        if (!OptionsMessageService.instance) {
            OptionsMessageService.instance = new OptionsMessageService();
        }
        return OptionsMessageService.instance;
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

    // --- Glossary ---

    async getGlossaryContext(): Promise<ContextDTO | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_CONTEXT,
            {},
        );
        return res.success ? res.context : null;
    }

    async updateTerm(
        showId: string,
        targetLanguage: LanguageInfo,
        key: string,
        value: string,
    ): Promise<ContextDTO | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.UPDATE_TERM,
            {
                showId,
                targetLanguage,
                key,
                value,
            },
        );
        return res.success ? res.context : null;
    }

    async deleteTerm(
        shwoId: string,
        targetLanguage: LanguageInfo,
        key: string,
    ): Promise<ContextDTO | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.DELETE_TERM,
            {
                showId: shwoId,
                targetLanguage: targetLanguage,
                key: key,
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
                showId: showId,
                targetLanguage: targetLanguage,
            },
        );
        return res.success ? res.context : null;
    }

    // --- Vocabulary ---

    async lookupWordDefinition(
        req: WordLookupRequest,
    ): Promise<WordLookupResult | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.LOOKUP_WORD_DEFINITION,
            req,
        );
        return res && res.success && res.data ? res.data : null;
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

    async checkOpenRouter() {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.CHECK_OPENROUTER,
            undefined,
        );
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

    // --- Subtitle Cache Management ---

    async markCuesStale(params: {
        trackHash?: string;
        cacheKey?: string;
        startTime: number;
        endTime: number;
    }): Promise<{
        success: boolean;
        invalidatedCount: number;
        error?: string;
    }> {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.MARK_CUES_STALE,
            params,
        );
    }

    // --- Settings ---

    async saveSettings(settings: Partial<ExtensionSettings>) {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.SAVE_SETTINGS,
            { settings },
        );
    }

    // --- Watch History & Analytics ---

    async getWatchHistory() {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_WATCH_HISTORY,
            undefined,
        );
    }

    async clearWatchHistory(): Promise<boolean> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.CLEAR_WATCH_HISTORY,
            undefined,
        );
        return res.success;
    }

    async deleteShowHistory(showId: string): Promise<boolean> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.DELETE_SHOW_HISTORY,
            {
                showId,
            },
        );
        return res.success;
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
