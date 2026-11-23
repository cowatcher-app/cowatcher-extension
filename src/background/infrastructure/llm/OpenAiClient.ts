import {
    ILlmClient,
    LlmChatRequest,
    LlmConnectionTestResult,
} from '../../domain/llm/ILlmClient';
import { LlmRole, AiCapability } from '../../domain/llm/LlmRole';
import { OpenRouterModelItem } from '@shared/types/Messages';
import {
    DEFAULT_SETTINGS,
    ExtensionSettings,
} from '@shared/domain/constants/SettingsDefaults';
import { NCW_STORAGE_KEYS } from '@shared/domain/constants/StorageKeys';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { IBrowserStorage } from '@shared/infrastructure/storage/IBrowserStorage';
import { CredentialVaultService } from '../../application/services/CredentialVaultService';

export type OpenAiCompatibleProviderId = 'openrouter' | 'openai';

/**
 * Unified OpenAI Chat Completions API client supporting both OpenRouter and any
 * OpenAI-compatible endpoint (OpenAI, DeepSeek, Groq, OneAPI, vLLM, etc.).
 */
export class OpenAiClient implements ILlmClient {
    readonly providerId: OpenAiCompatibleProviderId;
    readonly role: LlmRole;
    readonly model: string;

    private apiKey: string;
    private baseUrl: string;
    private readonly defaultBaseUrl: string;
    private storage: IBrowserStorage;

    private modelsCache: OpenRouterModelItem[] | null = null;
    private modelsCacheTime: number = 0;

    constructor(
        role: LlmRole,
        model: string,
        providerId: OpenAiCompatibleProviderId = 'openrouter',
        defaultBaseUrl?: string,
        storage: IBrowserStorage = BrowserStorageFactory.getStorage(),
    ) {
        this.providerId = providerId;
        this.role = role;
        this.model = model;
        this.storage = storage;

        this.defaultBaseUrl =
            defaultBaseUrl ||
            (providerId === 'openrouter'
                ? DEFAULT_SETTINGS.openrouterBaseUrl
                : DEFAULT_SETTINGS.openaiBaseUrl);
        this.baseUrl = this.defaultBaseUrl;
        this.apiKey =
            providerId === 'openrouter'
                ? DEFAULT_SETTINGS.openrouterApiKey
                : DEFAULT_SETTINGS.openaiApiKey;
    }

    async init(): Promise<void> {
        await this.initFromStorage();

        this.storage.onChanged((changes) => {
            if (changes[NCW_STORAGE_KEYS.SETTINGS]?.newValue) {
                const settings = changes[NCW_STORAGE_KEYS.SETTINGS]
                    .newValue as Partial<ExtensionSettings>;
                this.applySettings(settings);
            }
        });
    }

    private applySettings(settings: Partial<ExtensionSettings>): void {
        if (this.providerId === 'openrouter') {
            if (settings.openrouterApiKey !== undefined) {
                this.apiKey = settings.openrouterApiKey;
            }
            if (settings.openrouterBaseUrl !== undefined) {
                this.baseUrl =
                    settings.openrouterBaseUrl || this.defaultBaseUrl;
            }
        } else {
            if (settings.openaiApiKey !== undefined) {
                this.apiKey = settings.openaiApiKey;
            }
            if (settings.openaiBaseUrl !== undefined) {
                this.baseUrl = settings.openaiBaseUrl || this.defaultBaseUrl;
            }
        }
    }

    private async initFromStorage(): Promise<void> {
        const res = await this.storage.get<Partial<ExtensionSettings>>([
            NCW_STORAGE_KEYS.SETTINGS,
        ]);
        const settings = res?.[NCW_STORAGE_KEYS.SETTINGS];
        if (settings) {
            this.applySettings(settings);
        }
    }

    private async getActiveApiKey(
        promptIfLocked: boolean = true,
    ): Promise<string> {
        if (this.providerId === 'openrouter') {
            try {
                const vaultKey =
                    await CredentialVaultService.getInstance().getApiKey(
                        promptIfLocked,
                    );
                if (vaultKey) return vaultKey;
            } catch (err: unknown) {
                if ((err as Error)?.message === 'CREDENTIAL_VAULT_LOCKED') {
                    throw new Error('CREDENTIAL_VAULT_LOCKED', { cause: err });
                }
                throw err;
            }
        }
        return (this.apiKey || '').trim();
    }

    private buildHeaders(apiKey?: string): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (apiKey && apiKey.trim()) {
            headers['Authorization'] = `Bearer ${apiKey.trim()}`;
        }
        if (this.providerId === 'openrouter') {
            headers['HTTP-Referer'] =
                'https://github.com/cowatcher-app/cowatcher-extension';
            headers['X-Title'] = 'CoWatcher Translator';
        }
        return headers;
    }

    async getCapability(): Promise<AiCapability> {
        const isSupervisor = this.role === 'supervisor';
        const vaultStatus =
            this.providerId === 'openrouter'
                ? CredentialVaultService.getInstance().getStatus()
                : { hasKey: false };
        const hasKey =
            vaultStatus.hasKey ||
            Boolean(this.apiKey && this.apiKey.trim().length > 0);
        return {
            hasAi: hasKey,
            provider: this.providerId,
            model: this.model,
            isSupervisor,
        };
    }

    async chat(
        request: Omit<LlmChatRequest, 'model'> & { model?: string },
    ): Promise<string> {
        const {
            model,
            messages,
            temperature = 0.2,
            jsonMode = false,
            signal,
        } = request;
        let apiKey: string;
        try {
            apiKey = await this.getActiveApiKey();
        } catch (err: unknown) {
            if ((err as Error)?.message === 'CREDENTIAL_VAULT_LOCKED') {
                throw new Error(
                    'OpenRouter API Key is encrypted with Master Password. Please unlock in extension popup or settings.',
                    { cause: err },
                );
            }
            throw err;
        }
        if (!apiKey) {
            const label =
                this.providerId === 'openrouter' ? 'OpenRouter' : 'OpenAI';
            throw new Error(
                `${label} API Key is missing. Please configure your API key in extension settings.`,
            );
        }
        const baseUrl = (this.baseUrl || this.defaultBaseUrl).replace(
            /\/+$/,
            '',
        );
        const defaultModel =
            this.providerId === 'openrouter'
                ? DEFAULT_SETTINGS.openrouterTranslationModel
                : DEFAULT_SETTINGS.openaiTranslationModel;
        const modelToUse = model || this.model || defaultModel;

        const payload: Record<string, unknown> = {
            model: modelToUse,
            messages,
            temperature,
            max_tokens: 4096,
        };
        if (jsonMode) {
            payload.response_format = { type: 'json_object' };
        }

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: this.buildHeaders(apiKey),
            body: JSON.stringify(payload),
            signal,
        });

        if (!response.ok) {
            const label =
                this.providerId === 'openrouter' ? 'OpenRouter' : 'OpenAI';
            let errMsg = `${label} error (${response.status})`;
            try {
                const errJson = await response.json();
                errMsg = errJson.error?.message || errMsg;
            } catch {
                errMsg = await response.text();
            }
            throw new Error(errMsg);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
    }

    async fetchModels(
        forceRefresh: boolean = false,
    ): Promise<OpenRouterModelItem[]> {
        let key = '';
        try {
            key = await this.getActiveApiKey(false);
        } catch {
            // Locked or unconfigured
        }
        const base = (this.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
        const now = Date.now();

        if (
            !forceRefresh &&
            this.modelsCache &&
            now - this.modelsCacheTime < 3600000
        ) {
            return this.modelsCache;
        }

        const res = await fetch(`${base}/models`, {
            method: 'GET',
            headers: this.buildHeaders(key),
        });
        if (!res.ok) {
            throw new Error(
                `Failed to fetch models (${res.status}): ${await res.text()}`,
            );
        }

        const json = await res.json();
        const rawList = Array.isArray(json.data) ? json.data : [];

        interface RawModel {
            id: string;
            name?: string;
            context_length?: number;
            pricing?: {
                prompt?: string;
                completion?: string;
            };
        }

        const models: OpenRouterModelItem[] = (rawList as RawModel[]).map(
            (m) => ({
                id: m.id,
                name: m.name || m.id,
                contextLength: m.context_length || 0,
                promptPrice: m.pricing?.prompt
                    ? parseFloat(m.pricing.prompt)
                    : 0,
                completionPrice: m.pricing?.completion
                    ? parseFloat(m.pricing.completion)
                    : 0,
            }),
        );

        models.sort((a, b) => a.name.localeCompare(b.name));
        this.modelsCache = models;
        this.modelsCacheTime = now;
        return models;
    }

    async checkConnection(): Promise<LlmConnectionTestResult> {
        let key: string;
        try {
            key = await this.getActiveApiKey();
        } catch (err: unknown) {
            if ((err as Error)?.message === 'CREDENTIAL_VAULT_LOCKED') {
                throw new Error(
                    'OpenRouter API Key is encrypted with Master Password. Please unlock in extension popup or settings.',
                    { cause: err },
                );
            }
            throw err;
        }
        if (!key) {
            const label =
                this.providerId === 'openrouter' ? 'OpenRouter' : 'OpenAI';
            throw new Error(
                `API Key is required to test ${label} connection.`,
            );
        }

        const base = (this.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');

        if (this.providerId === 'openrouter') {
            const authRes = await fetch(`${base}/auth/key`, {
                method: 'GET',
                headers: this.buildHeaders(key),
            });

            if (!authRes.ok) {
                if (authRes.status === 401) {
                    throw new Error(
                        'Invalid OpenRouter API Key (401 Unauthorized)',
                    );
                }
                const errText = await authRes.text();
                throw new Error(
                    `OpenRouter auth check failed (${authRes.status}): ${errText}`,
                );
            }

            const keyData = await authRes.json();
            const modelItems = await this.fetchModels(true);

            return {
                ok: true,
                keyInfo: (keyData.data || {}) as Record<string, unknown>,
                models: modelItems.map((m) => m.id),
            };
        }

        const modelItems = await this.fetchModels(true);
        return {
            ok: true,
            models: modelItems.map((m) => m.id),
        };
    }
}
