/**
 * Definition and configuration for vocabulary curation fields that can be
 * individually edited, selected, or locked from AI modification.
 */

export type CurationFieldKey =
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
        key: 'meaning',
        label: '释义 (Meaning)',
        description: '目标语言释义与定义',
    },
    {
        key: 'phonetic',
        label: '发音 (Phonetic)',
        description: '音标、假名读音或拼音',
    },
    {
        key: 'pos',
        label: '词性 (POS)',
        description: '词性或词类属性 (如 n., v., adj.)',
    },
    {
        key: 'sentence',
        label: '语境例句 (Sentence)',
        description: '原视频字幕对话或例句',
    },
    {
        key: 'sentenceTranslation',
        label: '例句翻译 (Translation)',
        description: '例句的目标语言翻译',
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
