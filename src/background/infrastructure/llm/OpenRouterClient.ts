import {
    ILlmClient,
    LlmChatRequest,
    LlmConnectionTestResult,
} from '../../domain/llm/ILlmClient';
import { LlmRole, AiCapability } from '../../domain/llm/LlmRole';
import { LLMProvider } from '@shared/domain/entities/PipelineTypes';
import { OpenRouterModelItem } from '@shared/types/Messages';
import {
    DEFAULT_SETTINGS,
    ExtensionSettings,
} from '@shared/domain/constants/SettingsDefaults';
import { NCW_STORAGE_KEYS } from '@shared/domain/constants/StorageKeys';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { IBrowserStorage } from '@shared/infrastructure/storage/IBrowserStorage';
import { Logger } from '@shared/utils/logger';
import { CredentialVaultService } from '../../application/services/CredentialVaultService';

export class OpenRouterClient implements ILlmClient {
    readonly providerId: LLMProvider = 'openrouter';
    readonly role: LlmRole;
    readonly model: string;

    private apiKey: string = DEFAULT_SETTINGS.openrouterApiKey;
    private baseUrl: string = DEFAULT_SETTINGS.openrouterBaseUrl;
    private storage: IBrowserStorage;

    private openRouterModelsCache: OpenRouterModelItem[] | null = null;
    private openRouterModelsCacheTime: number = 0;

    private logger: Logger = new Logger('OpenRouterClient');

    constructor(
        role: LlmRole,
        model: string,
        storage: IBrowserStorage = BrowserStorageFactory.getStorage(),
    ) {
        this.logger.info('LLM', `new openrouter client with role: ${role}`);

        this.role = role;
        this.model = model;
        this.storage = storage;
    }

    async init(): Promise<void> {
        await this.initFromStorage();

        this.storage.onChanged((changes) => {
            if (changes[NCW_STORAGE_KEYS.SETTINGS]?.newValue) {
                const settings = changes[NCW_STORAGE_KEYS.SETTINGS]
                    .newValue as Partial<ExtensionSettings>;
                if (settings.openrouterApiKey !== undefined) {
                    this.apiKey = settings.openrouterApiKey;
                }
                if (settings.openrouterBaseUrl !== undefined) {
                    this.baseUrl = settings.openrouterBaseUrl;
                }
            }
        });
    }

    private async initFromStorage(): Promise<void> {
        const res = await this.storage.get<Partial<ExtensionSettings>>([
            NCW_STORAGE_KEYS.SETTINGS,
        ]);
        const settings = res?.[NCW_STORAGE_KEYS.SETTINGS];
        if (settings) {
            if (settings.openrouterApiKey !== undefined) {
                this.apiKey = settings.openrouterApiKey;
            }
            if (settings.openrouterBaseUrl !== undefined) {
                this.baseUrl = settings.openrouterBaseUrl;
            }
        }
    }

    private async getActiveApiKey(
        promptIfLocked: boolean = true,
    ): Promise<string> {
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
        return (this.apiKey || '').trim();
    }

    async getCapability(): Promise<AiCapability> {
        const isSupervisor = this.role === 'supervisor';
        const vaultStatus = CredentialVaultService.getInstance().getStatus();
        const hasKey =
            vaultStatus.hasKey ||
            Boolean(this.apiKey && this.apiKey.trim().length > 0);
        return {
            hasAi: hasKey,
            provider: 'openrouter',
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
            throw new Error(
                'OpenRouter API Key is missing. Please configure your API key in extension settings.',
            );
        }
        const baseUrl = (
            this.baseUrl || 'https://openrouter.ai/api/v1'
        ).replace(/\/+$/, '');
        const modelToUse = model || this.model || 'deepseek/deepseek-chat';

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
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'HTTP-Referer':
                    'https://github.com/cowatcher-app/cowatcher-extension',
                'X-Title': 'CoWatcher Translator',
            },
            body: JSON.stringify(payload),
            signal,
        });

        if (!response.ok) {
            let errMsg = `OpenRouter error (${response.status})`;
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
            // Locked or unconfigured - proceed with unauthenticated model list request
        }
        const base = this.baseUrl;
        const now = Date.now();

        if (
            !forceRefresh &&
            this.openRouterModelsCache &&
            now - this.openRouterModelsCacheTime < 3600000
        ) {
            return this.openRouterModelsCache;
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'HTTP-Referer':
                'https://github.com/cowatcher-app/cowatcher-extension',
            'X-Title': 'CoWatcher Translator',
        };
        if (key && key.trim()) {
            headers['Authorization'] = `Bearer ${key.trim()}`;
        }

        const res = await fetch(`${base}/models`, { method: 'GET', headers });
        if (!res.ok) {
            throw new Error(
                `Failed to fetch OpenRouter models (${res.status}): ${await res.text()}`,
            );
        }

        const json = await res.json();
        const rawList = Array.isArray(json.data) ? json.data : [];

        interface RawOpenRouterModel {
            id: string;
            name?: string;
            context_length?: number;
            pricing?: {
                prompt?: string;
                completion?: string;
            };
        }

        const models: OpenRouterModelItem[] = (
            rawList as RawOpenRouterModel[]
        ).map((m) => ({
            id: m.id,
            name: m.name || m.id,
            contextLength: m.context_length || 0,
            promptPrice: m.pricing?.prompt ? parseFloat(m.pricing.prompt) : 0,
            completionPrice: m.pricing?.completion
                ? parseFloat(m.pricing.completion)
                : 0,
        }));

        models.sort((a, b) => a.name.localeCompare(b.name));
        this.openRouterModelsCache = models;
        this.openRouterModelsCacheTime = now;
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
            throw new Error(
                'API Key is required to test OpenRouter connection.',
            );
        }

        const base = this.baseUrl;
        const authRes = await fetch(`${base}/auth/key`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${key}`,
                'HTTP-Referer':
                    'https://github.com/cowatcher-app/cowatcher-extension',
                'X-Title': 'CoWatcher Translator',
            },
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
}
