import { CuratedVocabWord } from '../../options/application/VocabCurationSession';

/**
 * Standard CSV and TSV row parser adhering to RFC 4180 rules.
 * Correctly parses quoted fields, escaped quotes (""), inner newlines, and strips UTF-8 BOM.
 */
export function parseCsvRows(text: string, delimiter?: string): string[][] {
    const clean = text.replace(/^\uFEFF/, '');
    if (!clean.trim()) return [];

    // Auto-detect delimiter: check first line outside quotes
    const firstLine = clean.split(/\r?\n/)[0] || '';
    const delim =
        delimiter ||
        (firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',');

    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < clean.length) {
        const char = clean[i];
        const nextChar = clean[i + 1];

        if (inQuotes) {
            if (char === '"') {
                if (nextChar === '"') {
                    // Escaped quote: ""
                    currentField += '"';
                    i += 2;
                    continue;
                } else {
                    // End of quoted region
                    inQuotes = false;
                    i++;
                    continue;
                }
            } else {
                currentField += char;
                i++;
                continue;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
                i++;
                continue;
            } else if (char === delim) {
                currentRow.push(currentField.trim());
                currentField = '';
                i++;
                continue;
            } else if (char === '\r') {
                if (nextChar === '\n') {
                    i++;
                }
                currentRow.push(currentField.trim());
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
                i++;
                continue;
            } else if (char === '\n') {
                currentRow.push(currentField.trim());
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
                i++;
                continue;
            } else {
                currentField += char;
                i++;
                continue;
            }
        }
    }

    if (currentField.length > 0 || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
    }

    return rows.filter((r) => r.some((cell) => cell.length > 0));
}

export type CsvFieldType =
    | 'word'
    | 'lemma'
    | 'meaning'
    | 'phonetic'
    | 'pos'
    | 'sentence'
    | 'sentenceTranslation'
    | 'sourceLang'
    | 'targetLang';

/**
 * Matches a header string to one of CoWatcher's standard fields, tolerating case,
 * spaces, symbols, and multilingual aliases.
 */
export function matchHeaderField(header: string): CsvFieldType | null {
    const norm = header
        .toLowerCase()
        .replace(/[\s\-_/\\()[\]{}:"'`]/g, '')
        .trim();

    if (!norm) return null;

    // 1. Word (Headword) - strictly required column in the dataset
    if (
        norm === 'word' ||
        norm === 'headword' ||
        norm === 'term' ||
        norm === 'vocab' ||
        norm === 'vocabulary' ||
        norm === '生词' ||
        norm === '单词' ||
        norm === '词汇' ||
        norm === '词'
    ) {
        return 'word';
    }

    // 2. Lemma (Root / Base form)
    if (
        norm.includes('lemma') ||
        norm.includes('root') ||
        norm === 'base' ||
        norm.includes('原形') ||
        norm.includes('原型') ||
        norm.includes('辞书形') ||
        norm.includes('词元')
    ) {
        return 'lemma';
    }

    // 3. Sentence Translation (matched before sentence & general meaning)
    if (
        norm.includes('sentencetrans') ||
        norm.includes('exampletrans') ||
        norm.includes('contexttrans') ||
        norm.includes('例句翻译') ||
        norm.includes('句子翻译') ||
        norm.includes('例句中文') ||
        norm.includes('译文')
    ) {
        return 'sentenceTranslation';
    }

    // 4. Sentence (Original / Example)
    if (
        norm.includes('sentence') ||
        norm.includes('context') ||
        norm.includes('example') ||
        norm.includes('例句') ||
        norm.includes('原句') ||
        norm.includes('字幕') ||
        norm.includes('台词') ||
        norm.includes('语境')
    ) {
        return 'sentence';
    }

    // 5. Meaning / Definition
    if (
        norm.includes('meaning') ||
        norm.includes('definition') ||
        norm.includes('glossary') ||
        norm.includes('释义') ||
        norm.includes('定义') ||
        norm.includes('解释') ||
        norm.includes('含义') ||
        norm === 'translation' ||
        norm === 'trans' ||
        norm === '翻译'
    ) {
        return 'meaning';
    }

    // 6. Phonetic (Reading / Furigana / Pinyin / IPA)
    if (
        norm.includes('phonetic') ||
        norm.includes('reading') ||
        norm.includes('furigana') ||
        norm.includes('pronunciation') ||
        norm.includes('ipa') ||
        norm.includes('pinyin') ||
        norm.includes('kana') ||
        norm.includes('发音') ||
        norm.includes('读音') ||
        norm.includes('音标') ||
        norm.includes('假名') ||
        norm.includes('拼音') ||
        norm.includes('注音')
    ) {
        return 'phonetic';
    }

    // 7. POS (Part of Speech)
    if (
        norm === 'pos' ||
        norm.includes('partofspeech') ||
        norm.includes('词性') ||
        norm.includes('词类')
    ) {
        return 'pos';
    }

    // 8. Language
    if (
        norm === 'sourcelang' ||
        norm === 'srclang' ||
        norm === 'source' ||
        norm === 'lang' ||
        norm === 'language' ||
        norm.includes('源语言')
    ) {
        return 'sourceLang';
    }

    if (
        norm === 'targetlang' ||
        norm === 'tgtlang' ||
        norm.includes('目标语')
    ) {
        return 'targetLang';
    }

    return null;
}

export interface ParseVocabCsvResult {
    success: boolean;
    words: CuratedVocabWord[];
    matchedColumns: Partial<Record<CsvFieldType, number>>;
    error?: string;
}

/**
 * Parses raw CSV/TSV text into an array of CuratedVocabWord items.
 * Enforces that `word` is the only mandatory column, allowing all other columns to be blank.
 */
export function parseVocabCsv(
    csvText: string,
    defaultOptions?: {
        sourceLang?: string;
        targetLang?: string;
        defaultShowTitle?: string;
    },
): ParseVocabCsvResult {
    const rawRows = parseCsvRows(csvText);
    if (rawRows.length === 0) {
        return {
            success: false,
            words: [],
            matchedColumns: {},
            error: 'CSV 文件内容为空',
        };
    }

    const headerRow = rawRows[0];
    const columnMap: Partial<Record<CsvFieldType, number>> = {};

    headerRow.forEach((col, idx) => {
        const field = matchHeaderField(col);
        if (field && columnMap[field] === undefined) {
            columnMap[field] = idx;
        }
    });

    if (columnMap.word === undefined) {
        return {
            success: false,
            words: [],
            matchedColumns: {},
            error: '未找到生词列。请确保 CSV 首行包含表头，且生词列命名为 "Word"、"单词" 或 "生词"',
        };
    }

    const words: CuratedVocabWord[] = [];
    const sourceLang = defaultOptions?.sourceLang || 'ja';
    const targetLang = defaultOptions?.targetLang || 'zh-CN';
    const showTitle = defaultOptions?.defaultShowTitle || 'Imported CSV';

    for (let r = 1; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!row || row.length === 0) continue;

        const wordVal = (row[columnMap.word] || '').trim();
        if (!wordVal) {
            // Skip rows with empty word
            continue;
        }

        const getCol = (type: CsvFieldType): string => {
            const idx = columnMap[type];
            return idx !== undefined && row[idx] ? row[idx].trim() : '';
        };

        const item: CuratedVocabWord = {
            word: wordVal,
            lemma: getCol('lemma'),
            meaning: getCol('meaning'),
            phonetic: getCol('phonetic'),
            pos: getCol('pos'),
            sentence: getCol('sentence'),
            sentenceTranslation: getCol('sentenceTranslation'),
            sourceLang: getCol('sourceLang') || sourceLang,
            targetLang: getCol('targetLang') || targetLang,
            timestamp: 0,
            frequency: 1,
            source: 'user',
            createdAt: Date.now(),
            originShowTitle: showTitle,
            originEpisodeId: 'imported_csv',
        };

        words.push(item);
    }

    if (words.length === 0) {
        return {
            success: false,
            words: [],
            matchedColumns: columnMap,
            error: '未在 CSV 中解析到有效数据行（Word 列不能为空）',
        };
    }

    return {
        success: true,
        words,
        matchedColumns: columnMap,
    };
}
