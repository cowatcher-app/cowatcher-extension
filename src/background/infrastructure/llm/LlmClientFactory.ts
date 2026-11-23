import { ILlmClient } from '../../domain/llm/ILlmClient';
import { LlmRole } from '../../domain/llm/LlmRole';
import { OllamaClient } from './OllamaClient';
import { OpenAiClient } from './OpenAiClient';
import { DEFAULT_SETTINGS } from '@shared/domain/constants/SettingsDefaults';
import { LLMProvider } from '@shared/domain/entities/PipelineTypes';

export class LlmClientFactory {
    private static instances = new Map<string, ILlmClient>();

    static async getOrCreateClient(
        provider: LLMProvider,
        role: LlmRole,
        model: string | null,
    ): Promise<ILlmClient> {
        const modelKey = model ?? 'unknown';
        const key = `${provider}:${role}:${modelKey}`;
        let client = this.instances.get(key);
        if (!client) {
            switch (provider) {
                case 'openrouter':
                    client = new OpenAiClient(
                        role,
                        model ?? '',
                        'openrouter',
                        DEFAULT_SETTINGS.openrouterBaseUrl,
                    );
                    break;
                case 'openai':
                    client = new OpenAiClient(
                        role,
                        model ?? '',
                        'openai',
                        DEFAULT_SETTINGS.openaiBaseUrl,
                    );
                    break;
                case 'ollama':
                    client = new OllamaClient(role, model ?? '');
                    break;
            }
            if (client) {
                await client.init();
                this.instances.set(key, client);
            }
        }
        return client;
    }
}
