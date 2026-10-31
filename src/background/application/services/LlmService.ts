/**
 * LLM Service
 * Manages active LLM provider and client instances for translator and supervisor roles.
 * Dispatches chat calls by role without exposing provider/credentials to callers.
 */

import { OpenRouterModelItem } from '@shared/types/Messages';
import {
    DEFAULT_SETTINGS,
    ExtensionSettings,
} from '@shared/domain/constants/SettingsDefaults';
import { NCW_STORAGE_KEYS } from '@shared/domain/constants/StorageKeys';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { IBrowserStorage } from '@shared/infrastructure/storage/IBrowserStorage';
import { LLMProvider } from '@shared/domain/entities/PipelineTypes';
import { LlmRole, AiCapability } from '../../domain/llm/LlmRole';
import { ILlmClient, LlmChatMessage } from '../../domain/llm/ILlmClient';
import { LlmClientFactory } from '../../infrastructure/llm/LlmClientFactory';
import { OllamaClient } from '../../infrastructure/llm/OllamaClient';
import { OpenRouterClient } from '../../infrastructure/llm/OpenRouterClient';

export interface LlmRoleChatParams {
    messages: LlmChatMessage[];
    temperature?: number;
    jsonMode?: boolean;
    signal?: AbortSignal;
}

export class LlmService {
    private static instance: LlmService | null = null;
    private storage: IBrowserStorage;

    private activeProvider: LLMProvider = 'ollama';
    private translatorModel: string = DEFAULT_SETTINGS.ollamaModel;
    private supervisorModel: string = DEFAULT_SETTINGS.supervisorModel;
    private enableSupervisor: boolean = DEFAULT_SETTINGS.enableSupervisor;

    private vocabProvider: LLMProvider = 'openrouter';
    private vocabModel: string = DEFAULT_SETTINGS.vocabExtractorModel;

    private openrouterApiKey: string = DEFAULT_SETTINGS.openrouterApiKey || '';
    private ollamaHost: string =
        DEFAULT_SETTINGS.ollamaHost || 'http://localhost:11434';
    private ollamaAliveCache: { alive: boolean; timestamp: number } | null =
        null;
    private static readonly OLLAMA_CACHE_TTL_MS = 15000;

    private translatorClient: ILlmClient | null = null;
    private supervisorClient: ILlmClient | null = null;
    private vocabClient: ILlmClient | null = null;

    private initialized: boolean = false;

    private constructor(
        storage: IBrowserStorage = BrowserStorageFactory.getStorage(),
    ) {
        this.storage = storage;
    }

    async init(): Promise<void> {
        if (this.initialized) return;

        await this.initClientsFromSettings(DEFAULT_SETTINGS);
        await this.initFromStorage();

        this.storage.onChanged((changes) => {
            if (changes[NCW_STORAGE_KEYS.SETTINGS]?.newValue) {
                this.updateFromSettings(
                    changes[NCW_STORAGE_KEYS.SETTINGS]
                        .newValue as Partial<ExtensionSettings>,
                );
            }
        });

        this.initialized = true;
    }

    static getInstance(storage?: IBrowserStorage): LlmService {
        if (!LlmService.instance) {
            LlmService.instance = new LlmService(storage);
        }
        return LlmService.instance;
    }

    private resolveProvider(rawProvider?: string): LLMProvider {
        return rawProvider === 'openrouter' ? 'openrouter' : 'ollama';
    }

    private resolveVocabProvider(rawProvider?: string): LLMProvider {
        return rawProvider === 'ollama' ? 'ollama' : 'openrouter';
    }

    private resolveVocabModel(
        provider: LLMProvider,
        settings: Partial<ExtensionSettings>,
    ): string {
        if (provider === 'ollama') {
            return (
                settings.vocabExtractorOllamaModel?.trim() ||
                DEFAULT_SETTINGS.vocabExtractorOllamaModel ||
                'qwen2.5:7b'
            );
        }
        return (
            settings.vocabExtractorModel?.trim() ||
            DEFAULT_SETTINGS.vocabExtractorModel ||
            'deepseek/deepseek-chat'
        );
    }

    private resolveModels(
        provider: LLMProvider,
        settings: Partial<ExtensionSettings>,
    ): { translatorModel: string; supervisorModel: string } {
        if (provider === 'openrouter') {
            const translatorModel =
                settings.openrouterTranslationModel?.trim() ||
                DEFAULT_SETTINGS.openrouterTranslationModel ||
                'deepseek/deepseek-chat';
            const supervisorModel =
                settings.openrouterSupervisorModel?.trim() ||
                DEFAULT_SETTINGS.openrouterSupervisorModel ||
                'google/gemini-2.5-flash';
            return { translatorModel, supervisorModel };
        }

        const translatorModel =
            settings.translationModel?.trim() ||
            settings.ollamaModel?.trim() ||
            DEFAULT_SETTINGS.ollamaModel ||
            'translategemma:4b';
        const supervisorModel =
            settings.supervisorModel?.trim() ||
            settings.ollamaModel?.trim() ||
            DEFAULT_SETTINGS.supervisorModel ||
            'translategemma:4b';

        return { translatorModel, supervisorModel };
    }

    private async initClientsFromSettings(
        settings: Partial<ExtensionSettings>,
    ): Promise<void> {
        const provider = this.resolveProvider(settings.aiProvider);
        const { translatorModel, supervisorModel } = this.resolveModels(
            provider,
            settings,
        );
        const enableSupervisor =
            settings.enableSupervisor !== undefined
                ? settings.enableSupervisor
                : this.enableSupervisor;

        const vocabProvider = this.resolveVocabProvider(
            settings.vocabExtractorProvider,
        );
        const vocabModel = this.resolveVocabModel(vocabProvider, settings);

        if (settings.openrouterApiKey !== undefined) {
            this.openrouterApiKey = settings.openrouterApiKey;
        }
        if (settings.ollamaHost !== undefined) {
            this.ollamaHost = settings.ollamaHost;
        }

        this.activeProvider = provider;
        this.translatorModel = translatorModel;
        this.supervisorModel = supervisorModel;
        this.enableSupervisor = enableSupervisor;

        this.vocabProvider = vocabProvider;
        this.vocabModel = vocabModel;

        this.translatorClient = await LlmClientFactory.getOrCreateClient(
            this.activeProvider,
            'translator',
            this.translatorModel,
        );
        this.supervisorClient = await LlmClientFactory.getOrCreateClient(
            this.activeProvider,
            'supervisor',
            this.supervisorModel,
        );
        this.vocabClient = await LlmClientFactory.getOrCreateClient(
            this.vocabProvider,
            'vocab',
            this.vocabModel,
        );
    }

    async initFromStorage(): Promise<void> {
        const res = await this.storage.get<Partial<ExtensionSettings>>([
            NCW_STORAGE_KEYS.SETTINGS,
        ]);
        if (res?.[NCW_STORAGE_KEYS.SETTINGS]) {
            this.updateFromSettings(res[NCW_STORAGE_KEYS.SETTINGS]);
        }
    }

    async updateFromSettings(
        settings: Partial<ExtensionSettings>,
    ): Promise<void> {
        if (!settings) return;

        const newProvider = settings.aiProvider
            ? this.resolveProvider(settings.aiProvider)
            : this.activeProvider;
        const { translatorModel: newTransModel, supervisorModel: newSupModel } =
            this.resolveModels(newProvider, settings);
        const newEnableSupervisor =
            settings.enableSupervisor !== undefined
                ? settings.enableSupervisor
                : this.enableSupervisor;

        const newVocabProvider = this.resolveVocabProvider(
            settings.vocabExtractorProvider,
        );
        const newVocabModel = this.resolveVocabModel(
            newVocabProvider,
            settings,
        );

        if (settings.openrouterApiKey !== undefined) {
            this.openrouterApiKey = settings.openrouterApiKey;
        }
        if (settings.ollamaHost !== undefined) {
            if (settings.ollamaHost !== this.ollamaHost) {
                this.ollamaAliveCache = null;
            }
            this.ollamaHost = settings.ollamaHost;
        }

        const providerChanged = newProvider !== this.activeProvider;
        const transModelChanged = newTransModel !== this.translatorModel;
        const supModelChanged = newSupModel !== this.supervisorModel;

        const vocabProviderChanged = newVocabProvider !== this.vocabProvider;
        const vocabModelChanged = newVocabModel !== this.vocabModel;

        this.activeProvider = newProvider;
        this.translatorModel = newTransModel;
        this.supervisorModel = newSupModel;
        this.enableSupervisor = newEnableSupervisor;

        this.vocabProvider = newVocabProvider;
        this.vocabModel = newVocabModel;

        if (providerChanged || transModelChanged || !this.translatorClient) {
            this.translatorClient = await LlmClientFactory.getOrCreateClient(
                this.activeProvider,
                'translator',
                this.translatorModel,
            );
        }

        if (providerChanged || supModelChanged || !this.supervisorClient) {
            this.supervisorClient = await LlmClientFactory.getOrCreateClient(
                this.activeProvider,
                'supervisor',
                this.supervisorModel,
            );
        }

        if (vocabProviderChanged || vocabModelChanged || !this.vocabClient) {
            this.vocabClient = await LlmClientFactory.getOrCreateClient(
                this.vocabProvider,
                'vocab',
                this.vocabModel,
            );
        }
    }

    getActiveProvider(): LLMProvider {
        return this.activeProvider;
    }

    async getClient(role: LlmRole): Promise<ILlmClient> {
        if (role === 'vocab') {
            if (!this.vocabClient) {
                this.vocabClient = await LlmClientFactory.getOrCreateClient(
                    this.vocabProvider,
                    'vocab',
                    this.vocabModel,
                );
            }
            return this.vocabClient;
        }

        if (role === 'supervisor') {
            if (!this.supervisorClient) {
                this.supervisorClient =
                    await LlmClientFactory.getOrCreateClient(
                        this.activeProvider,
                        'supervisor',
                        this.supervisorModel,
                    );
            }
            return this.supervisorClient;
        }

        if (!this.translatorClient) {
            this.translatorClient = await LlmClientFactory.getOrCreateClient(
                this.activeProvider,
                'translator',
                this.translatorModel,
            );
        }
        return this.translatorClient;
    }

    getVocabProvider(): LLMProvider {
        return this.vocabProvider;
    }

    getVocabModel(): string {
        return this.vocabModel;
    }

    async pingOllama(timeoutMs = 600): Promise<boolean> {
        const now = Date.now();
        if (
            this.ollamaAliveCache &&
            now - this.ollamaAliveCache.timestamp < LlmService.OLLAMA_CACHE_TTL_MS
        ) {
            return this.ollamaAliveCache.alive;
        }

        try {
            const host = (this.ollamaHost || 'http://localhost:11434').replace(
                /\/+$/,
                '',
            );
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            const res = await fetch(`${host}/api/tags`, {
                method: 'GET',
                signal: controller.signal,
            });
            clearTimeout(timer);

            const alive = res.ok;
            this.ollamaAliveCache = { alive, timestamp: now };
            return alive;
        } catch {
            this.ollamaAliveCache = { alive: false, timestamp: now };
            return false;
        }
    }

    async isVocabActive(): Promise<boolean> {
        if (!this.vocabModel) return false;

        if (this.vocabProvider === 'openrouter') {
            return Boolean(
                this.openrouterApiKey && this.openrouterApiKey.trim().length > 0,
            );
        }

        if (this.vocabProvider === 'ollama') {
            return await this.pingOllama();
        }

        return false;
    }

    async callChat(role: LlmRole, params: LlmRoleChatParams): Promise<string> {
        const client = await this.getClient(role);
        return await client.chat({
            messages: params.messages,
            temperature: params.temperature,
            jsonMode: params.jsonMode,
            signal: params.signal,
        });
    }

    async isSupervisorActive(): Promise<boolean> {
        if (!this.enableSupervisor || !this.supervisorModel) return false;

        if (this.activeProvider === 'openrouter') {
            return Boolean(
                this.openrouterApiKey && this.openrouterApiKey.trim().length > 0,
            );
        }

        if (this.activeProvider === 'ollama') {
            return await this.pingOllama();
        }

        return false;
    }

    async isTranslatorActive(): Promise<boolean> {
        if (!this.translatorModel) return false;

        if (this.activeProvider === 'openrouter') {
            return Boolean(
                this.openrouterApiKey && this.openrouterApiKey.trim().length > 0,
            );
        }

        if (this.activeProvider === 'ollama') {
            return await this.pingOllama();
        }

        return false;
    }

    async getAiCapability(role?: LlmRole): Promise<AiCapability> {
        // If specific role requested, query that client directly
        if (role) {
            const client = await this.getClient(role);
            return await client.getCapability();
        }

        // Default resolution order: supervisor if enabled, otherwise translator
        if (this.enableSupervisor) {
            const client = await this.getClient('supervisor');
            const supCap = await client.getCapability();
            if (supCap.hasAi) {
                return supCap;
            }
        }

        const client = await this.getClient('translator');
        return await client.getCapability();
    }

    // --- Utility & Connection Check methods for popup/options presentation ---

    async checkOllamaConnection(): Promise<{ models: string[] }> {
        const client = new OllamaClient(
            'translator',
            this.translatorModel,
            this.storage,
        );
        await client.init();
        const res = await client.checkConnection();
        return { models: res.models || [] };
    }

    async fetchOpenRouterModels(
        forceRefresh: boolean = false,
    ): Promise<OpenRouterModelItem[]> {
        const client = new OpenRouterClient(
            'translator',
            this.translatorModel,
            this.storage,
        );
        await client.init();
        return await client.fetchModels(forceRefresh);
    }

    async checkOpenRouterConnection(): Promise<{
        keyInfo: Record<string, unknown>;
        models: OpenRouterModelItem[];
    }> {
        const client = new OpenRouterClient(
            'translator',
            this.translatorModel,
            this.storage,
        );
        await client.init();
        const res = await client.checkConnection();
        const models = await client.fetchModels(true);

        return {
            keyInfo: res.keyInfo || {},
            models,
        };
    }
}
