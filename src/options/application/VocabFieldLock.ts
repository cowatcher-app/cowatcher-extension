/**
 * Definition and configuration for vocabulary curation fields that can be
 * individually edited, selected, or locked from AI modification.
 */

export type CurationFieldKey =
    | 'lemma'
    | 'meaning'
    | 'phonetic'
    | 'pos'
    | 'sentence'
    | 'sentenceTranslation';

export interface CurationFieldDefinition {
    key: CurationFieldKey;
    label: string;
    description: string;
}

export const CURATION_FIELDS: readonly CurationFieldDefinition[] = [
    {
        key: 'lemma',
        label: 'Lemma (Base Form)',
        description: 'Root lemma or dictionary base form',
    },
    {
        key: 'meaning',
        label: 'Meaning (Definition)',
        description: 'Contextual definition in target language',
    },
    {
        key: 'phonetic',
        label: 'Phonetic (Reading)',
        description: 'Pronunciation, furigana reading, or IPA',
    },
    {
        key: 'pos',
        label: 'POS (Part of Speech)',
        description: 'Grammatical category (e.g. noun, verb, adj)',
    },
    {
        key: 'sentence',
        label: 'Sentence (Context)',
        description: 'Original dialogue line or context sentence',
    },
    {
        key: 'sentenceTranslation',
        label: 'Translation (Sentence)',
        description: 'Target language translation of context sentence',
    },
] as const;

/**
 * Domain value object encapsulating column lock states.
 * Locked fields are protected from AI overwrite during enrichment.
 */
export class FieldLockConfig {
    private readonly locks: Record<CurationFieldKey, boolean>;

    constructor(initialLocks?: Partial<Record<CurationFieldKey, boolean>>) {
        this.locks = {
            lemma: !!initialLocks?.lemma,
            meaning: !!initialLocks?.meaning,
            phonetic: !!initialLocks?.phonetic,
            pos: !!initialLocks?.pos,
            sentence: !!initialLocks?.sentence,
            sentenceTranslation: !!initialLocks?.sentenceTranslation,
        };
    }

    isLocked(field: CurationFieldKey): boolean {
        return !!this.locks[field];
    }

    isAllowed(field: CurationFieldKey): boolean {
        return !this.isLocked(field);
    }

    toggle(field: CurationFieldKey): boolean {
        this.locks[field] = !this.locks[field];
        return this.locks[field];
    }

    setLocked(field: CurationFieldKey, locked: boolean): void {
        this.locks[field] = locked;
    }

    toJSON(): Record<CurationFieldKey, boolean> {
        return { ...this.locks };
    }

    static fromJSON(json?: Record<string, boolean>): FieldLockConfig {
        return new FieldLockConfig(
            json as Partial<Record<CurationFieldKey, boolean>>,
        );
    }
}
