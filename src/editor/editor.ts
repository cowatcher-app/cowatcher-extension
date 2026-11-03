/**
 * Glossary Editor Controller
 * Runs in standalone window mode to avoid Linux ibus dismiss-on-blur.
 * Supports manual table editing and dual-mode AI entity extraction.
 */

import { ContentBackgroundBus } from '@shared/infrastructure/bus/ContentBackgroundBus';
import {
    CharacterGlossaryMap,
    TermGlossaryMap,
} from '@shared/domain/entities/Glossary';
import { ContextDTO } from '@shared/domain/entities/Context';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { Logger } from '@shared/utils/logger';
import { Language, LanguageInfo } from '@shared/domain/value-objects/Language';
import NCW_CONSTANTS from '@shared/utils/constants';

const logger: Logger = new Logger('editor');

interface CharacterRowState {
    orig: string;
    canonical: string;
    aliases: string[];
    isManual?: boolean;
}

interface TermRowState {
    orig: string;
    trans: string;
    isManual?: boolean;
}

async function initEditor(): Promise<void> {
    // URL Search Parameters
    const urlParams = new URLSearchParams(window.location.search);
    let activeShowId = urlParams.get('showId') || '';
    const activeVideoId = urlParams.get('videoId') || '';
    let activeTitle = urlParams.get('title') || '';
    let activeTargetLang: LanguageInfo = Language.resolve(
        urlParams.get('targetLang') || 'en',
    );

    // DOM Elements
    const currentShowInfo = document.getElementById(
        'current-show-info',
    ) as HTMLElement;
    const contextLockBadge = document.getElementById(
        'context-lock-badge',
    ) as HTMLElement;
    const editorShowSelector = document.getElementById(
        'editor-show-selector',
    ) as HTMLSelectElement | null;
    const contextShiftBanner = document.getElementById(
        'context-shift-banner',
    ) as HTMLElement;
    const bannerTitle = document.getElementById('banner-title') as HTMLElement;
    const bannerDesc = document.getElementById('banner-desc') as HTMLElement;
    const aiStatusPill = document.getElementById(
        'ai-status-pill',
    ) as HTMLElement;
    const aiProviderHint = document.getElementById(
        'ai-provider-hint',
    ) as HTMLElement;

    const sourceRefText = document.getElementById(
        'source-reference-text',
    ) as HTMLTextAreaElement;
    const targetRefText = document.getElementById(
        'target-reference-text',
    ) as HTMLTextAreaElement;
    const sourceCharCount = document.getElementById(
        'source-char-count',
    ) as HTMLElement;
    const targetCharCount = document.getElementById(
        'target-char-count',
    ) as HTMLElement;

    const btnExtractBilingual = document.getElementById(
        'btn-extract-bilingual',
    ) as HTMLButtonElement;
    const btnExtractTranslate = document.getElementById(
        'btn-extract-translate',
    ) as HTMLButtonElement;

    const characterCount = document.getElementById(
        'character-count',
    ) as HTMLElement;
    const termCount = document.getElementById('term-count') as HTMLElement;
    const tbodyCharacters = document.getElementById(
        'tbody-characters',
    ) as HTMLElement;
    const tbodyTerms = document.getElementById('tbody-terms') as HTMLElement;

    const btnAddCharacterRow = document.getElementById(
        'btn-add-character-row',
    ) as HTMLButtonElement;
    const btnAddTermRow = document.getElementById(
        'btn-add-term-row',
    ) as HTMLButtonElement;

    const footerStatusMsg = document.getElementById(
        'footer-status-msg',
    ) as HTMLElement;
    const btnCloseWindow = document.getElementById(
        'btn-close-window',
    ) as HTMLButtonElement;
    const btnInvalidateEpisode = document.getElementById(
        'btn-invalidate-episode',
    ) as HTMLButtonElement;
    const btnInvalidateShow = document.getElementById(
        'btn-invalidate-show',
    ) as HTMLButtonElement;
    const btnSaveGlossary = document.getElementById(
        'btn-save-glossary',
    ) as HTMLButtonElement;

    // Local Editor State
    let characterRows: CharacterRowState[] = [];
    let termRows: TermRowState[] = [];
    let hasAiCapability = false;
    let loadedContextDTO: ContextDTO | null = null;

    function updateHeaderInfo(): void {
        const displayTitle =
            activeTitle || activeShowId || 'Active Streaming Playback';
        if (contextLockBadge) {
            contextLockBadge.textContent = activeTitle
                ? `🔒 Locked: ${activeTitle}`
                : activeShowId
                  ? `🔒 Show: ${activeShowId}`
                  : 'ℹ️ Manual Glossary';
        }
        if (currentShowInfo) {
            currentShowInfo.textContent = `${displayTitle} ${activeVideoId ? `(ID: ${activeVideoId})` : ''} • Target Language: ${activeTargetLang.name}`;
        }
    }

    updateHeaderInfo();

    // Character counters
    sourceRefText?.addEventListener('input', () => {
        if (sourceCharCount)
            sourceCharCount.textContent = `${sourceRefText.value.length} chars`;
        updateAiButtonsState();
    });
    targetRefText?.addEventListener('input', () => {
        if (targetCharCount)
            targetCharCount.textContent = `${targetRefText.value.length} chars`;
        updateAiButtonsState();
    });

    // 1. Check AI Capabilities
    async function checkAiCapabilities(): Promise<void> {
        try {
            const res = await ContentBackgroundBus.send(
                NCW_CONSTANTS.MESSAGE_TYPES.GET_AI_CAPABILITY,
                undefined,
            );
            if (res && res.success && res.hasAi) {
                hasAiCapability = true;
                const modelRole = res.isSupervisor
                    ? 'Supervisor Model'
                    : 'Translation Model';
                const prov = res.provider ? res.provider.toUpperCase() : 'LLM';
                if (aiStatusPill) {
                    aiStatusPill.className = 'ai-status-pill badge-active';
                    aiStatusPill.textContent = `✓ ${prov} Ready`;
                }
                if (aiProviderHint) {
                    aiProviderHint.textContent = `Using ${modelRole}: ${res.model || 'Default'}`;
                }
            } else {
                hasAiCapability = false;
                if (aiStatusPill) {
                    aiStatusPill.className = 'ai-status-pill badge-warning';
                    aiStatusPill.textContent = '⚠️ No AI Provider';
                }
                if (aiProviderHint) {
                    aiProviderHint.textContent =
                        'AI extraction requires Ollama or OpenRouter configured in settings.';
                }
            }
        } catch {
            hasAiCapability = false;
            if (aiStatusPill) {
                aiStatusPill.className = 'ai-status-pill badge-warning';
                aiStatusPill.textContent = 'Offline';
            }
            if (aiProviderHint) {
                aiProviderHint.textContent =
                    'Could not communicate with background service.';
            }
        }
        updateAiButtonsState();
    }

    function updateAiButtonsState(): void {
        if (
            !sourceRefText ||
            !targetRefText ||
            !btnExtractBilingual ||
            !btnExtractTranslate
        )
            return;
        const srcLen = (sourceRefText.value || '').trim().length;
        const tgtLen = (targetRefText.value || '').trim().length;

        if (!hasAiCapability) {
            btnExtractBilingual.disabled = true;
            btnExtractTranslate.disabled = true;
            btnExtractBilingual.title =
                'AI Provider (Ollama or OpenRouter) required';
            btnExtractTranslate.title =
                'AI Provider (Ollama or OpenRouter) required';
            return;
        }

        // Bilingual requires both source & target
        btnExtractBilingual.disabled = srcLen === 0 || tgtLen === 0;
        btnExtractBilingual.title =
            srcLen > 0 && tgtLen > 0
                ? 'Align official translations across both reference texts'
                : 'Please fill in both Source and Target reference texts';

        // Monolingual + Translate requires source text
        btnExtractTranslate.disabled = srcLen === 0;
        btnExtractTranslate.title =
            srcLen > 0
                ? `Extract entities from Source and translate into ${activeTargetLang.name}`
                : 'Please fill in Source reference text';
    }

    // 2. Load Existing Glossary Context
    async function loadContextData(): Promise<void> {
        try {
            if (!activeShowId && !activeVideoId) {
                await tryLoadStoredShows();
            }

            if (!activeShowId && !activeVideoId) {
                renderTables();
                return;
            }

            const res = await ContentBackgroundBus.send(
                NCW_CONSTANTS.MESSAGE_TYPES.GET_CONTEXT,
                {
                    showId: activeShowId || activeVideoId,
                    targetLanguage: activeTargetLang,
                },
            );

            if (res && res.success && res.context) {
                const ctx: ContextDTO = res.context;
                loadedContextDTO = ctx;
                if (ctx.targetLanguage) {
                    activeTargetLang = Language.resolve(ctx.targetLanguage);
                }
                if (ctx.mainTitle || ctx.title) {
                    activeTitle = ctx.mainTitle || ctx.title || activeTitle;
                }
                updateHeaderInfo();

                // Populate Character Rows
                characterRows = [];
                if (ctx.characters && typeof ctx.characters === 'object') {
                    for (const [name, val] of Object.entries(ctx.characters)) {
                        if (typeof val === 'string') {
                            characterRows.push({
                                orig: name,
                                canonical: val,
                                aliases: [],
                                isManual: true,
                            });
                        } else if (val && typeof val === 'object') {
                            characterRows.push({
                                orig: name,
                                canonical: val.canonical || name,
                                aliases: Array.isArray(val.aliases)
                                    ? val.aliases
                                    : [],
                                isManual: Boolean(val.setByUser),
                            });
                        }
                    }
                }

                // Populate Term Rows
                termRows = [];
                if (ctx.terms && typeof ctx.terms === 'object') {
                    for (const [term, data] of Object.entries(ctx.terms)) {
                        if (typeof data === 'string') {
                            termRows.push({
                                orig: term,
                                trans: data,
                                isManual: true,
                            });
                        } else if (data && typeof data === 'object') {
                            const item = data as Record<string, unknown>;
                            termRows.push({
                                orig: term,
                                trans: String(
                                    item.trans || item.translation || '',
                                ),
                                isManual: Boolean(item.setByUser),
                            });
                        }
                    }
                }
            }
        } catch (e) {
            logger.warn('editor', 'Failed to load glossary context:', e);
        } finally {
            renderTables();
        }
    }

    async function tryLoadStoredShows(): Promise<void> {
        try {
            const storage = BrowserStorageFactory.getStorage();
            const all = await storage.get<Record<string, unknown>>(null);
            const showEntries: Array<{
                showId: string;
                title: string;
                lang: string;
                updatedAt: number;
                ctx: ContextDTO;
            }> = [];

            for (const [key, val] of Object.entries(all || {})) {
                if (
                    key.startsWith('ncw_show_') &&
                    val &&
                    typeof val === 'object'
                ) {
                    const dto = val as unknown as ContextDTO;
                    if (dto.showId) {
                        const langCode =
                            typeof dto.targetLanguage === 'object' &&
                            dto.targetLanguage
                                ? (dto.targetLanguage as { code?: string })
                                      .code || 'en'
                                : String(dto.targetLanguage || 'en');
                        showEntries.push({
                            showId: dto.showId,
                            title: dto.mainTitle || dto.title || dto.showId,
                            lang: langCode,
                            updatedAt: dto.updatedAt || 0,
                            ctx: dto,
                        });
                    }
                }
            }

            if (showEntries.length > 0) {
                showEntries.sort((a, b) => b.updatedAt - a.updatedAt);
                if (editorShowSelector) {
                    editorShowSelector.style.display = 'inline-block';
                    editorShowSelector.innerHTML = showEntries
                        .map(
                            (s) =>
                                `<option value="${escapeHtml(s.showId)}" data-title="${escapeHtml(s.title)}" data-lang="${escapeHtml(s.lang)}">${escapeHtml(s.title)} (${escapeHtml(s.lang)})</option>`,
                        )
                        .join('');

                    editorShowSelector.addEventListener('change', () => {
                        const selectedOpt =
                            editorShowSelector.selectedOptions[0];
                        if (selectedOpt) {
                            activeShowId = selectedOpt.value;
                            activeTitle = selectedOpt.dataset.title || '';
                            activeTargetLang = Language.resolve(
                                selectedOpt.dataset.lang || 'en',
                            );
                            loadContextData();
                        }
                    });
                }

                activeShowId = showEntries[0].showId;
                activeTitle = showEntries[0].title;
                activeTargetLang = Language.resolve(showEntries[0].lang);
                updateHeaderInfo();
            } else {
                updateHeaderInfo();
            }
        } catch (err) {
            logger.warn('editor', 'Failed scanning stored shows:', err);
        }
    }

    // 3. Render Tables
    function renderTables(): void {
        // Characters
        characterCount.textContent = String(characterRows.length);
        tbodyCharacters.innerHTML = '';
        if (characterRows.length === 0) {
            const tr = document.createElement('tr');
            tr.className = 'empty-table-row';
            tr.innerHTML = '<td colspan="4" class="empty-table-msg">No characters defined yet.<br>Click <strong>+ Add Character</strong> above to create one, or paste text in <strong>AI Reference & Extraction</strong> above.</td>';
            tbodyCharacters.appendChild(tr);
        } else {
            characterRows.forEach((row, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
          <td>
            <input type="text" class="table-input input-char-orig" data-index="${index}" value="${escapeHtml(row.orig)}" placeholder="e.g. Shoko">
          </td>
          <td>
            <input type="text" class="table-input input-char-canonical" data-index="${index}" value="${escapeHtml(row.canonical)}" placeholder="e.g. Shoko Nishimiya">
          </td>
          <td>
            <input type="text" class="table-input input-char-aliases" data-index="${index}" value="${escapeHtml(row.aliases.join(', '))}" placeholder="e.g. Shouko, Nishimiya">
          </td>
          <td style="text-align: center;">
            <button class="btn-icon-del btn-del-char" data-index="${index}" title="Delete character">✕</button>
          </td>
        `;
                tbodyCharacters.appendChild(tr);
            });
        }

        // Terms
        termCount.textContent = String(termRows.length);
        tbodyTerms.innerHTML = '';
        if (termRows.length === 0) {
            const tr = document.createElement('tr');
            tr.className = 'empty-table-row';
            tr.innerHTML = '<td colspan="3" class="empty-table-msg">No specialized terms defined yet.<br>Click <strong>+ Add Term</strong> above to create one, or paste text in <strong>AI Reference & Extraction</strong> above.</td>';
            tbodyTerms.appendChild(tr);
        } else {
            termRows.forEach((row, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
          <td>
            <input type="text" class="table-input input-term-orig" data-index="${index}" value="${escapeHtml(row.orig)}" placeholder="e.g. Survey Corps">
          </td>
          <td>
            <input type="text" class="table-input input-term-trans" data-index="${index}" value="${escapeHtml(row.trans)}" placeholder="e.g. Scout Regiment">
          </td>
          <td style="text-align: center;">
            <button class="btn-icon-del btn-del-term" data-index="${index}" title="Delete term">✕</button>
          </td>
        `;
                tbodyTerms.appendChild(tr);
            });
        }
    }

    function syncInputsToState(): void {
        // Collect character inputs
        const charOrigInputs = tbodyCharacters.querySelectorAll(
            '.input-char-orig',
        ) as NodeListOf<HTMLInputElement>;
        const charCanonInputs = tbodyCharacters.querySelectorAll(
            '.input-char-canonical',
        ) as NodeListOf<HTMLInputElement>;
        const charAliasInputs = tbodyCharacters.querySelectorAll(
            '.input-char-aliases',
        ) as NodeListOf<HTMLInputElement>;

        charOrigInputs.forEach((input, i) => {
            if (characterRows[i]) {
                characterRows[i].orig = input.value.trim();
                characterRows[i].canonical =
                    charCanonInputs[i]?.value.trim() || '';
                characterRows[i].aliases = (charAliasInputs[i]?.value || '')
                    .split(',')
                    .map((a) => a.trim())
                    .filter(Boolean);
            }
        });

        // Collect term inputs
        const termOrigInputs = tbodyTerms.querySelectorAll(
            '.input-term-orig',
        ) as NodeListOf<HTMLInputElement>;
        const termTransInputs = tbodyTerms.querySelectorAll(
            '.input-term-trans',
        ) as NodeListOf<HTMLInputElement>;

        termOrigInputs.forEach((input, i) => {
            if (termRows[i]) {
                termRows[i].orig = input.value.trim();
                termRows[i].trans = termTransInputs[i]?.value.trim() || '';
            }
        });
    }

    // 4. Add & Delete Row Handlers
    btnAddCharacterRow.addEventListener('click', () => {
        syncInputsToState();
        characterRows.push({
            orig: '',
            canonical: '',
            aliases: [],
            isManual: true,
        });
        renderTables();
        const newInputs = tbodyCharacters.querySelectorAll('.input-char-orig');
        (newInputs[newInputs.length - 1] as HTMLInputElement)?.focus();
    });

    btnAddTermRow.addEventListener('click', () => {
        syncInputsToState();
        termRows.push({ orig: '', trans: '', isManual: true });
        renderTables();
        const newInputs = tbodyTerms.querySelectorAll('.input-term-orig');
        (newInputs[newInputs.length - 1] as HTMLInputElement)?.focus();
    });

    tbodyCharacters.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('btn-del-char')) {
            const idx = parseInt(target.getAttribute('data-index') || '-1', 10);
            if (idx >= 0 && idx < characterRows.length) {
                syncInputsToState();
                characterRows.splice(idx, 1);
                renderTables();
            }
        }
    });

    tbodyTerms.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('btn-del-term')) {
            const idx = parseInt(target.getAttribute('data-index') || '-1', 10);
            if (idx >= 0 && idx < termRows.length) {
                syncInputsToState();
                termRows.splice(idx, 1);
                renderTables();
            }
        }
    });

    // 5. AI Extraction Actions (Smart Non-Destructive Merge)
    function mergeExtractedResult(extracted: {
        characters: CharacterGlossaryMap;
        terms: TermGlossaryMap;
    }): void {
        syncInputsToState();

        // Map of existing names (lowercase) to avoid overwriting user rows
        const existingCharMap = new Set<string>();
        characterRows.forEach((r) => {
            if (r.orig) existingCharMap.add(r.orig.toLowerCase());
        });

        let newCharsAdded = 0;
        for (const [name, char] of Object.entries(extracted.characters || {})) {
            const lower = name.trim().toLowerCase();
            if (!lower) continue;
            if (!existingCharMap.has(lower)) {
                characterRows.push({
                    orig: name.trim(),
                    canonical: char.canonical?.trim() || name.trim(),
                    aliases: Array.isArray(char.aliases) ? char.aliases : [],
                    isManual: false,
                });
                existingCharMap.add(lower);
                newCharsAdded++;
            }
        }

        const existingTermMap = new Set<string>();
        termRows.forEach((r) => {
            if (r.orig) existingTermMap.add(r.orig.toLowerCase());
        });

        let newTermsAdded = 0;
        for (const [term, trans] of Object.entries(extracted.terms || {})) {
            const lower = term.trim().toLowerCase();
            if (!lower) continue;
            if (!existingTermMap.has(lower)) {
                termRows.push({
                    orig: term.trim(),
                    trans: String(trans).trim(),
                    isManual: false,
                });
                existingTermMap.add(lower);
                newTermsAdded++;
            }
        }

        renderTables();
        showStatus(
            `✅ Extracted successfully: added ${newCharsAdded} new characters, ${newTermsAdded} new terms without overwriting existing entries.`,
            'success',
        );
    }

    // AI Action 1: Bilingual Reference Alignment
    btnExtractBilingual.addEventListener('click', async () => {
        const sourceText = sourceRefText.value.trim();
        const targetText = targetRefText.value.trim();
        if (!sourceText || !targetText) return;

        btnExtractBilingual.disabled = true;
        btnExtractTranslate.disabled = true;
        showStatus(
            '⏳ Running AI bilingual alignment extraction...',
            'neutral',
        );

        try {
            const res = await ContentBackgroundBus.send(
                NCW_CONSTANTS.MESSAGE_TYPES.EXTRACT_GLOSSARY_BILINGUAL,
                {
                    sourceText,
                    targetText,
                    targetLang: activeTargetLang,
                },
            );

            if (res.success && res.data) {
                mergeExtractedResult(res.data);
            } else {
                showStatus(
                    `❌ Extraction failed: ${res.error || 'Unknown error'}`,
                    'error',
                );
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            showStatus(`❌ Network / AI Error: ${msg}`, 'error');
        } finally {
            updateAiButtonsState();
        }
    });

    // AI Action 2: Monolingual Extraction & Translation
    btnExtractTranslate.addEventListener('click', async () => {
        const sourceText = sourceRefText.value.trim();
        if (!sourceText) return;

        btnExtractBilingual.disabled = true;
        btnExtractTranslate.disabled = true;
        showStatus(
            `⏳ Running AI entity extraction and translating to ${activeTargetLang.name}...`,
            'neutral',
        );

        try {
            const res = await ContentBackgroundBus.send(
                NCW_CONSTANTS.MESSAGE_TYPES.EXTRACT_GLOSSARY_AND_TRANSLATE,
                {
                    sourceText,
                    targetLang: activeTargetLang,
                },
            );

            if (res.success && res.data) {
                mergeExtractedResult(res.data);
            } else {
                showStatus(
                    `❌ Extraction failed: ${res.error || 'Unknown error'}`,
                    'error',
                );
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            showStatus(`❌ Network / AI Error: ${msg}`, 'error');
        } finally {
            updateAiButtonsState();
        }
    });

    // 6. Save to Show Memory
    btnSaveGlossary.addEventListener('click', async () => {
        syncInputsToState();

        const charactersPayload: CharacterGlossaryMap = {};
        characterRows.forEach((r) => {
            if (r.orig) {
                charactersPayload[r.orig] = {
                    canonical: r.canonical || r.orig,
                    aliases: r.aliases,
                    setByUser: true,
                };
            }
        });

        const termsPayload: TermGlossaryMap = {};
        termRows.forEach((r) => {
            if (r.orig && r.trans) {
                termsPayload[r.orig] = r.trans;
            }
        });

        btnSaveGlossary.disabled = true;
        showStatus(
            '⏳ Saving glossary to show memory and broadcasting...',
            'neutral',
        );

        try {
            const showId = activeShowId || activeVideoId;
            const res = await ContentBackgroundBus.send(
                NCW_CONSTANTS.MESSAGE_TYPES.BULK_UPDATE_GLOSSARY,
                {
                    showId,
                    targetLanguage: activeTargetLang,
                    characters: charactersPayload,
                    terms: termsPayload,
                },
            );

            if (res.success) {
                showStatus(
                    '🎉 Saved successfully! Target show memory updated and synchronized.',
                    'success',
                );
            } else {
                showStatus(
                    `❌ Save failed: ${res.error || 'Unknown error'}`,
                    'error',
                );
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            showStatus(`❌ Save Error: ${msg}`, 'error');
        } finally {
            btnSaveGlossary.disabled = false;
        }
    });

    // 7. Invalidate Subtitles for This Episode
    btnInvalidateEpisode?.addEventListener('click', async () => {
        const epId = activeVideoId;
        if (!epId) {
            showStatus('⚠️ No active episode ID found to invalidate.', 'error');
            return;
        }

        const confirmed = confirm(
            'Mark all previous cached subtitles in this episode as stale?\n\n' +
                'Previously translated subtitles for this episode will be invalidated and re-translated with your updated glossary.',
        );
        if (!confirmed) return;

        btnInvalidateEpisode.disabled = true;
        showStatus(
            '⏳ Invalidating previous subtitles for this episode...',
            'neutral',
        );

        try {
            const res = await ContentBackgroundBus.send(
                NCW_CONSTANTS.MESSAGE_TYPES.MARK_CUES_STALE,
                {
                    movieId: epId,
                    startTime: 0,
                    endTime: Number.MAX_SAFE_INTEGER,
                },
            );

            if (res && res.success) {
                showStatus(
                    `🎉 Successfully marked ${res.invalidatedCount} subtitles as stale for this episode!`,
                    'success',
                );
            } else {
                showStatus(
                    `❌ Invalidation failed: ${res?.error || 'Unknown error'}`,
                    'error',
                );
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            showStatus(`❌ Invalidation error: ${msg}`, 'error');
        } finally {
            btnInvalidateEpisode.disabled = false;
        }
    });

    // 8. Invalidate Subtitles Across Entire Show
    btnInvalidateShow?.addEventListener('click', async () => {
        const showTitle =
            activeTitle ||
            loadedContextDTO?.mainTitle ||
            loadedContextDTO?.title ||
            '';
        const showId = activeShowId || loadedContextDTO?.showId || '';

        const movieIds: string[] = [];
        if (activeVideoId) movieIds.push(activeVideoId);
        if (
            loadedContextDTO?.episodes &&
            Array.isArray(loadedContextDTO.episodes)
        ) {
            loadedContextDTO.episodes.forEach((ep) => {
                if (ep.videoId && !movieIds.includes(ep.videoId)) {
                    movieIds.push(ep.videoId);
                }
            });
        }

        const showName = showTitle || showId || 'this show';
        const confirmed = confirm(
            `Mark ALL previous cached subtitles across ALL episodes in "${showName}" as stale?\n\n` +
                'Cached subtitles for this entire show will be invalidated and re-translated with your updated glossary.',
        );
        if (!confirmed) return;

        btnInvalidateShow.disabled = true;
        showStatus(
            '⏳ Invalidating previous subtitles across entire show...',
            'neutral',
        );

        try {
            const res = await ContentBackgroundBus.send(
                NCW_CONSTANTS.MESSAGE_TYPES.MARK_CUES_STALE,
                {
                    showTitle: showTitle || undefined,
                    showId: showId || undefined,
                    movieIds: movieIds.length > 0 ? movieIds : undefined,
                    startTime: 0,
                    endTime: Number.MAX_SAFE_INTEGER,
                },
            );

            if (res && res.success) {
                showStatus(
                    `🎉 Successfully marked ${res.invalidatedCount} subtitles as stale across this show!`,
                    'success',
                );
            } else {
                showStatus(
                    `❌ Invalidation failed: ${res?.error || 'Unknown error'}`,
                    'error',
                );
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            showStatus(`❌ Invalidation error: ${msg}`, 'error');
        } finally {
            btnInvalidateShow.disabled = false;
        }
    });

    // 7. Real-Time Playback Shift Monitoring
    // If the streaming service switches to another show while the editor is open, alert user that editor remains safely isolated.
    ContentBackgroundBus.onMessage(
        NCW_CONSTANTS.MESSAGE_TYPES.PUSH_GLOSSARY_CHANGED,
        (payload) => {
            if (!payload || !payload.context) return;
            const incoming = payload.context;
            const incomingShowId = incoming.showId || '';
            const incomingTitle = incoming.mainTitle || incoming.title || '';

            // Check if the newly changed playback differs from what this editor is editing
            const isDifferentShow =
                activeShowId &&
                incomingShowId &&
                activeShowId !== incomingShowId;
            const isDifferentTitle =
                activeTitle &&
                incomingTitle &&
                activeTitle.toLowerCase() !== incomingTitle.toLowerCase();

            if (contextShiftBanner && (isDifferentShow || isDifferentTitle)) {
                contextShiftBanner.style.display = 'flex';
                if (bannerTitle) {
                    bannerTitle.textContent = `Streaming playback changed to "${incomingTitle || incomingShowId}"`;
                }
                if (bannerDesc) {
                    const lockedShowLabel = activeTitle
                        ? `《${activeTitle}》`
                        : activeShowId || activeVideoId || 'original title';
                    bannerDesc.textContent = `This window remains securely locked to ${lockedShowLabel}. Clicking "Save Glossary" will save exclusively to this show and will not corrupt or overwrite other titles.`;
                }
            }
        },
    );

    // Close Window
    btnCloseWindow.addEventListener('click', () => {
        window.close();
    });

    function showStatus(
        msg: string,
        type: 'neutral' | 'success' | 'error',
    ): void {
        footerStatusMsg.textContent = msg;
        footerStatusMsg.className = `status-msg ${type}`;
    }

    function escapeHtml(str: string): string {
        return (str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Initial Boot
    await checkAiCapabilities();
    await loadContextData();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initEditor().catch((e) => logger.error('editor', 'Init error:', e));
    });
} else {
    initEditor().catch((e) => logger.error('editor', 'Init error:', e));
}
