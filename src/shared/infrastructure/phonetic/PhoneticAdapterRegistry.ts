import {
    IDictionaryAdapter,
    normalizeLanguageCode,
} from '../../domain/phonetic/IPhoneticAdapter';
import { Logger } from '../../utils/logger';

/**
 * Registry managing language-specific phonetic adapters.
 * Enables zero-coupling extensible registration of phonetic engines (e.g. Japanese Furigana, Chinese Pinyin).
 */
export class PhoneticAdapterRegistry {
    private readonly adapters = new Map<string, IDictionaryAdapter>();
    private readonly logger = new Logger('PhoneticAdapterRegistry');

    /**
     * Registers a concrete phonetic adapter for its declared languageCode.
     */
    register(adapter: IDictionaryAdapter): void {
        const canonicalCode = normalizeLanguageCode(adapter.languageCode);
        this.adapters.set(canonicalCode, adapter);
        this.logger.info(
            'Register',
            `Registered phonetic adapter "${adapter.displayName}" for language code: "${canonicalCode}"`,
        );
    }

    /**
     * Retrieves the phonetic adapter registered for the given language code.
     */
    getAdapter(
        lang: string | undefined | null,
    ): IDictionaryAdapter | undefined {
        const canonicalCode = normalizeLanguageCode(lang);
        return this.adapters.get(canonicalCode);
    }

    /**
     * Checks if a phonetic adapter exists for the given language code.
     */
    hasAdapter(lang: string | undefined | null): boolean {
        const canonicalCode = normalizeLanguageCode(lang);
        return this.adapters.has(canonicalCode);
    }

    /**
     * Returns list of canonical language codes currently supported.
     */
    getSupportedLanguages(): string[] {
        return Array.from(this.adapters.keys());
    }
}
