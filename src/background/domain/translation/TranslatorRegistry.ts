import { ITranslatorService } from './ITranslatorService';
import { GoogleTranslatorService } from '../../infrastructure/translation/GoogleTranslatorService';
import { LlmTranslatorService } from '../../infrastructure/translation/LlmTranslatorService';
import { TranslationProvider } from '@shared/domain/entities/PipelineTypes';

export class TranslatorRegistry {
    private static services: Map<TranslationProvider, ITranslatorService> =
        new Map();

    private static initialized: boolean = false;

    static async initialize(): Promise<void> {
        if (this.initialized) return;

        if (this.services.size > 0) return;
        const googleTranslatorService = new GoogleTranslatorService();
        await googleTranslatorService.init();
        this.register(googleTranslatorService);
        const ollamaTranslatorService = new LlmTranslatorService('ollama');
        await ollamaTranslatorService.init();
        this.register(ollamaTranslatorService);
        const openRouterTranslatorService = new LlmTranslatorService(
            'openrouter',
        );
        await openRouterTranslatorService.init();
        this.register(openRouterTranslatorService);
        const openAiTranslatorService = new LlmTranslatorService('openai');
        await openAiTranslatorService.init();
        this.register(openAiTranslatorService);

        this.initialized = true;
    }

    static register(service: ITranslatorService): void {
        this.services.set(service.providerId, service);
    }

    static async getTranslator(
        providerId: TranslationProvider = 'google',
    ): Promise<ITranslatorService> {
        await this.initialize();
        const service = this.services.get(providerId);
        if (service) {
            return service;
        }
        // Default fallback to google
        if (this.services.has('google')) {
            return this.services.get('google')!;
        }
        const fallback = new GoogleTranslatorService();
        await fallback.init();
        return fallback;
    }
}
