import {
    EpisodeVocabData,
    VocabWordItem,
} from '@shared/domain/entities/Vocabulary';

export type VocabExportIntent = 'review' | 'csv' | 'anki';

export interface CuratedVocabWord extends VocabWordItem {
    originEpisodeId?: string;
    originShowTitle?: string;
    audio?: string;
}

export interface VocabCurationSessionOptions {
    title: string;
    subtitle?: string;
    badgeText?: string;
    intent?: VocabExportIntent;
    isPartialFilter?: boolean;
    isImported?: boolean;
    episodes: EpisodeVocabData[];
    words: CuratedVocabWord[];
    onExportCsv?: (words: CuratedVocabWord[]) => void | Promise<void>;
    onExportAnki?: (words: CuratedVocabWord[]) => void | Promise<void>;
    onUpdate?: () => void;
}

/**
 * Domain entity / model representing a vocabulary curation & pre-export confirmation session.
 * Encapsulates the dataset (single or multiple episodes), origin mapping, user intent,
 * and custom export dispatchers.
 */
export class VocabCurationSession {
    readonly title: string;
    readonly subtitle: string;
    readonly badgeText: string;
    readonly intent: VocabExportIntent;
    readonly isPartialFilter: boolean;
    readonly isImported: boolean;
    readonly episodes: readonly EpisodeVocabData[];
    readonly initialWords: readonly CuratedVocabWord[];
    readonly onExportCsv?: (words: CuratedVocabWord[]) => void | Promise<void>;
    readonly onExportAnki?: (words: CuratedVocabWord[]) => void | Promise<void>;
    readonly onUpdate?: () => void;

    constructor(options: VocabCurationSessionOptions) {
        this.title = options.title;
        this.subtitle = options.subtitle || '';
        this.badgeText = options.badgeText || '';
        this.intent = options.intent || 'review';
        this.isPartialFilter = !!options.isPartialFilter;
        this.isImported = !!options.isImported;
        this.episodes = [...options.episodes];
        this.initialWords = options.words.map((w) => ({ ...w }));
        this.onExportCsv = options.onExportCsv;
        this.onExportAnki = options.onExportAnki;
        this.onUpdate = options.onUpdate;
    }

    get primaryEpisode(): EpisodeVocabData | undefined {
        return this.episodes[0];
    }

    get sourceLanguage(): string {
        return this.primaryEpisode?.sourceLanguage || 'ja';
    }

    findEpisodeForWord(word: CuratedVocabWord): EpisodeVocabData | undefined {
        if (word.originEpisodeId) {
            return this.episodes.find((e) => e.movieId === word.originEpisodeId);
        }
        return this.primaryEpisode;
    }

    /**
     * Factory for creating a curation session for a single episode.
     */
    static fromSingleEpisode(
        episode: EpisodeVocabData,
        options?: {
            intent?: VocabExportIntent;
            onUpdate?: () => void;
            onExportCsv?: (words: CuratedVocabWord[]) => void | Promise<void>;
            onExportAnki?: (words: CuratedVocabWord[]) => void | Promise<void>;
        },
    ): VocabCurationSession {
        const intent = options?.intent || 'review';
        const src = episode.sourceLanguage || 'ja';
        const tgt = episode.targetLanguage || 'zh-CN';

        let subtitle = `Collected with difficulty [${episode.difficulty || 'normal'}]. Edit, delete, or enrich definitions using the supervisor model.`;
        let badge = `Snapshot: ${src} ➔ ${tgt}`;

        if (intent === 'csv') {
            subtitle =
                'Pre-export verification: review words, edit definitions, or remove entries before downloading CSV.';
            badge = `Export Confirmation · CSV · ${src} ➔ ${tgt}`;
        } else if (intent === 'anki') {
            subtitle =
                'Pre-export verification: check definitions and examples before exporting to Anki.';
            badge = `Export Confirmation · Anki · ${src} ➔ ${tgt}`;
        }

        const words: CuratedVocabWord[] = episode.words.map((w) => ({
            ...w,
            originEpisodeId: episode.movieId,
            originShowTitle: episode.showTitle,
        }));

        return new VocabCurationSession({
            title: `${episode.showTitle || 'Episode'} (${episode.movieId})`,
            subtitle,
            badgeText: badge,
            intent,
            isPartialFilter: false,
            episodes: [episode],
            words,
            onExportCsv: options?.onExportCsv,
            onExportAnki: options?.onExportAnki,
            onUpdate: options?.onUpdate,
        });
    }

    /**
     * Factory for creating a curation session across multiple episodes (e.g. show group or selected episodes).
     */
    static fromMultipleEpisodes(
        episodes: EpisodeVocabData[],
        options: {
            title: string;
            subtitle?: string;
            badgeText?: string;
            intent?: VocabExportIntent;
            onUpdate?: () => void;
            onExportCsv?: (words: CuratedVocabWord[]) => void | Promise<void>;
            onExportAnki?: (words: CuratedVocabWord[]) => void | Promise<void>;
        },
    ): VocabCurationSession {
        const words: CuratedVocabWord[] = [];
        episodes.forEach((ep) => {
            ep.words.forEach((w) => {
                words.push({
                    ...w,
                    originEpisodeId: ep.movieId,
                    originShowTitle: ep.showTitle,
                });
            });
        });

        const intent = options.intent || 'review';
        let defaultSubtitle = `Aggregated vocabulary from ${episodes.length} episodes. Review, refine with AI, and edit before exporting.`;
        if (intent === 'csv') {
            defaultSubtitle = `Aggregated ${words.length} words from ${episodes.length} episodes. Review before clicking "Download CSV".`;
        } else if (intent === 'anki') {
            defaultSubtitle = `Aggregated ${words.length} words from ${episodes.length} episodes. Review definitions before clicking "Export to Anki".`;
        }

        const badge =
            options.badgeText ||
            `${episodes.length} Episodes · ${words.length} Words`;

        return new VocabCurationSession({
            title: options.title,
            subtitle: options.subtitle || defaultSubtitle,
            badgeText: badge,
            intent,
            isPartialFilter: false,
            episodes,
            words,
            onExportCsv: options.onExportCsv,
            onExportAnki: options.onExportAnki,
            onUpdate: options.onUpdate,
        });
    }

    /**
     * Factory for creating a curation session specifically for user-marked (starred) vocabulary.
     */
    static fromUserMarked(
        episodes: EpisodeVocabData[],
        options?: {
            intent?: VocabExportIntent;
            onUpdate?: () => void;
            onExportCsv?: (words: CuratedVocabWord[]) => void | Promise<void>;
            onExportAnki?: (words: CuratedVocabWord[]) => void | Promise<void>;
        },
    ): VocabCurationSession {
        const words: CuratedVocabWord[] = [];
        episodes.forEach((ep) => {
            ep.words.forEach((w) => {
                if (w.source === 'user') {
                    words.push({
                        ...w,
                        originEpisodeId: ep.movieId,
                        originShowTitle: ep.showTitle,
                    });
                }
            });
        });

        const intent = options?.intent || 'csv';
        const subtitle =
            'Aggregated all user-starred vocabulary. Review definitions or remove entries before exporting.';
        const badgeText = `⭐ Starred Words · ${words.length} words`;

        return new VocabCurationSession({
            title: '⭐ Starred Vocabulary Export Confirmation',
            subtitle,
            badgeText,
            intent,
            isPartialFilter: true, // Only user words are curated; preserve non-user words on save
            episodes,
            words,
            onExportCsv: options?.onExportCsv,
            onExportAnki: options?.onExportAnki,
            onUpdate: options?.onUpdate,
        });
    }

    /**
     * Factory for creating a transient curation session from an imported external CSV.
     * Marked as isImported=true so changes cannot be written back to local episode storage.
     */
    static fromImportedCsv(
        words: CuratedVocabWord[],
        options?: {
            title?: string;
            sourceLang?: string;
            targetLang?: string;
            intent?: VocabExportIntent;
            onExportCsv?: (words: CuratedVocabWord[]) => void | Promise<void>;
            onExportAnki?: (words: CuratedVocabWord[]) => void | Promise<void>;
        },
    ): VocabCurationSession {
        const src = options?.sourceLang || 'ja';
        const tgt = options?.targetLang || 'zh-CN';
        const dummyEpisode: EpisodeVocabData = {
            movieId: 'imported_csv',
            showTitle: 'External CSV Import',
            sourceLanguage: src,
            targetLanguage: tgt,
            difficulty: 'normal',
            customPrompt: '',
            model: 'imported',
            updatedAt: Date.now(),
            totalWords: words.length,
            words: words,
        };

        return new VocabCurationSession({
            title: options?.title || 'External CSV Import · Staging & Export Mode',
            subtitle:
                'Imported external vocabulary. You can use [✨ AI Polish / Enrich] to fill missing fields, preview audio, and export. (Changes are not saved to local episode storage)',
            badgeText: `📂 External Import · ${src} ➔ ${tgt}`,
            intent: options?.intent || 'review',
            isPartialFilter: false,
            isImported: true,
            episodes: [dummyEpisode],
            words,
            onExportCsv: options?.onExportCsv,
            onExportAnki: options?.onExportAnki,
        });
    }
}
