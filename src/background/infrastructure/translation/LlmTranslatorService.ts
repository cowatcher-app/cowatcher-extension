import {
    ITranslatorService,
    TranslateBatchRequest,
    TranslateBatchResponse,
    ReviewBatchRequest,
    ReviewBatchResponse,
    MergeAsrCueItem,
    MergeAsrBatchRequest,
    MergeAsrBatchResponse,
    HealthCheckResult,
} from '../../domain/translation/ITranslatorService';
import { AsrSegmentationHelper } from '../../domain/translation/AsrSegmentationHelper';
import { LlmService } from '../../application/services/LlmService';
import { CharacterItem } from '@shared/domain/entities/Translation';
import { Language } from '@shared/domain/value-objects/Language';
import { Logger } from '@shared/utils/logger';
import { LLMProvider } from '@shared/domain/entities/PipelineTypes';
import { Context } from '@shared/domain/entities/Context';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { NCW_STORAGE_KEYS } from '@shared/domain/constants/StorageKeys';
import { ExtensionSettings } from '@shared/domain/constants/SettingsDefaults';

export class LlmTranslatorService implements ITranslatorService {
    readonly providerId: LLMProvider;
    private llmService: LlmService;
    private silenceThresholdMs = 600;

    private logger: Logger = new Logger('LlmTranslatorService');

    constructor(providerId: LLMProvider = 'ollama') {
        this.providerId = providerId;
        this.llmService = LlmService.getInstance();
    }

    async init(): Promise<void> {
        await this.llmService.init();

        const storage = BrowserStorageFactory.getStorage();
        const res = await storage.get<Partial<ExtensionSettings>>([
            NCW_STORAGE_KEYS.SETTINGS,
        ]);
        const s = res[NCW_STORAGE_KEYS.SETTINGS];
        if (typeof s?.asrSilenceThresholdMs === 'number') {
            this.silenceThresholdMs = s.asrSilenceThresholdMs;
        }

        storage.onChanged((changes) => {
            const s = changes[NCW_STORAGE_KEYS.SETTINGS]?.newValue as
                Partial<ExtensionSettings> | undefined;
            if (typeof s?.asrSilenceThresholdMs === 'number') {
                this.silenceThresholdMs = s.asrSilenceThresholdMs;
            }
        });
    }

    private escapeRegExp(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Finds `needle` in `haystack` and returns the remaining string with matched spans
     * replaced by spaces (preserving word boundaries), or `null` if no match was found.
     */
    private consumeGlossaryNeedle(
        haystack: string,
        needle: string,
    ): string | null {
        const trimmed = needle.trim();
        if (!trimmed || !haystack) return null;

        if (/^[\u0020-\u007E]+$/.test(trimmed)) {
            const pattern = new RegExp(
                `(?<![a-z0-9])${this.escapeRegExp(trimmed)}(?![a-z0-9])`,
                'gi',
            );
            let matched = false;
            const masked = haystack.replace(pattern, (m) => {
                matched = true;
                return ' '.repeat(m.length);
            });
            return matched ? masked : null;
        }

        const lowerHay = haystack.toLowerCase();
        const lowerNeedle = trimmed.toLowerCase();
        let idx = lowerHay.indexOf(lowerNeedle);
        if (idx === -1) return null;

        const chars = haystack.split('');
        while (idx !== -1) {
            for (let i = idx; i < idx + trimmed.length; i++) {
                chars[i] = ' ';
            }
            idx = lowerHay.indexOf(lowerNeedle, idx + trimmed.length);
        }
        return chars.join('');
    }

    private matchesGlossaryNeedle(haystack: string, needle: string): boolean {
        return this.consumeGlossaryNeedle(haystack, needle) !== null;
    }

    private formatGlossaryForPrompt(
        characters: Record<string, CharacterItem> = {},
        terms: Record<string, string> = {},
    ): string[] {
        const lines: string[] = [];
        for (const [name, val] of Object.entries(characters)) {
            if (typeof val === 'string') {
                lines.push(`${name} -> ${val}`);
            } else if (val && typeof val === 'object') {
                const canonical = val.canonical || name;
                const aliases =
                    Array.isArray(val.aliases) && val.aliases.length > 0
                        ? ` (Aliases/Called: ${val.aliases.join(', ')})`
                        : '';
                lines.push(`${name}${aliases} -> ${canonical}`);
            }
        }
        for (const [term, val] of Object.entries(terms)) {
            if (typeof val === 'string') {
                lines.push(`${term} -> ${val}`);
            }
        }
        return lines;
    }

    /**
     * Builds dual-tier glossary prompt blocks:
     * 1. Master/Manual (User-defined, Immutable, highest priority):
     *    - Merges aliases from model discoveries into manual setup, but uses manual canonical translation.
     *    - Translator must strictly use this; Supervisor CANNOT modify or contradict.
     * 2. Established/Dynamic (Model-discovered):
     *    - Excludes any keys present in manual setup (guaranteed zero overlapping keys).
     *    - Translator strictly adheres; Supervisor can maintain and expand.
     */
    private buildGlossaryBlocks(
        context: Context,
        isSupervisor: boolean,
        relevantText?: string,
    ): string {
        const shouldInclude = (candidates: string[]): boolean => {
            if (!relevantText) return true;
            return candidates.some((c) =>
                this.matchesGlossaryNeedle(relevantText, c),
            );
        };

        const manualChars: Record<string, CharacterItem> = {};
        for (const [name, manualChar] of Object.entries(
            context.manualSetupCharacters || {},
        )) {
            const modelChar = context.characters[name];
            const mergedAliases = Array.from(
                new Set([
                    ...(manualChar.aliases || []),
                    ...(modelChar?.aliases || []),
                ]),
            );
            if (!shouldInclude([name, ...mergedAliases])) continue;
            manualChars[name] = {
                canonical: manualChar.canonical,
                aliases: mergedAliases,
                setByUser: true,
            };
        }

        const autoChars: Record<string, CharacterItem> = {};
        for (const [name, char] of Object.entries(context.characters || {})) {
            if (!context.manualSetupCharacters[name]) {
                const aliases = Array.isArray(char?.aliases) ? char.aliases : [];
                if (!shouldInclude([name, ...aliases])) continue;
                autoChars[name] = char;
            }
        }

        const manualTerms: Record<string, string> = {};
        for (const [k, v] of Object.entries(context.manualSetupTerms || {})) {
            if (!shouldInclude([k])) continue;
            manualTerms[k] = v;
        }

        const autoTerms: Record<string, string> = {};
        for (const [k, v] of Object.entries(context.terms || {})) {
            if (!context.manualSetupTerms[k]) {
                if (!shouldInclude([k])) continue;
                autoTerms[k] = v;
            }
        }

        const manualLines = this.formatGlossaryForPrompt(
            manualChars,
            manualTerms,
        );
        const autoLines = this.formatGlossaryForPrompt(autoChars, autoTerms);

        let block = '';

        if (manualLines.length > 0) {
            block +=
                '\n### MASTER GLOSSARY & CHARACTERS (IMMUTABLE - STRICTLY USER-DEFINED) ###\n';
            block += isSupervisor
                ? 'These terms and character translations are user-locked. YOU MUST NOT MODIFY OR OVERRIDE THEIR CANONICAL TRANSLATIONS, but you CAN discover and report new aliases for them.\n'
                : 'You must strictly and verbatim use these exact character names and terminology translations.\n';
            block += manualLines.map((line) => '- ' + line).join('\n') + '\n';
            block += '### END MASTER GLOSSARY ###\n\n';
        }

        if (autoLines.length > 0) {
            block += '### ESTABLISHED GLOSSARY & CHARACTERS ###\n';
            block += isSupervisor
                ? 'These are model-discovered terms. Verify consistency and suggest refinements or new terms if found.\n'
                : 'Strictly adhere to these character names and terms for consistency.\n';
            block += autoLines.map((line) => '- ' + line).join('\n') + '\n';
            block += '### END ESTABLISHED GLOSSARY ###\n\n';
        }

        return block;
    }

    /**
     * Cleans ID markers (e.g., [643], [643-644]:, 【643】：) and extraneous wrapper quotes
     */
    private cleanTranslationText(text: string): string {
        if (!text) return '';
        return (
            text
                // Strip leading brackets and IDs/ranges: [643]:, [643-644]:, 【643-644】：, etc.
                .replace(
                    /^(?:\[|【|\()\s*\d+(?:\s*[-~至到]\s*\d+)?\s*(?:\]|】|\))\s*[:：\-.]?\s*/,
                    '',
                )
                .replace(/^(\d+(?:\s*[-~至到]\s*\d+)?)\s*[:：\-.]\s*/, '')
                // Strip any residual [id] or [id-id] or 【id】 markers within text
                .replace(
                    /(?:\[|【)\s*\d+(?:\s*[-~至到]\s*\d+)?\s*(?:\]|】)\s*[:：]?\s*/g,
                    '',
                )
                // Strip wrapping quotes
                .replace(/^["'“”](.*)["'“”]$/, '$1')
                .trim()
        );
    }

    /**
     * Robustly parses numbered subtitles from LLM response text.
     * Extracts text segments bounded by target ID markers (e.g. [81]:, [81-82]:, 【81】：, 81., etc.).
     * Supports [start-end] ranges for split sentences, mapping the translation to all IDs in the range.
     * If an ID marker is missing in the output, it is omitted rather than blindly guessed by index,
     * completely preventing downstream cue misalignment.
     */
    private parseNumberedSubtitles(
        text: string,
        targetIds: Set<number>,
        orderedItems: Array<{ id: number }>,
    ): { results: Record<number, string>; mergedGroups: number[][] } {
        const resultMap: Record<number, string> = {};
        const mergedGroups: number[][] = [];
        if (!text) return { results: resultMap, mergedGroups };

        // Pattern 1: Bracketed markers [123] or [123-124] or 【123-124】, preceded by start, newline, or whitespace
        // Pattern 2: Line starters: 123. or 123-124: or 123： or #123: at the beginning of a line
        const markerRegex =
            /(?:(?:^|\n|\s)(?:\[|【)\s*(\d+)(?:\s*[-~至到]\s*(\d+))?\s*(?:\]|】)\s*[:：]?\s*|(?:^|\n)\s*(?:#)?\s*(\d+)(?:\s*[-~至到]\s*(\d+))?\s*[.:：]\s*)/g;
        const markers: Array<{
            startId: number;
            endId: number;
            start: number;
            end: number;
        }> = [];

        let match: RegExpExecArray | null;
        while ((match = markerRegex.exec(text)) !== null) {
            const startIdStr = match[1] || match[3];
            const endIdStr = match[2] || match[4];
            if (!startIdStr) continue;

            const startId = parseInt(startIdStr, 10);
            const endId = endIdStr ? parseInt(endIdStr, 10) : startId;

            // Validate range: startId <= endId, reasonable span (<= 5 cues)
            if (endId >= startId && endId - startId <= 5) {
                if (targetIds.has(startId) || targetIds.has(endId)) {
                    markers.push({
                        startId,
                        endId,
                        start: match.index,
                        end: match.index + match[0].length,
                    });
                }
            }
        }

        if (markers.length > 0) {
            markers.sort((a, b) => a.start - b.start);
            for (let i = 0; i < markers.length; i++) {
                const current = markers[i];
                const nextStart =
                    i + 1 < markers.length ? markers[i + 1].start : text.length;
                const rawChunk = text.slice(current.end, nextStart).trim();
                if (rawChunk) {
                    const cleanText = this.cleanTranslationText(rawChunk);
                    const groupIds: number[] = [];
                    for (let id = current.startId; id <= current.endId; id++) {
                        if (targetIds.has(id)) {
                            groupIds.push(id);
                        }
                    }
                    if (groupIds.length > 1) {
                        // Never duplicate the full merged translation across all cues:
                        // place it on the first cue and leave secondary cues empty until split.
                        resultMap[groupIds[0]] = cleanText;
                        for (const secId of groupIds.slice(1)) {
                            resultMap[secId] = '';
                        }
                        mergedGroups.push(groupIds);
                    } else if (groupIds.length === 1) {
                        resultMap[groupIds[0]] = cleanText;
                    }
                }
            }
            return { results: resultMap, mergedGroups };
        }

        // Fallback ONLY when absolutely no markers were matched:
        const rawLines = text
            .split('\n')
            .map((l) => l.trim())
            .filter(
                (l) =>
                    l.length > 0 &&
                    !l.startsWith('#') &&
                    !l.startsWith('*') &&
                    !l.startsWith('---'),
            );

        if (rawLines.length === orderedItems.length) {
            orderedItems.forEach((item, index) => {
                resultMap[item.id] = this.cleanTranslationText(rawLines[index]);
            });
        } else {
            this.logger.warn(
                'Translator',
                `Batch translation returned unformatted text without ID markers, and line count (${rawLines.length}) does not match items count (${orderedItems.length}). Discarding unverified batch to prevent misalignment.`,
            );
        }

        return { results: resultMap, mergedGroups };
    }

    async translateBatch(
        req: TranslateBatchRequest,
    ): Promise<TranslateBatchResponse> {
        const {
            items,
            targetLang,
            contextItems = [],
            context,
            signal,
            movieId,
            extractGlossary = false,
        } = req;
        if (!items || items.length === 0) return { success: true, results: {} };

        const relevantText = [...items, ...contextItems]
            .map((c) => c.rawText || '')
            .join('\n');

        const ctx = context;
        let contextBlock = '';
        if (ctx && ctx.isWarmedUp) {
            contextBlock += `Show Title: ${ctx.title}\n`;
            const episode = movieId ? ctx.getEpisodeContext(movieId) : null;
            const synopsisParts = [
                ctx.showSynopsis ? `Show: ${ctx.showSynopsis}` : '',
                episode?.synopsis ? `Episode: ${episode.synopsis}` : '',
            ].filter(Boolean);
            if (synopsisParts.length > 0) {
                contextBlock += `Background Synopsis:\n${synopsisParts.join('\n')}\n`;
            }

            contextBlock += this.buildGlossaryBlocks(ctx, false, relevantText);
        }

        let contextDialogues = '';
        if (contextItems.length > 0) {
            const validCtx = contextItems.map((c) => {
                const orig = (c.rawText || '').replace(/\n+/g, ' ');
                const trans = c.transText
                    ? ` -> Translated: "${c.transText.replace(/\n+/g, ' ')}"`
                    : '';
                return `[Context #${c.id}]: "${orig}"${trans}`;
            });
            contextDialogues = `--- Preceding Dialogue Context ---\n${validCtx.join('\n')}\n\n`;
        }

        const targetLangPrompt = Language.resolve(targetLang).promptName;
        const systemPrompt = `You are a professional subtitle translator.
${contextBlock}
Translate the numbered subtitle lines into ${targetLangPrompt}.
Maintain natural dialogue tone and conversational context between speakers.
Strictly adhere to the established character names, aliases, and terms in the glossary.

CRITICAL NUMBERING & FORMAT RULES:
1. Translate line by line in this format:
[index]: translated_text
2. SPLIT SENTENCE / MERGE HANDLING:
If consecutive lines belong to a single split sentence that must be translated together (e.g. [103] and [104]), combine their line IDs into a range:
[103-104]: translated_text
The next line MUST immediately resume with the next unmerged ID (e.g. [105]: ...).
3. NEVER shift, renumber, or omit line numbers. Every input line ID must be accounted for either individually or in a [start-end] range.${
            extractGlossary
                ? `

GLOSSARY EXTRACTION (OPTIONAL AT THE VERY END):
After outputting ALL numbered subtitle lines above, if you encounter any recurring character names, nicknames, locations, or specialized proper nouns that are NOT already in the glossary above, append a single XML-wrapped JSON block at the very end:
<glossary_json>
{"new_characters":{"Original Name":{"canonical":"Target Name","aliases":[]}},"new_terms":{"Term":"Translation"}}
</glossary_json>
Do NOT include placeholder entries ("Original Name", "Target Name", "Term"). Omit <glossary_json> if nothing new is found.`
                : ''
        }`;

        const userLines = items
            .map((item) => `[${item.id}]: ${item.rawText.replace(/\n+/g, ' ')}`)
            .join('\n');
        const fullUserPrompt = contextDialogues
            ? `${contextDialogues}--- Target Lines to Translate ---\n${userLines}`
            : userLines;

        const MAX_RETRIES = 2;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            if (signal?.aborted) return { success: false, error: 'Aborted' };

            try {
                const rawResponse = await this.llmService.callChat(
                    'translator',
                    {
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: fullUserPrompt },
                        ],
                        temperature: attempt === 1 ? 0.2 : 0.1,
                        signal,
                    },
                );

                const strippedResponse = rawResponse
                    .replace(/<think[\s\S]*?<\/think>/gi, '')
                    .replace(/<thought[\s\S]*?<\/thought>/gi, '')
                    .trim();

                const {
                    cleanText: cleanResponse,
                    newCharacters,
                    newTerms,
                } = extractGlossary
                    ? this.extractGlossaryFromTranslatorResponse(
                          strippedResponse,
                      )
                    : {
                          cleanText: strippedResponse,
                          newCharacters: undefined,
                          newTerms: undefined,
                      };

                const targetIds = new Set(items.map((it) => it.id));
                const { results: resultMap, mergedGroups } =
                    this.parseNumberedSubtitles(cleanResponse, targetIds, items);

                const secondaryMergedIds = new Set<number>(
                    mergedGroups.flatMap((g) => g.slice(1)),
                );

                // Safety Guard: Validate that EVERY requested cue was translated with non-empty text
                // (secondary cues inside a detected [start-end] merge are intentionally empty until split)
                const missingIds = items.filter(
                    (it) =>
                        !secondaryMergedIds.has(it.id) &&
                        (!resultMap[it.id] || !resultMap[it.id].trim()),
                );
                if (missingIds.length > 0) {
                    const warnMsg = `Safety Guard: Batch translation count mismatch (expected ${items.length} cues, but received ${Object.keys(resultMap).length} valid cues). Missing cue IDs: [${missingIds.map((m) => m.id).join(', ')}].`;
                    if (attempt < MAX_RETRIES) {
                        this.logger.warn(
                            'Translator',
                            `${warnMsg} Retrying entire batch (attempt ${attempt + 1}/${MAX_RETRIES})...`,
                        );
                        continue;
                    } else {
                        // If some cues succeeded, preserve the valid translations rather than discarding everything!
                        if (Object.keys(resultMap).length > 0) {
                            this.logger.warn(
                                'Translator',
                                `${warnMsg} Partial batch recovered: ${Object.keys(resultMap).length}/${items.length} valid cues preserved. Missing cues fallback to raw text to prevent UI stall.`,
                            );
                            for (const m of missingIds) {
                                resultMap[m.id] = m.rawText;
                            }
                            const mergedMap =
                                await this.finalizeMergedAndGlossary(
                                    items,
                                    resultMap,
                                    mergedGroups,
                                    targetLangPrompt,
                                    ctx,
                                    signal,
                                );
                            return {
                                success: true,
                                results: resultMap,
                                merged: mergedMap,
                                newCharacters,
                                newTerms,
                            };
                        }
                        this.logger.error(
                            'Translator',
                            `${warnMsg} Discarding entire batch to trigger retry and prevent subtitle misalignment.`,
                        );
                        return { success: false, error: warnMsg };
                    }
                }

                const mergedMap = await this.finalizeMergedAndGlossary(
                    items,
                    resultMap,
                    mergedGroups,
                    targetLangPrompt,
                    ctx,
                    signal,
                );

                return {
                    success: true,
                    results: resultMap,
                    merged: mergedMap,
                    newCharacters,
                    newTerms,
                };
            } catch (err: unknown) {
                const isAbort =
                    err instanceof Error &&
                    (err.name === 'AbortError' || err.message === 'Aborted');
                const errMsg = err instanceof Error ? err.message : String(err);
                if (attempt === MAX_RETRIES || isAbort || signal?.aborted) {
                    return { success: false, error: errMsg };
                }
                this.logger.warn(
                    'Translator',
                    `Batch translation attempt ${attempt} failed: ${errMsg}. Retrying...`,
                );
            }
        }

        return {
            success: false,
            error: 'Batch translation failed after retries',
        };
    }

    private async finalizeMergedAndGlossary(
        items: Array<{ id: number; rawText: string }>,
        resultMap: Record<number, string>,
        mergedGroups: number[][],
        targetLangPrompt: string,
        ctx: Context | null | undefined,
        signal?: AbortSignal,
    ): Promise<Record<number, number[]> | undefined> {
        let mergedMap: Record<number, number[]> | undefined;
        if (mergedGroups.length > 0) {
            mergedMap = {};
            for (const group of mergedGroups) {
                for (const id of group) {
                    mergedMap[id] = group;
                }
            }
            if (!signal?.aborted) {
                await this.splitMergedTranslations(
                    items,
                    resultMap,
                    mergedGroups,
                    targetLangPrompt,
                    signal,
                );
            }
        }

        if (ctx && ctx.isWarmedUp && !signal?.aborted) {
            await this.repairGlossaryViolations(
                items,
                resultMap,
                targetLangPrompt,
                ctx,
                signal,
            );
        }

        return mergedMap;
    }

    /**
     * Asks the translation model to split a merged full-sentence translation across its
     * individual source cues. On timeout or parse failure, keeps the full translation only
     * on the first cue and leaves secondary cues empty (never duplicating N copies).
     */
    private async splitSingleMergedTranslation(
        groupItems: Array<{ id: number; rawText: string }>,
        fullTranslation: string,
        targetLangPrompt: string,
        signal?: AbortSignal,
    ): Promise<Record<number, string>> {
        const fallback: Record<number, string> = {};
        if (groupItems.length === 0) return fallback;

        fallback[groupItems[0].id] = fullTranslation;
        for (const item of groupItems.slice(1)) {
            fallback[item.id] = '';
        }

        if (groupItems.length === 1 || !fullTranslation.trim()) {
            return fallback;
        }

        const systemPrompt = `You are a professional subtitle translator.
A single complete ${targetLangPrompt} translation was produced by merging ${groupItems.length} consecutive subtitle cues.
Split that complete translation naturally across each individual cue ID so each line aligns with its source cue, without changing the overall meaning or duplicating the full sentence.

CRITICAL FORMAT RULES:
1. Output strictly one line per cue ID in this exact format:
[index]: split_translation_part
2. Do NOT merge IDs (do NOT use [a-b]). Every cue ID listed below must appear individually with a non-empty part.`;

        const sourceLines = groupItems
            .map((it) => `[${it.id}]: ${it.rawText.replace(/\n+/g, ' ')}`)
            .join('\n');
        const userPrompt = `Source Cues:\n${sourceLines}\n\nComplete Translation to Split:\n"${fullTranslation}"`;

        try {
            const rawSplit = await this.llmService.callChat('translator', {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.1,
                signal,
            });

            const cleanSplit = rawSplit
                .replace(/<think[\s\S]*?<\/think>/gi, '')
                .replace(/<thought[\s\S]*?<\/thought>/gi, '')
                .trim();

            const groupIdSet = new Set(groupItems.map((it) => it.id));
            const { results: parsedSplit, mergedGroups: nestedMerges } =
                this.parseNumberedSubtitles(cleanSplit, groupIdSet, groupItems);

            const allPopulated =
                nestedMerges.length === 0 &&
                groupItems.every(
                    (it) =>
                        typeof parsedSplit[it.id] === 'string' &&
                        parsedSplit[it.id].trim().length > 0,
                );

            if (allPopulated) {
                return parsedSplit;
            }

            this.logger.warn(
                'Translator',
                `Split merged translation incomplete for cues [${groupItems.map((g) => g.id).join(', ')}]; keeping full translation on first cue only.`,
            );
            return fallback;
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.logger.warn(
                'Translator',
                `Split merged translation failed for cues [${groupItems.map((g) => g.id).join(', ')}] (keeping full translation on first cue only): ${errMsg}`,
            );
            return fallback;
        }
    }

    private async splitMergedTranslations(
        items: Array<{ id: number; rawText: string }>,
        resultMap: Record<number, string>,
        mergedGroups: number[][],
        targetLangPrompt: string,
        signal?: AbortSignal,
    ): Promise<void> {
        const itemById = new Map(items.map((it) => [it.id, it]));
        for (const groupIds of mergedGroups) {
            if (signal?.aborted) break;
            const groupItems = groupIds
                .map((id) => itemById.get(id))
                .filter((it): it is { id: number; rawText: string } =>
                    Boolean(it),
                );
            const fullTrans = (resultMap[groupIds[0]] || '').trim();
            if (groupItems.length <= 1 || !fullTrans) continue;

            this.logger.info(
                'Translator',
                `Detected merged translation for cues [${groupIds.join(', ')}]. Requesting translator split...`,
            );
            const splitMap = await this.splitSingleMergedTranslation(
                groupItems,
                fullTrans,
                targetLangPrompt,
                signal,
            );
            for (const [idStr, text] of Object.entries(splitMap)) {
                const id = parseInt(idStr, 10);
                resultMap[id] = text;
            }
        }
    }

    /**
     * Programmatically checks translated cues against effective glossary characters and terms.
     */
    private findGlossaryViolations(
        items: Array<{ id: number; rawText: string }>,
        resultMap: Record<number, string>,
        context: Context,
    ): Array<{
        id: number;
        rawText: string;
        currentTrans: string;
        errors: Array<{
            kind: 'character' | 'term';
            sourceMatch: string;
            canonical: string;
        }>;
    }> {
        const effectiveChars = context.getEffectiveCharacters();
        const effectiveTerms = context.getEffectiveTerms();
        const violations: Array<{
            id: number;
            rawText: string;
            currentTrans: string;
            errors: Array<{
                kind: 'character' | 'term';
                sourceMatch: string;
                canonical: string;
            }>;
        }> = [];

        // Flatten all active glossary rules and sort longest-first so longer phrases
        // (e.g. "nobi nobida") consume their span before shorter sub-phrases ("nobi").
        const rules: Array<{
            kind: 'character' | 'term';
            candidates: string[];
            canonical: string;
            maxLen: number;
        }> = [];

        for (const [name, charItem] of Object.entries(effectiveChars)) {
            const canonical = (charItem?.canonical || '').trim();
            if (!canonical) continue;
            const candidates = [name, ...(charItem.aliases || [])]
                .map((c) => c.trim())
                .filter(Boolean)
                .sort((a, b) => b.length - a.length);
            if (candidates.length === 0) continue;
            rules.push({
                kind: 'character',
                candidates,
                canonical,
                maxLen: candidates[0].length,
            });
        }

        for (const [term, targetTerm] of Object.entries(effectiveTerms)) {
            const canonical = (targetTerm || '').trim();
            const trimmedTerm = term.trim();
            if (!canonical || !trimmedTerm) continue;
            rules.push({
                kind: 'term',
                candidates: [trimmedTerm],
                canonical,
                maxLen: trimmedTerm.length,
            });
        }

        rules.sort((a, b) => b.maxLen - a.maxLen);

        for (const item of items) {
            const raw = (item.rawText || '').trim();
            const trans = (resultMap[item.id] || '').trim();
            if (!raw || !trans || trans === raw) continue;

            let remainingRaw = raw;
            const errors: Array<{
                kind: 'character' | 'term';
                sourceMatch: string;
                canonical: string;
            }> = [];

            for (const rule of rules) {
                let matchedCandidate: string | null = null;
                for (const candidate of rule.candidates) {
                    const nextRaw = this.consumeGlossaryNeedle(
                        remainingRaw,
                        candidate,
                    );
                    if (nextRaw !== null) {
                        matchedCandidate = candidate;
                        remainingRaw = nextRaw;
                        break;
                    }
                }
                if (
                    matchedCandidate &&
                    !this.matchesGlossaryNeedle(trans, rule.canonical)
                ) {
                    errors.push({
                        kind: rule.kind,
                        sourceMatch: matchedCandidate,
                        canonical: rule.canonical,
                    });
                }
            }

            if (errors.length > 0) {
                violations.push({
                    id: item.id,
                    rawText: raw.replace(/\n+/g, ' '),
                    currentTrans: trans.replace(/\n+/g, ' '),
                    errors,
                });
            }
        }

        return violations;
    }

    /**
     * Prompts the translation model with advisory glossary notices so it can fix genuine
     * terminology/name misses while preserving natural translations for compound words or idioms.
     */
    private async repairGlossaryViolations(
        items: Array<{ id: number; rawText: string }>,
        resultMap: Record<number, string>,
        targetLangPrompt: string,
        context: Context,
        signal?: AbortSignal,
    ): Promise<void> {
        const violations = this.findGlossaryViolations(
            items,
            resultMap,
            context,
        );
        if (violations.length === 0) return;

        this.logger.info(
            'Translator',
            `Programmatic glossary check raised ${violations.length} advisory cue(s): [${violations.map((v) => v.id).join(', ')}]. Requesting translator model review...`,
        );

        const systemPrompt = `You are a professional subtitle translator. Review the advisory glossary notices below in ${targetLangPrompt}.
For each cue, evaluate the full sentence context:
- If the flagged source text actually refers to that glossary character or term, revise the translation to use the exact canonical translation.
- If the flagged source text is merely part of a larger compound word, idiom, or unrelated ordinary meaning, KEEP the current natural translation unchanged (output it as-is).

CRITICAL FORMAT RULES:
1. Output strictly line by line in this format:
[index]: reviewed_translation
2. Include ONLY the cue IDs listed below. Do NOT add explanations or commentary.`;

        const userPrompt = violations
            .map((v) => {
                const advisoryLines = v.errors
                    .map(
                        (e) =>
                            `  - ADVISORY (${e.kind}): Source contains "${e.sourceMatch}" (glossary canonical: "${e.canonical}"), which was not found in Current Translation. If it refers to this ${e.kind} in context, use "${e.canonical}"; if it is part of a larger word or unrelated meaning, keep the current translation.`,
                    )
                    .join('\n');
                return `[${v.id}]\nSource: "${v.rawText}"\nCurrent Translation: "${v.currentTrans}"\n${advisoryLines}`;
            })
            .join('\n\n');

        try {
            const rawRepair = await this.llmService.callChat('translator', {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.1,
                signal,
            });

            const cleanRepair = rawRepair
                .replace(/<think[\s\S]*?<\/think>/gi, '')
                .replace(/<thought[\s\S]*?<\/thought>/gi, '')
                .trim();

            const violatingIds = new Set(violations.map((v) => v.id));
            const parsed = this.parseNumberedSubtitles(
                cleanRepair,
                violatingIds,
                violations.map((v) => ({ id: v.id })),
            );
            const repairedMap = parsed.results;

            let revisedCount = 0;
            for (const v of violations) {
                const candidate = (repairedMap[v.id] || '').trim();
                if (!candidate) continue;

                if (candidate !== v.currentTrans) {
                    revisedCount++;
                }
                resultMap[v.id] = candidate;
            }

            this.logger.info(
                'Translator',
                `Translator glossary advisory review completed (${revisedCount}/${violations.length} cue(s) revised).`,
            );
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.logger.warn(
                'Translator',
                `Translator glossary advisory review failed (keeping original translations): ${errMsg}`,
            );
        }
    }

    private normalizeExtractedGlossary(parsed: {
        new_characters?: unknown;
        new_terms?: unknown;
    }): {
        newCharacters?: Record<string, CharacterItem>;
        newTerms?: Record<string, string>;
    } {
        const newCharacters: Record<string, CharacterItem> = {};
        if (parsed.new_characters && typeof parsed.new_characters === 'object') {
            for (const [k, v] of Object.entries(parsed.new_characters)) {
                const key = k.trim();
                if (!key || key.toLowerCase() === 'original name') continue;

                if (typeof v === 'string') {
                    const canonical = v.trim();
                    if (
                        canonical &&
                        canonical.toLowerCase() !== 'target name'
                    ) {
                        newCharacters[key] = { canonical, aliases: [] };
                    }
                } else if (v && typeof v === 'object') {
                    const obj = v as Record<string, unknown>;
                    const canonical = String(
                        obj.canonical || obj.name || key,
                    ).trim();
                    if (
                        canonical &&
                        canonical.toLowerCase() !== 'target name'
                    ) {
                        const aliases = Array.isArray(obj.aliases)
                            ? obj.aliases
                                  .map((a: unknown) => String(a).trim())
                                  .filter(Boolean)
                            : [];
                        newCharacters[key] = {
                            canonical,
                            aliases: aliases.filter(
                                (a: string) => a.toLowerCase() !== 'new_alias',
                            ),
                        };
                    }
                }
            }
        }

        const newTerms: Record<string, string> = {};
        if (
            parsed.new_terms &&
            typeof parsed.new_terms === 'object' &&
            !Array.isArray(parsed.new_terms)
        ) {
            for (const [k, v] of Object.entries(parsed.new_terms)) {
                const key = k.trim();
                const val = typeof v === 'string' ? v.trim() : '';
                if (
                    key &&
                    val &&
                    !(
                        key.toLowerCase() === 'term' &&
                        val.toLowerCase() === 'translation'
                    )
                ) {
                    newTerms[key] = val;
                }
            }
        }

        return {
            newCharacters:
                Object.keys(newCharacters).length > 0
                    ? newCharacters
                    : undefined,
            newTerms: Object.keys(newTerms).length > 0 ? newTerms : undefined,
        };
    }

    private extractGlossaryFromTranslatorResponse(text: string): {
        cleanText: string;
        newCharacters?: Record<string, CharacterItem>;
        newTerms?: Record<string, string>;
    } {
        const match = text.match(/<glossary_json>([\s\S]*?)(?:<\/glossary_json>|$)/i);
        if (!match) {
            return { cleanText: text };
        }
        const cleanText = text
            .replace(/<glossary_json>[\s\S]*?(?:<\/glossary_json>|$)/gi, '')
            .trim();
        const parsed = this.parseSupervisorJson(match[1]);
        const { newCharacters, newTerms } =
            this.normalizeExtractedGlossary(parsed);
        return { cleanText, newCharacters, newTerms };
    }

    private fallbackExtractSupervisorJson(text: string): {
        corrections: Record<string, string>;
        new_characters: Record<string, unknown>;
        new_terms: Record<string, string>;
    } {
        const result: {
            corrections: Record<string, string>;
            new_characters: Record<string, unknown>;
            new_terms: Record<string, string>;
        } = {
            corrections: {},
            new_characters: {},
            new_terms: {},
        };

        // 1. Extract corrections section (tolerates missing closing brace if truncated)
        const corrMatch = text.match(
            /"corrections"\s*:\s*\{([\s\S]*?)(?:\}|"(?:new_characters|new_terms)"|$)/i,
        );
        if (corrMatch) {
            const corrBody = corrMatch[1];
            const itemRegex = /"(\d+)"\s*:\s*"((?:[^"\\]|\\.)*?)"/g;
            let m: RegExpExecArray | null;
            while ((m = itemRegex.exec(corrBody)) !== null) {
                result.corrections[m[1]] = m[2];
            }
        }

        // 2. Extract new_terms section (tolerates missing closing brace if truncated)
        const termsMatch = text.match(
            /"new_terms"\s*:\s*\{([\s\S]*?)(?:\}|"(?:new_characters|corrections)"|$)/i,
        );
        if (termsMatch) {
            const termsBody = termsMatch[1];
            const termRegex = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*?)"/g;
            let m: RegExpExecArray | null;
            while ((m = termRegex.exec(termsBody)) !== null) {
                result.new_terms[m[1]] = m[2];
            }
        }

        return result;
    }

    private parseSupervisorJson(rawContent: string): {
        corrections?: Record<string, string>;
        new_characters?: Record<string, unknown>;
        new_terms?: Record<string, string>;
        ranges?: Array<[number, number]>;
    } {
        if (!rawContent) return {};

        // 1. Strip reasoning/thinking tags and markdown fences
        let cleaned = rawContent
            .replace(/<think[\s\S]*?<\/think>/gi, '')
            .replace(/<thought[\s\S]*?<\/thought>/gi, '')
            .trim();

        const jsonFenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (jsonFenceMatch) {
            cleaned = jsonFenceMatch[1].trim();
        }

        // 2. Extract candidate JSON object boundaries
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace === -1 || lastBrace <= firstBrace) {
            return this.fallbackExtractSupervisorJson(cleaned);
        }
        const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);

        // 3. Try standard JSON.parse first
        try {
            return JSON.parse(jsonStr);
        } catch {
            // Proceed to repair strategies
        }

        // 4. Repair strategy 1: Trailing commas (preserve newline/whitespace before closing bracket)
        const repaired = jsonStr.replace(/,(\s*[\]}])/g, '$1');
        try {
            return JSON.parse(repaired);
        } catch {
            // Proceed to repair strategy 2
        }

        // 5. Repair strategy 2: Unescaped double quotes inside key-value string lines
        try {
            const repairedLines = repaired.split('\n').map((line) => {
                // Match line like: "123": "some text "quotes" here",
                const kvMatch = line.match(
                    /^(\s*"[^"]+"\s*:\s*")(.*)("\s*,?\s*)$/,
                );
                if (kvMatch) {
                    const [, prefix, val, suffix] = kvMatch;
                    // Escape unescaped double quotes in the value
                    const cleanVal = val.replace(/(?<!\\)"/g, '\\"');
                    return `${prefix}${cleanVal}${suffix}`;
                }
                return line;
            });
            return JSON.parse(repairedLines.join('\n'));
        } catch {
            // Proceed to fallback extraction
        }

        // 6. Repair strategy 3: Fallback regex extraction of key-value maps
        try {
            return this.fallbackExtractSupervisorJson(cleaned);
        } catch (finalErr) {
            this.logger.warn(
                'LLM Translation',
                'All supervisor JSON parsing attempts failed:',
                finalErr,
            );
            return {};
        }
    }

    async reviewBatch(req: ReviewBatchRequest): Promise<ReviewBatchResponse> {
        const {
            items,
            contextItems = [],
            targetLang,
            signal,
            context,
            movieId,
        } = req;

        if (!items || items.length === 0) {
            return { success: true, corrections: {} };
        }

        let contextBlock = '';
        if (contextItems.length > 0) {
            const validCtx = contextItems.map((c) => {
                const orig = (c.rawText || '').replace(/\n+/g, ' ');
                const trans = c.transText
                    ? ` -> Translated: "${c.transText.replace(/\n+/g, ' ')}"`
                    : '';
                return `[Context #${c.id}]: "${orig}"${trans}`;
            });
            contextBlock = `Preceding Dialogue Context:\n${validCtx.join('\n')}\n\n`;
        }

        const itemById = new Map(items.map((it) => [it.id, it]));
        const visitedIds = new Set<number>();
        const mergedGroupByKey = new Map<
            string,
            Array<{ id: number; rawText: string; transText: string }>
        >();
        const dialogueLines: string[] = [];

        for (const item of items) {
            if (visitedIds.has(item.id)) continue;

            if (item.merged && item.merged.length > 1) {
                const groupItems = item.merged
                    .map((id) => itemById.get(id))
                    .filter(
                        (
                            g,
                        ): g is {
                            id: number;
                            rawText: string;
                            transText: string;
                            merged?: number[];
                        } => Boolean(g),
                    );

                if (groupItems.length > 1) {
                    groupItems.forEach((g) => visitedIds.add(g.id));
                    const combinedOrig = groupItems
                        .map((g) => g.rawText.replace(/\n+/g, ' ').trim())
                        .join(' ');
                    const combinedTrans = groupItems
                        .map((g) => g.transText.replace(/\n+/g, ' ').trim())
                        .filter(Boolean)
                        .join(' ');
                    const rangeKey = `${groupItems[0].id}-${groupItems[groupItems.length - 1].id}`;
                    mergedGroupByKey.set(rangeKey, groupItems);
                    dialogueLines.push(
                        `[${rangeKey}] Original: "${combinedOrig}" | Translated: "${combinedTrans}"`,
                    );
                    continue;
                }
            }

            visitedIds.add(item.id);
            const origText = item.rawText.replace(/\n+/g, ' ');
            const transText = item.transText.replace(/\n+/g, ' ');
            dialogueLines.push(
                `[${item.id}] Original: "${origText}" | Translated: "${transText}"`,
            );
        }

        const dialoguesText = dialogueLines.join('\n');

        const targetLangPrompt = targetLang.promptName;
        let showLine = '';
        let synopsisLine = '';
        let glossaryBlock = '';

        if (context) {
            if (context.title) {
                showLine = `Current Show: ${context.title}\n`;
            }
            const episode = movieId ? context.getEpisodeContext(movieId) : null;
            const synopsisParts = [
                context.showSynopsis ? `Show: ${context.showSynopsis}` : '',
                episode?.synopsis ? `Episode: ${episode.synopsis}` : '',
            ].filter(Boolean);

            if (synopsisParts.length > 0) {
                synopsisLine = `Background Synopsis:\n${synopsisParts.join('\n')}\n`;
            }

            glossaryBlock = this.buildGlossaryBlocks(
                context,
                true,
                [...items, ...contextItems].map((c) => c.rawText || '').join('\n'),
            );
        }

        const systemPrompt = `You are a senior subtitle translation supervisor and editor.
${showLine}Target Language: ${targetLangPrompt}
${synopsisLine}
Review the dialogue translations for consistency of character names, terminology, and tone.
${glossaryBlock}CRITICAL JSON OUTPUT RULES:
- Output strictly a single JSON object without markdown fences, explanation, or commentary.
- Ensure all double quotes inside string values are properly escaped with backslashes (e.g. \\"quote\\"). Never leave raw unescaped double quotes inside translations.
- Do NOT include trailing commas.

JSON Schema:
{
  "corrections": { "cueId": "improved translation" },
  "new_characters": { "Original Name": { "canonical": "Target Name", "aliases": ["new_alias"] } },
  "new_terms": { "Term": "Translation" }
}

Guidelines for corrections:
- Only provide corrections for cues that have accuracy, terminology, name consistency, or tone issues.

Guidelines for new_characters and new_terms:
- Actively identify and extract any recurring character names, nicknames, locations, proper nouns, and specialized terms from the dialogues.
- If an entity or term is not yet registered in the glossary above, you MUST extract it and provide its canonical translation in "new_characters" or "new_terms".
- For Master characters: do NOT modify their canonical translation, but you CAN discover and report newly spoken aliases for them under "new_characters".
- For Established items: you may suggest refined translations, add aliases, or correct inconsistencies.
- Do NOT output placeholder entries like "Original Name", "Target Name", or "Term". Leave objects empty if no new entities are found.`;

        const userPrompt = `${contextBlock}Dialogues to Review:\n${dialoguesText}`;

        try {
            const rawContent = await this.llmService.callChat('supervisor', {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.1,
                jsonMode: true,
                signal,
            });

            const parsed = this.parseSupervisorJson(rawContent);

            const corrections: Record<number, string> = {};
            if (parsed.corrections && typeof parsed.corrections === 'object') {
                for (const [k, v] of Object.entries(parsed.corrections)) {
                    if (typeof v !== 'string') continue;
                    const cleaned = this.cleanTranslationText(v);
                    const trimmedKey = k.trim();
                    const groupForKey = mergedGroupByKey.get(trimmedKey);
                    if (groupForKey && groupForKey.length > 1) {
                        const splitMap =
                            await this.splitSingleMergedTranslation(
                                groupForKey,
                                cleaned,
                                targetLangPrompt,
                                signal,
                            );
                        for (const [idStr, part] of Object.entries(splitMap)) {
                            corrections[parseInt(idStr, 10)] = part;
                        }
                        continue;
                    }
                    const numId = parseInt(trimmedKey, 10);
                    if (!isNaN(numId)) {
                        corrections[numId] = cleaned;
                    }
                }
            }

            const { newCharacters, newTerms } =
                this.normalizeExtractedGlossary(parsed);

            return {
                success: true,
                corrections,
                newCharacters,
                newTerms,
            };
        } catch (err: unknown) {
            this.logger.warn(
                'LLM Translation',
                'Supervisor Review LLM call failed:',
                err,
            );
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    /**
     * Algorithmic heuristic fallback for ASR segment merging
     */
    private algorithmicMergeAsr(
        items: MergeAsrCueItem[],
    ): MergeAsrBatchResponse {
        try {
            const mergedCues = AsrSegmentationHelper.algorithmicMerge(
                items,
                this.silenceThresholdMs,
                this.logger,
            );
            return { success: true, mergedCues };
        } catch (err: unknown) {
            this.logger.error('Translator', 'algorithmicMergeAsr failed:', err);
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    /**
     * Intelligently groups and merges fragmented ASR subtitle segments using the Supervisor LLM,
     * with algorithmic fallback on failure.
     */
    async mergeAsrBatch(
        req: MergeAsrBatchRequest,
    ): Promise<MergeAsrBatchResponse> {
        const { items, signal } = req;
        if (!items || items.length === 0)
            return { success: true, mergedCues: [] };

        const minId = items[0].id;
        const maxId = items[items.length - 1].id;

        const lines = items
            .map((it) => `[${it.id}] ${it.rawText.replace(/\n+/g, ' ').trim()}`)
            .join('\n');

        const systemPrompt = `You are an expert subtitle segmentation supervisor.
Your task is to group consecutive fragmented ASR subtitle segments into natural, readable subtitle display units.

CRITICAL SUBTITLE RULES:
1. SUBTITLE UNIT LENGTH:
   - Each subtitle unit MUST be concise and comfortable to read (target: 6 to 12 words, or 15 to 25 CJK characters).
   - Maximum duration per unit: at most 4.0 to 5.0 seconds.
   - NEVER merge multiple independent clauses or long compound thoughts into a single giant subtitle (> 5.5s or > 14 words).
   - If a sentence is long, split it naturally at conjunctions (e.g., "and", "but", "so", "because", "then") or pauses.
2. COMPLETENESS & CONTINUITY:
   - Every input line ID from ${minId} to ${maxId} MUST be included in exactly one continuous range [start_id, end_id].
   - Do not reorder, skip, or omit any line IDs.
3. OUTPUT FORMAT:
   - Output strictly a single JSON object in this format:
     {"ranges": [[start_id, end_id], ...]}`;

        try {
            this.logger.info(
                'ASR-Merge',
                `[LLM Supervisor] Requesting sentence segmentation for ${items.length} raw fragments [${minId}..${maxId}] (${items[0].startTime.toFixed(2)}s - ${items[items.length - 1].endTime.toFixed(2)}s)...`,
            );

            const rawContent = await this.llmService.callChat('supervisor', {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: lines },
                ],
                temperature: 0.1,
                jsonMode: true,
                signal,
            });

            const parsed = this.parseSupervisorJson(rawContent);
            if (
                parsed &&
                Array.isArray(parsed.ranges) &&
                parsed.ranges.length > 0
            ) {
                this.logger.info(
                    'ASR-Merge',
                    `[LLM Supervisor] LLM returned ${parsed.ranges.length} ranges: ${JSON.stringify(parsed.ranges)}`,
                );

                const mergedCues = AsrSegmentationHelper.postProcessLlmRanges(
                    parsed.ranges,
                    items,
                    this.silenceThresholdMs,
                    this.logger,
                );

                if (mergedCues.length > 0) {
                    return { success: true, mergedCues };
                }
            }
        } catch (err: unknown) {
            this.logger.warn(
                'Translator',
                'LLM ASR merge failed, falling back to algorithmic merge:',
                err,
            );
        }

        // Fallback to programmatic merge
        this.logger.info(
            'ASR-Merge',
            `[Fallback] Using algorithmic ASR merge for ${items.length} fragments...`,
        );
        return this.algorithmicMergeAsr(items);
    }

    async checkHealth(): Promise<HealthCheckResult> {
        try {
            const translatorClient =
                await this.llmService.getClient('translator');
            const translatorRes = await translatorClient.checkConnection();
            const supervisorClient =
                await this.llmService.getClient('supervisor');
            const supervisorRes = await supervisorClient.checkConnection();
            return {
                ok: translatorRes.ok && supervisorRes.ok,
                message:
                    translatorRes.message ||
                    `Connected (${translatorRes.models?.length || 0} models available)`,
            };
        } catch (e: unknown) {
            return {
                ok: false,
                message:
                    e instanceof Error
                        ? e.message
                        : 'Connection check failed',
            };
        }
    }
}
