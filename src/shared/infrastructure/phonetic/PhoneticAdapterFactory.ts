import { PhoneticAdapterRegistry } from './PhoneticAdapterRegistry';
import { JapanesePhoneticAdapter } from './adapters/JapanesePhoneticAdapter';
import { ChinesePhoneticAdapter } from './adapters/ChinesePhoneticAdapter';
import { KoreanPhoneticAdapter } from './adapters/KoreanPhoneticAdapter';
import { SpanishPhoneticAdapter } from './adapters/SpanishPhoneticAdapter';
import { EnglishPhoneticAdapter } from './adapters/EnglishPhoneticAdapter';
import { GeneralDictionaryAdapter } from './adapters/GeneralDictionaryAdapter';
import { IDictionaryAdapter } from '../../domain/phonetic/IPhoneticAdapter';

export class PhoneticAdapterFactory {
    private static defaultRegistry: PhoneticAdapterRegistry | null = null;

    /**
     * Returns the singleton shared PhoneticAdapterRegistry pre-populated with standard adapters.
     */
    static getDefaultRegistry(): PhoneticAdapterRegistry {
        if (!PhoneticAdapterFactory.defaultRegistry) {
            const registry = new PhoneticAdapterRegistry();
            registry.register(new JapanesePhoneticAdapter());
            registry.register(new ChinesePhoneticAdapter());
            registry.register(new KoreanPhoneticAdapter());
            registry.register(new SpanishPhoneticAdapter());
            registry.register(new EnglishPhoneticAdapter());
            registry.register(new GeneralDictionaryAdapter());
            PhoneticAdapterFactory.defaultRegistry = registry;
        }
        return PhoneticAdapterFactory.defaultRegistry;
    }

    /**
     * Convenience method to fetch an adapter for a given language code from the default registry.
     */
    static getAdapter(
        lang: string | undefined | null,
    ): IDictionaryAdapter | undefined {
        return PhoneticAdapterFactory.getDefaultRegistry().getAdapter(lang);
    }
}
