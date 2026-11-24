import {
    Context,
    ContextDTO,
    EpisodeContext,
} from '@shared/domain/entities/Context';
import {
    CharacterGlossaryMap,
    TermGlossaryMap,
} from '@shared/domain/entities/Glossary';
import { ContentBackgroundBus } from '@shared/infrastructure/bus/ContentBackgroundBus';
import { IBrowserStorage } from '@shared/infrastructure/storage/IBrowserStorage';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { LanguageInfo } from '@shared/domain/value-objects/Language';
import NCW_CONSTANTS from '@shared/utils/constants';
import { Logger } from '@shared/utils/logger';
import { LlmService } from './LlmService';

export class GlossaryService {
    private static instance: GlossaryService | null = null;
    private showContextMap: Map<string, Context> = new Map(); // string means cache key, see getCacheKey
    private tabContextMap: Map<number, string> = new Map(); // number means tab id, string means showContextMap id.
    private storage: IBrowserStorage;

    private logger: Logger = new Logger('GlossaryService');

    private constructor(
        storage: IBrowserStorage = BrowserStorageFactory.getStorage(),
    ) {
        this.storage = storage;
    }

    static getInstance(storage?: IBrowserStorage): GlossaryService {
        if (!GlossaryService.instance) {
            GlossaryService.instance = new GlossaryService(storage);
        }
        return GlossaryService.instance;
    }

    bindTabContext(tabId?: number, context?: Context): void {
        this.logger.info(
            'Glossary',
            `Bind tab to context: tab ${tabId} - context ${context?.showId} - ${context?.targetLanguage.code}`,
        );
        if (
            tabId === undefined ||
            context === undefined ||
            context.showId === undefined ||
            !context.showId ||
            context.targetLanguage === undefined
        )
            return;
        const showKey = this.getCacheKey(
            context.targetLanguage,
            context.showId,
        );
        this.tabContextMap.set(tabId, showKey);
    }

    getContextForTab(tabId?: number): Context | null {
        this.logger.info('Glossary', `Get context for tab ${tabId}`);
        if (tabId === undefined) return null;
        this.logger.info(
            'Glossary',
            `Get context for tab and the tab context map is ${JSON.stringify(this.tabContextMap, null, 2)}, and the show context map is ${JSON.stringify(this.showContextMap)}`,
        );
        if (this.tabContextMap.has(tabId)) {
            const showContextId = this.tabContextMap.get(tabId);
            if (showContextId === undefined) return null;
            if (this.showContextMap.has(showContextId)) {
                return this.showContextMap.get(showContextId) ?? null;
            }
        }
        return null;
    }

    unbindTabContext(tabId?: number): void {
        this.logger.info('Glossary', `Unbind tab context for ${tabId}`);
        if (tabId === undefined) return;
        this.tabContextMap.delete(tabId);
    }

    private getCacheKey(lang: LanguageInfo | null, showId: string): string {
        if (lang === undefined || !lang)
            this.logger.error(
                'Glossary',
                `ShowId: ${showId} wants to use a undefined/null language to generate a cache key! Someone must make some mistakes!`,
            );
        const showIdStr = showId;
        const langStr = lang ? lang.code : 'unknown';

        return `ncw_show_${showIdStr}_${langStr}`;
    }

    async initialize(): Promise<void> {
        // try {
        //   const all = await this.storage.get<Record<string, unknown>>(null);
        //   if (all && typeof all === 'object') {
        //     for (const [key, val] of Object.entries(all)) {
        //       if (key.startsWith('ctx_') && val && typeof val === 'object') {
        //         this.showContextMap.set(key, Context.fromDTO(val));
        //       }
        //     }
        //   }
        // } catch (err) {
        //   this.logger.error('Failed to initialize context map from storage', err);
        // }
    }

    async getContextForShow(
        showId: string,
        targetLanguage: LanguageInfo,
    ): Promise<Context | null> {
        const key = this.getCacheKey(targetLanguage, showId);
        let ctx = this.showContextMap.get(key);
        if (!ctx) {
            const res = await this.storage.get<ContextDTO>([key]);
            if (res[key]) {
                ctx = Context.fromDTO(res[key]);
                this.showContextMap.set(key, ctx);
            }
        }
        return ctx || null;
    }

    async getOrCreateContext(params: {
        showId: string;
        targetLanguage: LanguageInfo;
        title?: string;
        mainTitle?: string;
        showSynopsis?: string;
        episodeSynopsis?: string;
        episodeId?: string;
        episodeNumber?: string;
        seasonId?: string;
    }): Promise<Context> {
        const {
            showId,
            targetLanguage,
            title,
            mainTitle,
            showSynopsis,
            episodeSynopsis,
            episodeId,
            episodeNumber,
            seasonId,
        } = params;
        const existing = await this.getContextForShow(showId, targetLanguage);
        if (existing) {
            return existing;
        }

        const newContext = new Context({
            showId,
            title: title || '',
            mainTitle: mainTitle || '',
            targetLanguage,
            showSynopsis,
            episodes: [],
            characters: {},
            manualSetupCharacters: {},
            terms: {},
            manualSetupTerms: {},
            termVersions: {},
            isWarmedUp: false,
            updatedAt: Date.now(),
        });

        if (episodeId !== undefined) {
            const newEpisodeContext: EpisodeContext = {
                seasonId: seasonId || 'unknown',
                videoId: episodeId,
                episodeNumber: episodeNumber,
                title: title,
                synopsis: episodeSynopsis || 'unknown',
            };
            newContext.episodes.push(newEpisodeContext);
        }

        const key = this.getCacheKey(targetLanguage, showId);

        this.showContextMap.set(key, newContext);
        await this.storage.set({ [key]: newContext.toDTO() });
        return newContext;
    }

    async updateWarmupContext(params: {
        showId: string;
        targetLanguage: LanguageInfo;
        title?: string;
        mainTitle?: string;
        showSynopsis?: string;
        episode?: {
            seasonId: string;
            videoId: string;
            episodeNumber?: string;
            title?: string;
            synopsis: string;
        };
        known?: boolean;
        characters?: CharacterGlossaryMap;
        terms?: TermGlossaryMap;
        role?: 'translator' | 'supervisor';
    }): Promise<Context> {
        const {
            showId,
            targetLanguage,
            title,
            mainTitle,
            showSynopsis,
            episode,
            known,
            characters,
            terms,
            role = 'translator',
        } = params;
        this.logger.info(
            'Glossary',
            `Update warm up context for show ${showId} targetLanguage ${targetLanguage.code}`,
        );
        const key = this.getCacheKey(targetLanguage, showId);
        const base = await this.getOrCreateContext({
            showId,
            targetLanguage,
            title,
            mainTitle,
            showSynopsis,
        });

        const resolved = await this.normalizeAndResolveGlossary({
            base,
            incomingCharacters: characters || {},
            incomingTerms: terms || {},
            role,
            isManual: false,
        });

        const merged = base.mergeDiscoveredGlossary(
            resolved.characters,
            resolved.terms,
        );

        const patchedTerms: TermGlossaryMap = { ...merged.terms };
        for (const [termKey, termVal] of Object.entries(
            resolved.correctedExistingTerms,
        )) {
            if (!base.manualSetupTerms[termKey]) {
                patchedTerms[termKey] = termVal;
            }
        }

        const episodes = [...merged.episodes];
        if (episode && episode.videoId) {
            const idx = episodes.findIndex(
                (e) => e.videoId === episode.videoId,
            );
            if (idx >= 0) {
                episodes[idx] = { ...episodes[idx], ...episode };
            } else {
                episodes.push(episode);
            }
        }

        const updatedContext = new Context({
            ...merged.toDTO(),
            terms: patchedTerms,
            showId,
            title: title || merged.title,
            mainTitle: mainTitle || merged.mainTitle,
            targetLanguage,
            showSynopsis:
                showSynopsis !== undefined && showSynopsis !== ''
                    ? showSynopsis
                    : merged.showSynopsis,
            episodes,
            known: known ?? merged.known,
            isWarmedUp: true,
            updatedAt: Date.now(),
        });

        this.showContextMap.set(key, updatedContext);
        await this.persistAndBroadcast(updatedContext);
        return updatedContext;
    }

    async updateManualTerm(
        showId: string,
        targetLanguage: LanguageInfo,
        key: string,
        value: string,
    ): Promise<Context | null> {
        const cacheKey = this.getCacheKey(targetLanguage, showId);
        let current = this.showContextMap.get(cacheKey);
        if (!current) {
            current =
                (await this.getContextForShow(showId, targetLanguage)) ??
                undefined;
        }
        if (!current) {
            this.logger.error(
                'Glossary',
                'we cannot update manual term without context found!, showId: ',
                showId,
                ', targetLanguage: ',
                targetLanguage,
                ', key: ',
                key,
                ', value: ',
                value,
            );
            throw Error(
                `we cannot update manual term without context found for showId: ${showId}`,
            );
        }

        const resolved = await this.normalizeAndResolveGlossary({
            base: current,
            incomingCharacters: {},
            incomingTerms: { [key]: value },
            role: 'translator',
            isManual: true,
        });

        let updated = current;
        for (const [charName, charItem] of Object.entries(resolved.characters)) {
            updated = updated.updateCharacter(
                charName,
                charItem.canonical,
                [],
            );
        }
        for (const [termKey, termVal] of Object.entries(resolved.terms)) {
            updated = updated.updateTerm(termKey, termVal);
        }
        this.showContextMap.set(cacheKey, updated);
        await this.persistAndBroadcast(updated);
        return updated;
    }

    async deleteTerm(
        showId: string,
        targetLanguage: LanguageInfo,
        key: string,
    ): Promise<Context> {
        const cacheKey = this.getCacheKey(targetLanguage, showId);
        let current = this.showContextMap.get(cacheKey);
        if (!current) {
            current =
                (await this.getContextForShow(showId, targetLanguage)) ??
                undefined;
        }
        if (!current) {
            this.logger.error(
                'Glossary',
                'we cannot delete manual term without context found!, showId: ',
                showId,
                ', targetLanguage: ',
                targetLanguage,
                ', key: ',
                key,
            );
            throw new Error(`Context not found for showId: ${showId}`);
        }

        const updated = current.deleteTerm(key);
        this.showContextMap.set(cacheKey, updated);
        await this.persistAndBroadcast(updated);
        return updated;
    }

    async updateCharacter(
        showId: string,
        targetLanguage: LanguageInfo,
        name: string,
        canonical: string,
        aliases: string[] = [],
    ): Promise<Context> {
        const cacheKey = this.getCacheKey(targetLanguage, showId);
        let current = this.showContextMap.get(cacheKey);
        if (!current) {
            current =
                (await this.getContextForShow(showId, targetLanguage)) ??
                undefined;
        }
        if (!current) {
            this.logger.error(
                'Glossary',
                'we cannot update character without context found!, showId: ',
                showId,
                ', targetLanguage: ',
                targetLanguage,
                ', name: ',
                name,
                ', canonical: ',
                canonical,
                ', aliases: ',
                aliases,
            );
            throw new Error(`Context not found for showId: ${showId}`);
        }

        const resolved = await this.normalizeAndResolveGlossary({
            base: current,
            incomingCharacters: {
                [name]: { canonical, aliases, setByUser: true },
            },
            incomingTerms: {},
            role: 'translator',
            isManual: true,
        });

        let updated = current;
        for (const [charName, charItem] of Object.entries(resolved.characters)) {
            updated = updated.updateCharacter(
                charName,
                charItem.canonical,
                [],
            );
        }
        for (const [termKey, termVal] of Object.entries(resolved.terms)) {
            updated = updated.updateTerm(termKey, termVal);
        }
        this.showContextMap.set(cacheKey, updated);
        await this.persistAndBroadcast(updated);
        return updated;
    }

    async deleteCharacter(
        showId: string,
        targetLanguage: LanguageInfo,
        name: string,
    ): Promise<Context> {
        const cacheKey = this.getCacheKey(targetLanguage, showId);
        let current = this.showContextMap.get(cacheKey);
        if (!current) {
            current =
                (await this.getContextForShow(showId, targetLanguage)) ??
                undefined;
        }
        if (!current) {
            this.logger.error(
                'Glossary',
                'we cannot delete character without context found!, showId: ',
                showId,
                ', targetLanguage: ',
                targetLanguage,
                ', name: ',
                name,
            );
            throw new Error(`Context not found for showId: ${showId}`);
        }

        const updated = current.deleteCharacter(name);
        this.showContextMap.set(cacheKey, updated);
        await this.persistAndBroadcast(updated);
        return updated;
    }

    async bulkUpdateGlossary(params: {
        showId: string;
        targetLanguage: LanguageInfo;
        characters?: CharacterGlossaryMap;
        terms?: TermGlossaryMap;
    }): Promise<Context> {
        const { showId, targetLanguage, characters, terms } = params;
        const cacheKey = this.getCacheKey(targetLanguage, showId);
        let current = this.showContextMap.get(cacheKey);
        if (!current) {
            current =
                (await this.getContextForShow(showId, targetLanguage)) ??
                undefined;
        }
        if (!current) {
            this.logger.error(
                'Glossary',
                'we cannot bulk update glossary without context found!, showId: ',
                showId,
                ', targetLanguage: ',
                targetLanguage,
            );
            throw new Error(`Context not found for showId: ${showId}`);
        }

        const resolved = await this.normalizeAndResolveGlossary({
            base: current,
            incomingCharacters: characters || {},
            incomingTerms: terms || {},
            role: 'translator',
            isManual: true,
        });

        let updated = current;
        for (const [name, char] of Object.entries(resolved.characters)) {
            updated = updated.updateCharacter(
                name,
                char.canonical || name,
                [],
            );
        }

        for (const [k, v] of Object.entries(resolved.terms)) {
            updated = updated.updateTerm(k, v);
        }

        this.showContextMap.set(cacheKey, updated);
        await this.persistAndBroadcast(updated);
        return updated;
    }

    /**
     * Programmatically flattens aliases into standalone entries and verifies
     * substring-key translation consistency in a single batched LLM call.
     */
    private async normalizeAndResolveGlossary(params: {
        base: Context;
        incomingCharacters: CharacterGlossaryMap;
        incomingTerms: TermGlossaryMap;
        role: 'translator' | 'supervisor';
        isManual: boolean;
    }): Promise<{
        characters: CharacterGlossaryMap;
        terms: TermGlossaryMap;
        correctedExistingTerms: TermGlossaryMap;
    }> {
        const { base, incomingCharacters, incomingTerms, role, isManual } =
            params;

        const cleanedChars: CharacterGlossaryMap = {};
        const cleanedTerms: TermGlossaryMap = {};
        const correctedExistingTerms: TermGlossaryMap = {};

        const existingChars = base.getEffectiveCharacters();
        const existingTerms = base.getEffectiveTerms();

        const rawAliasCandidates: Array<{
            alias: string;
            parentName: string;
            parentCanonical: string;
        }> = [];

        for (const [rawName, char] of Object.entries(incomingCharacters)) {
            const name = rawName.trim();
            if (!name) continue;
            const canonical = (char?.canonical || name).trim();
            cleanedChars[name] = {
                canonical,
                aliases: [],
                setByUser: isManual ? true : char?.setByUser,
            };

            const aliases = Array.isArray(char?.aliases) ? char.aliases : [];
            for (const rawAlias of aliases) {
                if (typeof rawAlias !== 'string') continue;
                const alias = rawAlias.trim();
                if (!alias || alias === name || alias === canonical) continue;
                rawAliasCandidates.push({
                    alias,
                    parentName: name,
                    parentCanonical: canonical,
                });
            }
        }

        for (const [rawKey, rawVal] of Object.entries(incomingTerms)) {
            const key = rawKey.trim();
            if (!key || typeof rawVal !== 'string' || !rawVal.trim()) continue;
            cleanedTerms[key] = rawVal.trim();
        }

        const seenAliases = new Set<string>();
        const aliasTasks = rawAliasCandidates.filter(({ alias }) => {
            if (seenAliases.has(alias)) return false;
            if (cleanedChars[alias] || existingChars[alias]) return false;
            seenAliases.add(alias);
            return true;
        });

        type UnifiedEntry = {
            key: string;
            trans: string;
            kind: 'character' | 'term';
            isManualLocked: boolean;
            isExistingTerm: boolean;
        };

        const unified = new Map<string, UnifiedEntry>();
        for (const [k, v] of Object.entries(existingChars)) {
            if (v?.canonical?.trim()) {
                unified.set(k, {
                    key: k,
                    trans: v.canonical.trim(),
                    kind: 'character',
                    isManualLocked:
                        !isManual && Boolean(base.manualSetupCharacters[k]),
                    isExistingTerm: false,
                });
            }
        }
        for (const [k, v] of Object.entries(existingTerms)) {
            if (typeof v === 'string' && v.trim() && !unified.has(k)) {
                unified.set(k, {
                    key: k,
                    trans: v.trim(),
                    kind: 'term',
                    isManualLocked:
                        !isManual && Boolean(base.manualSetupTerms[k]),
                    isExistingTerm: true,
                });
            }
        }
        for (const [k, v] of Object.entries(cleanedChars)) {
            unified.set(k, {
                key: k,
                trans: v.canonical,
                kind: 'character',
                isManualLocked:
                    !isManual && Boolean(base.manualSetupCharacters[k]),
                isExistingTerm: false,
            });
        }
        for (const [k, v] of Object.entries(cleanedTerms)) {
            unified.set(k, {
                key: k,
                trans: v,
                kind: 'term',
                isManualLocked: !isManual && Boolean(base.manualSetupTerms[k]),
                isExistingTerm: false,
            });
        }

        const normalizeForMatch = (s: string): string =>
            s.replace(/\s+/g, '').toLowerCase();
        const isEligibleSubKey = (normKey: string): boolean =>
            normKey.length >= 2 ||
            /[\u3040-\u30ff\u4e00-\u9faf\uac00-\ud7af]/.test(normKey);

        const incomingKeys = new Set<string>([
            ...Object.keys(cleanedChars),
            ...Object.keys(cleanedTerms),
        ]);
        const allEntries = Array.from(unified.values());
        const substringTasks: Array<{
            subKey: string;
            currentSubTrans: string;
            fullKey: string;
            fullTrans: string;
            kind: 'character' | 'term';
            isExistingTerm: boolean;
        }> = [];
        const queuedSubKeys = new Set<string>();

        const maybeQueuePair = (a: UnifiedEntry, b: UnifiedEntry): void => {
            const normA = normalizeForMatch(a.key);
            const normB = normalizeForMatch(b.key);
            if (!normA || !normB || normA === normB) return;

            if (!normB.includes(normA) && !normA.includes(normB)) return;

            const [sub, full]: [UnifiedEntry, UnifiedEntry] = normB.includes(
                normA,
            )
                ? [a, b]
                : [b, a];

            const normSubKey = normalizeForMatch(sub.key);
            if (!isEligibleSubKey(normSubKey)) return;
            if (sub.isManualLocked || queuedSubKeys.has(sub.key)) return;

            const normSubTrans = normalizeForMatch(sub.trans);
            const normFullTrans = normalizeForMatch(full.trans);
            if (!normSubTrans || !normFullTrans) return;

            if (
                normSubTrans === normFullTrans ||
                !normFullTrans.includes(normSubTrans)
            ) {
                queuedSubKeys.add(sub.key);
                substringTasks.push({
                    subKey: sub.key,
                    currentSubTrans: sub.trans,
                    fullKey: full.key,
                    fullTrans: full.trans,
                    kind: sub.kind,
                    isExistingTerm: sub.isExistingTerm,
                });
            }
        };

        for (const incKey of incomingKeys) {
            const incEntry = unified.get(incKey);
            if (!incEntry) continue;
            for (const other of allEntries) {
                if (other.key !== incEntry.key) {
                    maybeQueuePair(incEntry, other);
                }
            }
        }

        if (aliasTasks.length === 0 && substringTasks.length === 0) {
            return {
                characters: cleanedChars,
                terms: cleanedTerms,
                correctedExistingTerms,
            };
        }

        try {
            const promptPayload = {
                targetLanguage: `${base.targetLanguage.name} (${base.targetLanguage.code})`,
                showTitle: base.title || base.mainTitle || base.showId,
                aliasTranslations: aliasTasks,
                substringVerifications: substringTasks.map((t) => ({
                    subKey: t.subKey,
                    currentSubTrans: t.currentSubTrans,
                    fullKey: t.fullKey,
                    fullTrans: t.fullTrans,
                })),
            };

            const rawReply = await LlmService.getInstance().callChat(role, {
                messages: [
                    {
                        role: 'system',
                        content:
                            'You are a subtitle glossary normalizer. Return ONLY valid JSON with keys "aliases" (map of alias -> standalone translation) and "substrings" (map of subKey -> verified/corrected translation). ' +
                            'For "aliases": translate each alias as a standalone short name/nickname/title using parentName -> parentCanonical as reference. Do NOT over-expand a surname, given name, or short name into the full name (e.g., if "伊丹憲一" -> "伊丹宪一", then alias "伊丹" -> "伊丹"). ' +
                            'For "substrings": check each (subKey -> currentSubTrans) against (fullKey -> fullTrans). If currentSubTrans mistakenly equals fullTrans or is inconsistent with fullTrans, return the corrected shorter/consistent translation; if currentSubTrans is already a valid distinct translation (e.g. "Alex" -> "亚历克斯" vs "Alexander" -> "亚历山大"), return currentSubTrans unchanged.',
                    },
                    {
                        role: 'user',
                        content: JSON.stringify(promptPayload),
                    },
                ],
                temperature: 0.1,
                jsonMode: true,
            });

            const jsonStr = rawReply
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();
            const parsed = JSON.parse(jsonStr) as {
                aliases?: Record<string, string>;
                substrings?: Record<string, string>;
            };

            if (parsed.aliases && typeof parsed.aliases === 'object') {
                for (const task of aliasTasks) {
                    const resolved = parsed.aliases[task.alias];
                    if (typeof resolved === 'string' && resolved.trim()) {
                        cleanedChars[task.alias] = {
                            canonical: resolved.trim(),
                            aliases: [],
                            setByUser: isManual ? true : false,
                        };
                    }
                }
            }

            if (parsed.substrings && typeof parsed.substrings === 'object') {
                for (const task of substringTasks) {
                    const resolved = parsed.substrings[task.subKey];
                    if (
                        typeof resolved === 'string' &&
                        resolved.trim() &&
                        resolved.trim() !== task.currentSubTrans
                    ) {
                        const cleanVal = resolved.trim();
                        if (task.kind === 'character') {
                            cleanedChars[task.subKey] = {
                                canonical: cleanVal,
                                aliases: [],
                                setByUser: isManual ? true : false,
                            };
                        } else if (task.isExistingTerm && !isManual) {
                            correctedExistingTerms[task.subKey] = cleanVal;
                        } else {
                            cleanedTerms[task.subKey] = cleanVal;
                        }
                    }
                }
            }
        } catch (err) {
            this.logger.warn(
                'Glossary',
                `normalizeAndResolveGlossary LLM step skipped/failed (aliases still cleared): ${String(err)}`,
            );
        }

        return {
            characters: cleanedChars,
            terms: cleanedTerms,
            correctedExistingTerms,
        };
    }

    async resetContext(
        showId: string,
        targetLanguage: LanguageInfo,
    ): Promise<Context> {
        const cacheKey = this.getCacheKey(targetLanguage, showId);
        this.showContextMap.delete(cacheKey);
        await this.storage.remove([cacheKey]);

        // Clean up any tab references pointing to this show
        for (const [tabId, showContextId] of this.tabContextMap.entries()) {
            if (showContextId === cacheKey) {
                this.tabContextMap.delete(tabId);
            }
        }

        const empty = Context.createEmpty(targetLanguage);
        ContentBackgroundBus.broadcastToTabs(
            NCW_CONSTANTS.MESSAGE_TYPES.PUSH_GLOSSARY_CHANGED,
            {
                context: empty.toDTO(),
            },
        ).catch(() => {});

        return empty;
    }

    async unloadContext(
        showId: string,
        targetLanguage: LanguageInfo,
    ): Promise<void> {
        if (!showId) return;
        const cacheKey = this.getCacheKey(targetLanguage, showId);
        this.showContextMap.delete(cacheKey);

        for (const [tabId, showContextId] of this.tabContextMap.entries()) {
            if (showContextId === cacheKey) {
                this.tabContextMap.delete(tabId);
            }
        }
    }

    private async persistAndBroadcast(context: Context): Promise<void> {
        if (!context.showId) {
            this.logger.error(
                'Glossary',
                'We cannot persist context without showid! cts: ',
                context,
            );
            return;
        }
        const key = this.getCacheKey(context.targetLanguage, context.showId);
        await this.storage.set({ [key]: context.toDTO() });
        ContentBackgroundBus.broadcastToTabs(
            NCW_CONSTANTS.MESSAGE_TYPES.PUSH_GLOSSARY_CHANGED,
            {
                context: context.toDTO(),
            },
        ).catch(() => {});
    }
}
