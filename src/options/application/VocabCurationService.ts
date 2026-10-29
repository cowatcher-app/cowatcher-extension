import {
    EpisodeVocabData,
    VocabWordItem,
} from '@shared/domain/entities/Vocabulary';
import { OptionsMessageService } from './OptionsMessageService';
import { IBrowserStorage } from '@shared/infrastructure/storage/IBrowserStorage';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { NCW_STORAGE_KEYS } from '@shared/domain/constants/StorageKeys';
import {
    VocabCurationSession,
    CuratedVocabWord,
} from './VocabCurationSession';
import { FieldLockConfig, CurationFieldKey } from './VocabFieldLock';

const CUSTOM_PROMPT_STORAGE_KEY = 'ncw_curation_custom_prompt';
const FIELD_LOCKS_STORAGE_KEY = 'ncw_curation_field_locks';

/**
 * Strips session-internal metadata from a word item before persisting to domain storage.
 */
function toCleanVocabWord(item: CuratedVocabWord): VocabWordItem {
    return {
        word: item.word,
        pos: item.pos,
        phonetic: item.phonetic,
        meaning: item.meaning,
        sentence: item.sentence,
        sentenceTranslation: item.sentenceTranslation,
        timestamp: item.timestamp,
        frequency: item.frequency,
        source: item.source,
        createdAt: item.createdAt,
        sourceLang: item.sourceLang,
        targetLang: item.targetLang,
    };
}

/**
 * Application service coordinating vocabulary curation, language snapshot resolution,
 * supervisor-model enrichment with custom prompt injection, and storage persistence.
 */
export class VocabCurationService {
    constructor(
        private readonly messageService: OptionsMessageService = OptionsMessageService.getInstance(),
        private readonly storage: IBrowserStorage = BrowserStorageFactory.getStorage(),
    ) {}

    /**
     * Resolves the immutable language snapshot for a word, falling back to the episode/session snapshot.
     */
    resolveWordLanguages(
        word: VocabWordItem,
        context?: { sourceLanguage?: string; targetLanguage?: string },
    ): { sourceLang: string; targetLang: string } {
        return {
            sourceLang: word.sourceLang || context?.sourceLanguage || 'ja',
            targetLang: word.targetLang || context?.targetLanguage || 'zh-CN',
        };
    }

    /**
     * Enriches a single vocabulary item using the supervisor model (with fallback to translator model),
     * incorporating any user-injected custom prompt instructions, and respecting locked column fields.
     */
    async enrichWord(
        word: VocabWordItem,
        context?: { sourceLanguage?: string; targetLanguage?: string },
        customPrompt?: string,
        lockConfig?: FieldLockConfig,
    ): Promise<VocabWordItem> {
        const { sourceLang, targetLang } = this.resolveWordLanguages(
            word,
            context,
        );

        const res = await this.messageService.lookupWordDefinition({
            word: word.word,
            contextSentence: word.sentence,
            contextTranslation: word.sentenceTranslation,
            sourceLang,
            targetLang,
            customPrompt: customPrompt?.trim() || undefined,
            preferredRole: 'supervisor',
        });

        if (!res) {
            return word;
        }

        const isLocked = (field: CurationFieldKey): boolean =>
            lockConfig ? lockConfig.isLocked(field) : false;

        return {
            ...word,
            pos: isLocked('pos') ? word.pos : res.pos || word.pos,
            phonetic: isLocked('phonetic')
                ? word.phonetic
                : res.reading || word.phonetic,
            meaning: isLocked('meaning')
                ? word.meaning
                : res.meaning || word.meaning,
            sentence: isLocked('sentence')
                ? word.sentence
                : res.exampleSentence || word.sentence,
            sentenceTranslation: isLocked('sentenceTranslation')
                ? word.sentenceTranslation
                : res.exampleTranslation || word.sentenceTranslation,
            sourceLang,
            targetLang,
        };
    }

    /**
     * Persists the curated words list back to browser storage across all episodes in the session.
     * When session.isPartialFilter is true (e.g. user-marked curation), preserves non-filter words in each episode.
     */
    async saveCuratedSession(
        session: VocabCurationSession,
        curatedWords: CuratedVocabWord[],
    ): Promise<void> {
        if (!session.episodes || session.episodes.length === 0) return;

        const wordsByMovieId = new Map<string, CuratedVocabWord[]>();
        session.episodes.forEach((ep) => {
            wordsByMovieId.set(ep.movieId, []);
        });

        const fallbackMovieId = session.episodes[0].movieId;
        curatedWords.forEach((w) => {
            const targetId = w.originEpisodeId || fallbackMovieId;
            const list = wordsByMovieId.get(targetId);
            if (list) {
                list.push(w);
            } else {
                wordsByMovieId.set(targetId, [w]);
            }
        });

        const storageUpdates: Record<string, EpisodeVocabData> = {};

        for (const ep of session.episodes) {
            const remainingCuratedWords = wordsByMovieId.get(ep.movieId) || [];

            let finalEpisodeWords: VocabWordItem[];
            if (session.isPartialFilter) {
                // Keep words that were outside the partial filter view (e.g. AI words when editing starred words)
                const nonFilterWords = ep.words.filter(
                    (w) => w.source !== 'user',
                );
                finalEpisodeWords = [
                    ...nonFilterWords,
                    ...remainingCuratedWords.map(toCleanVocabWord),
                ];
            } else {
                finalEpisodeWords = remainingCuratedWords.map(toCleanVocabWord);
            }

            const storageKey = `${NCW_STORAGE_KEYS.VOCAB_PREFIX}${ep.movieId}`;
            storageUpdates[storageKey] = {
                ...ep,
                updatedAt: Date.now(),
                totalWords: finalEpisodeWords.length,
                words: finalEpisodeWords,
            };
        }

        await this.storage.set(storageUpdates);
    }

    /**
     * Persists the curated words list back to browser storage for a single episode.
     */
    async saveCuratedEpisode(
        movieId: string,
        episode: EpisodeVocabData,
        words: VocabWordItem[],
    ): Promise<void> {
        const ep =
            episode.movieId === movieId ? episode : { ...episode, movieId };
        const session = VocabCurationSession.fromSingleEpisode(ep);
        await this.saveCuratedSession(session, words);
    }

    /**
     * Loads the last-used custom prompt template from storage.
     */
    async getSavedCustomPrompt(): Promise<string> {
        try {
            const data = await this.storage.get<string>(
                CUSTOM_PROMPT_STORAGE_KEY,
            );
            return (data && data[CUSTOM_PROMPT_STORAGE_KEY]) || '';
        } catch {
            return '';
        }
    }

    /**
     * Saves the custom prompt template to storage for reuse.
     */
    async saveCustomPrompt(prompt: string): Promise<void> {
        try {
            await this.storage.set({ [CUSTOM_PROMPT_STORAGE_KEY]: prompt });
        } catch {
            // Ignore storage errors
        }
    }

    /**
     * Loads the last-used column lock preferences from storage.
     */
    async getSavedFieldLocks(): Promise<Record<string, boolean>> {
        try {
            const data = await this.storage.get<Record<string, boolean>>(
                FIELD_LOCKS_STORAGE_KEY,
            );
            return (data && data[FIELD_LOCKS_STORAGE_KEY]) || {};
        } catch {
            return {};
        }
    }

    /**
     * Saves the column lock preferences to storage for future sessions.
     */
    async saveFieldLocks(locks: Record<string, boolean>): Promise<void> {
        try {
            await this.storage.set({ [FIELD_LOCKS_STORAGE_KEY]: locks });
        } catch {
            // Ignore storage errors
        }
    }
}
