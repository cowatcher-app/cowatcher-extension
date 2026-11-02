import { IStreamingAdapter } from '../../domain/adapters/IStreamingAdapter';
import { ContentMessageService } from '../services/ContentMessageService';
import {
    SubtitleToken,
    LearningCueItem,
    WordLookupResult,
    SubtitlePhraseSelection,
} from '@shared/domain/entities/SubtitleLearning';
import { VocabWordItem } from '@shared/domain/entities/Vocabulary';
import { ExtensionSettings } from '@shared/domain/constants/SettingsDefaults';
import { SubtitleLearningPopover } from '../../presentation/SubtitleLearningPopover';
import { ISubtitleSelectionListener } from '../../presentation/SubtitleSelectionController';
import { Logger } from '@shared/utils/logger';
import { normalizeLanguageCode } from '@shared/domain/phonetic/IPhoneticAdapter';

interface SegmentData {
    segment: string;
    index: number;
    isWordLike?: boolean;
}

interface IntlSegmenterInstance {
    segment(input: string): Iterable<SegmentData>;
}

interface IntlWithSegmenter {
    Segmenter: new (
        locale: string,
        options?: { granularity: 'grapheme' | 'word' | 'sentence' },
    ) => IntlSegmenterInstance;
}

export class SubtitleLearningManager implements ISubtitleSelectionListener {
    private readonly adapter: IStreamingAdapter;
    private readonly messageService: ContentMessageService;
    private readonly popover: SubtitleLearningPopover;
    private readonly logger: Logger = new Logger('SubtitleLearningManager');

    private settings: ExtensionSettings;
    private currentMovieId: string | null = null;
    private currentShowTitle: string = '';
    private currentSourceLang: string = '';
    private currentTargetLang: string = 'zh-CN';

    private userVocabWords = new Set<string>();
    private learningCueCache = new Map<number, LearningCueItem>();
    private wordLookupCache = new Map<string, WordLookupResult>();
    private phoneticWordCache = new Map<string, string>();
    private pausedByLearning: boolean = false;
    private segmenterCache = new Map<string, IntlSegmenterInstance>();
    private onPhoneticUpdateListener?: (cue: LearningCueItem) => void;

    constructor(
        adapter: IStreamingAdapter,
        messageService: ContentMessageService,
        settings: ExtensionSettings,
    ) {
        this.adapter = adapter;
        this.messageService = messageService;
        this.settings = settings;
        this.popover = new SubtitleLearningPopover(this.messageService);

        const initialVocabSrc =
            typeof settings.vocabSourceLanguage === 'object' &&
            settings.vocabSourceLanguage !== null
                ? settings.vocabSourceLanguage.code
                : settings.vocabSourceLanguage;
        if (initialVocabSrc && initialVocabSrc !== 'auto') {
            this.currentSourceLang = normalizeLanguageCode(initialVocabSrc);
        }

        // Listen for vocabulary updates to stay synchronized
        this.messageService.onVocabChanged((data) => {
            if (data && Array.isArray(data.words)) {
                this.syncUserVocabWords(data.words);
            }
        });
    }

    updateSettings(settings: ExtensionSettings): void {
        const oldChineseSystem = this.settings?.chinesePhoneticSystem || 'pinyin';
        const newChineseSystem = settings?.chinesePhoneticSystem || 'pinyin';
        const oldKoreanSystem =
            this.settings?.koreanPhoneticSystem || 'default';
        const newKoreanSystem = settings?.koreanPhoneticSystem || 'default';
        this.settings = settings;
        if (!settings.enableSubtitleLearning && this.popover.isVisible) {
            this.popover.hide();
        }
        if (
            oldChineseSystem !== newChineseSystem ||
            oldKoreanSystem !== newKoreanSystem
        ) {
            this.learningCueCache.clear();
            this.phoneticWordCache.clear();
        }
    }

    get isEnabled(): boolean {
        return Boolean(this.settings.enableSubtitleLearning);
    }

    setSourceLanguage(lang: string): void {
        if (!lang) return;
        const normalized = normalizeLanguageCode(lang);
        const currentNorm = normalizeLanguageCode(this.currentSourceLang);
        if (normalized && normalized !== currentNorm) {
            this.currentSourceLang = normalized;
            this.learningCueCache.clear();
            this.phoneticWordCache.clear();
            this.segmenterCache.clear();
        }
    }

    onShowContext(
        movieId: string,
        showTitle?: string,
        sourceLang?: string,
        targetLang?: string,
    ): void {
        this.currentMovieId = movieId;
        this.currentShowTitle = showTitle || this.currentShowTitle;
        if (sourceLang) this.setSourceLanguage(sourceLang);
        if (targetLang) this.currentTargetLang = targetLang;

        this.learningCueCache.clear();
        this.phoneticWordCache.clear();
        this.userVocabWords.clear();

        if (movieId) {
            this.messageService.getVocabData(movieId).then((data) => {
                if (data && Array.isArray(data.words)) {
                    this.syncUserVocabWords(data.words);
                }
            });
        }
    }

    private syncUserVocabWords(words: VocabWordItem[]): void {
        this.userVocabWords.clear();
        for (const w of words) {
            if (w.source === 'user' && w.word) {
                this.userVocabWords.add(w.word.toLowerCase().trim());
            }
        }
    }

    setOnPhoneticUpdateListener(
        listener: (cue: LearningCueItem) => void,
    ): void {
        this.onPhoneticUpdateListener = listener;
    }

    getSourceLanguage(): string {
        return this.currentSourceLang;
    }

    private resolveCueLanguage(rawText: string, cueLang?: string): string {
        // 1. Priority 1: Ground truth from platform subtitle track or explicitly passed cue language
        const candidate = cueLang || this.currentSourceLang;
        const currentNorm = normalizeLanguageCode(candidate);
        if (currentNorm && currentNorm !== 'auto' && currentNorm !== 'und') {
            return currentNorm;
        }

        // 2. Priority 2: Heuristic script detection if platform track is unknown, missing, or 'auto'
        // Japanese: contains Hiragana or Katakana
        if (/[\u3040-\u30ff]/.test(rawText)) {
            return 'ja';
        }
        // Korean: contains Hangul
        if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(rawText)) {
            return 'ko';
        }
        // Chinese: contains Hanzi
        if (/\p{Script=Han}/u.test(rawText)) {
            return 'zh';
        }
        // Russian / Cyrillic
        if (/[\u0400-\u04ff]/.test(rawText)) {
            return 'ru';
        }

        // 3. Priority 3: Fallback to user-configured vocabSourceLanguage (if not auto), or 'en'
        const vocabSrc =
            typeof this.settings?.vocabSourceLanguage === 'object' &&
            this.settings.vocabSourceLanguage !== null
                ? this.settings.vocabSourceLanguage.code
                : this.settings?.vocabSourceLanguage;
        const normVocab = normalizeLanguageCode(vocabSrc || '');
        if (normVocab && normVocab !== 'auto' && normVocab !== 'und') {
            return normVocab;
        }

        return 'en';
    }

    /**
     * Tokenize original subtitle cue text into interactive tokens.
     * Does NOT mutate or touch the underlying SubtitleCue or raw cues.
     */
    getOrCreateLearningCue(
        cueId: number,
        rawText: string,
        translatedText?: string,
        cueLang?: string,
    ): LearningCueItem {
        if (this.learningCueCache.has(cueId)) {
            const cached = this.learningCueCache.get(cueId)!;
            // Refresh user-marked state in case words were starred since last tokenization
            for (const t of cached.tokens) {
                t.isUserMarked = this.userVocabWords.has(
                    t.text.toLowerCase().trim(),
                );
            }
            return cached;
        }

        const effectiveLang = this.resolveCueLanguage(rawText, cueLang);
        const tokens = this.tokenizeText(rawText, cueId, effectiveLang);

        // Pre-fill any cached phonetics immediately
        for (const token of tokens) {
            if (token.isWordLike && this.phoneticWordCache.has(token.text)) {
                token.phonetic = this.phoneticWordCache.get(token.text);
                token.reading = token.phonetic;
            }
        }

        const learningCue: LearningCueItem = {
            cueId,
            originalText: rawText,
            translatedText,
            tokens,
        };

        this.learningCueCache.set(cueId, learningCue);

        // Asynchronously resolve phonetics via background using effectiveLang
        this.enrichCuePhonetics(learningCue, effectiveLang);

        return learningCue;
    }

    private async enrichCuePhonetics(
        cue: LearningCueItem,
        lang: string,
    ): Promise<void> {
        const canonical = (lang || '').toLowerCase();
        if (
            !canonical.startsWith('ja') &&
            !canonical.startsWith('zh') &&
            !canonical.startsWith('ko')
        ) {
            return;
        }

        const wordsToFetch: string[] = [];
        for (const token of cue.tokens) {
            if (!token.isWordLike || token.phonetic) continue;
            // Target tokens containing ideographic or phonological characters (Kanji/Hanzi or Hangul)
            if (
                /\p{Script=Han}/u.test(token.text) ||
                /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(token.text)
            ) {
                if (this.phoneticWordCache.has(token.text)) {
                    token.phonetic = this.phoneticWordCache.get(token.text);
                    token.reading = token.phonetic;
                } else if (!wordsToFetch.includes(token.text)) {
                    wordsToFetch.push(token.text);
                }
            }
        }

        if (wordsToFetch.length === 0) {
            return;
        }

        try {
            const system = (lang || '').toLowerCase().startsWith('ko')
                ? this.settings?.koreanPhoneticSystem || 'default'
                : this.settings?.chinesePhoneticSystem || 'pinyin';
            const res = await this.messageService.getPhoneticBatch({
                words: wordsToFetch,
                lang,
                system,
            });

            if (res && res.success && res.readings) {
                let hasNewPhonetics = false;
                for (const token of cue.tokens) {
                    if (res.readings[token.text]) {
                        const reading = res.readings[token.text];
                        token.phonetic = reading;
                        token.reading = reading;
                        this.phoneticWordCache.set(token.text, reading);
                        hasNewPhonetics = true;
                    }
                }
                if (hasNewPhonetics && this.onPhoneticUpdateListener) {
                    this.onPhoneticUpdateListener(cue);
                }
            }
        } catch (err) {
            this.logger.warn(
                'Phonetic',
                'Failed batch phonetic lookup from background:',
                err,
            );
        }
    }

    /**
     * Fast, zero-dependency tokenization using modern browser native Intl.Segmenter.
     */
    private tokenizeText(
        text: string,
        cueId: number,
        language?: string,
    ): SubtitleToken[] {
        if (!text || typeof text !== 'string') return [];

        const lang = language || this.currentSourceLang || 'en';
        let segmenter = this.segmenterCache.get(lang);
        if (!segmenter) {
            try {
                if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
                    const intlWithSeg = Intl as unknown as IntlWithSegmenter;
                    segmenter = new intlWithSeg.Segmenter(lang, {
                        granularity: 'word',
                    });
                    this.segmenterCache.set(lang, segmenter);
                }
            } catch {
                // Fallback below
            }
        }

        const tokens: SubtitleToken[] = [];
        if (segmenter) {
            try {
                const segments = Array.from(segmenter.segment(text));
                let tIdx = 0;
                for (const seg of segments) {
                    const segText = seg.segment || '';
                    if (!segText) continue;
                    // SpiderMonkey/ICU word-breaker can report isWordLike=false for valid CJK words/kanji (e.g. 看了, 报警, 見).
                    // Fall back to Unicode letter/number check to ensure words are never dropped.
                    const isWordLike =
                        Boolean(seg.isWordLike) ||
                        /[\p{L}\p{N}]/u.test(segText);
                    const normalized = segText.toLowerCase().trim();
                    tokens.push({
                        id: `c${cueId}_t${tIdx++}`,
                        text: segText,
                        isWordLike,
                        index: seg.index || 0,
                        isUserMarked: isWordLike
                            ? this.userVocabWords.has(normalized)
                            : false,
                    });
                }
                return tokens;
            } catch (err) {
                this.logger.warn(
                    'Tokenize',
                    'Intl.Segmenter failed, using regex fallback:',
                    err,
                );
            }
        }

        // Fallback word tokenization with regex
        const regex = /([\p{L}\p{N}]+|[^\s\p{L}\p{N}]+|\s+)/gu;
        let match: RegExpExecArray | null;
        let tIdx = 0;
        while ((match = regex.exec(text)) !== null) {
            const segText = match[0];
            const isWordLike = /[\p{L}\p{N}]/u.test(segText);
            const normalized = segText.toLowerCase().trim();
            tokens.push({
                id: `c${cueId}_t${tIdx++}`,
                text: segText,
                isWordLike,
                index: match.index,
                isUserMarked: isWordLike
                    ? this.userVocabWords.has(normalized)
                    : false,
            });
        }

        return tokens;
    }

    /**
     * ISubtitleSelectionListener - Callback when user presses down on a token.
     * Pauses playback immediately with 0ms latency.
     */
    onSelectionStart(_button: 0 | 2): void {
        if (this.popover.isVisible) {
            this.popover.hide(false);
        }
        const autoPause = this.settings.autoPauseOnTokenClick !== false;
        if (autoPause && !this.adapter.isPlaybackPaused()) {
            this.adapter.pausePlayback();
            this.pausedByLearning = true;
        }
    }

    /**
     * ISubtitleSelectionListener - Callback when user releases mouse after drag or click.
     * Left click: keeps playback paused, displays dictionary popover.
     * Right click: quick-marks vocabulary and resumes playback automatically!
     */
    onSelectionCommit(
        selection: SubtitlePhraseSelection,
        container?: HTMLElement,
    ): void {
        const targetContainer =
            container || selection.container || document.body;
        if (selection.button === 2) {
            // Right mouse button released: toggle mark and resume playback instantly!
            this.toggleUserMarkedPhrase(selection, targetContainer);
            if (this.pausedByLearning) {
                this.pausedByLearning = false;
                this.adapter.resumePlayback();
            }
        } else {
            // Left mouse button released: keep paused and open Popover
            this.showPhrasePopover(selection, targetContainer);
        }
    }

    /**
     * ISubtitleSelectionListener - Callback when selection is aborted (e.g. Esc pressed).
     */
    onSelectionCancel(_button: 0 | 2): void {
        if (this.pausedByLearning) {
            this.pausedByLearning = false;
            this.adapter.resumePlayback();
        }
    }

    private showPhrasePopover(
        selection: SubtitlePhraseSelection,
        container?: HTMLElement,
    ): void {
        const word = selection.selectedText;
        const isMarked = this.userVocabWords.has(word.toLowerCase());
        const targetContainer =
            container || selection.container || document.body;

        const effectiveSourceLang =
            this.currentSourceLang ||
            this.resolveCueLanguage(selection.originalText);

        this.popover.show({
            word,
            sourceLang: effectiveSourceLang,
            targetLang: this.currentTargetLang,
            tokenEl: selection.anchorEl,
            container: targetContainer,
            isMarked,
            contextSentence: selection.originalText,
            contextTranslation: selection.translatedText,
            onToggleMark: () => {
                this.toggleUserMarkedPhrase(selection, targetContainer);
            },
            onClose: () => {
                if (this.pausedByLearning) {
                    this.pausedByLearning = false;
                    this.adapter.resumePlayback();
                }
            },
        });

        // Check lookup cache
        const cacheKey = `${word}_${effectiveSourceLang}_${this.currentTargetLang}`;
        if (this.wordLookupCache.has(cacheKey)) {
            this.popover.updateDefinition(this.wordLookupCache.get(cacheKey)!);
            return;
        }

        // Fetch definition asynchronously
        this.messageService
            .lookupWordDefinition({
                word,
                contextSentence: selection.originalText,
                contextTranslation: selection.translatedText,
                sourceLang: effectiveSourceLang,
                targetLang: this.currentTargetLang,
            })
            .then((res) => {
                if (res && res.success && res.data) {
                    if (
                        res.data.meaning &&
                        res.data.meaning !==
                            'Tap to lookup or right-click to save'
                    ) {
                        this.wordLookupCache.set(cacheKey, res.data);
                    }
                    this.popover.updateDefinition(res.data);
                }
            })
            .catch((err) => {
                this.logger.warn(
                    'Lookup',
                    'Failed lookup for phrase:',
                    word,
                    err,
                );
            });
    }

    async toggleUserMarkedPhrase(
        selection: SubtitlePhraseSelection,
        container?: HTMLElement,
    ): Promise<void> {
        const movieId = this.currentMovieId || 'default';
        const word = selection.selectedText;
        const normalized = word.toLowerCase();
        const isCurrentlyMarked = this.userVocabWords.has(normalized);

        if (isCurrentlyMarked) {
            this.userVocabWords.delete(normalized);
            selection.tokenElements.forEach((el) => {
                el.classList.remove('is-user-marked');
            });
            this.messageService.deleteUserVocabWord({ movieId, word });
            this.showToast(`🗑️ Removed "${word}" from vocabulary`, container);
        } else {
            this.userVocabWords.add(normalized);
            selection.tokenElements.forEach((el) => {
                el.classList.add('is-user-marked');
            });

            const currentTimestamp =
                (await this.adapter?.getContentTime()) ??
                this.adapter?.getVideoElement()?.currentTime ??
                0;

            const effectiveSourceLang =
                this.currentSourceLang ||
                this.resolveCueLanguage(selection.originalText);

            let phonetic = this.phoneticWordCache.get(word) || '';
            if (!phonetic) {
                try {
                    const system = (effectiveSourceLang || '')
                        .toLowerCase()
                        .startsWith('ko')
                        ? this.settings?.koreanPhoneticSystem || 'default'
                        : this.settings?.chinesePhoneticSystem || 'pinyin';
                    const res = await this.messageService.getPhoneticReading({
                        word,
                        lang: effectiveSourceLang,
                        system,
                    });
                    if (res && res.success && res.reading) {
                        phonetic = res.reading;
                        this.phoneticWordCache.set(word, phonetic);
                    }
                } catch {
                    // ignore
                }
            }

            const cacheKey = `${word}_${effectiveSourceLang}_${this.currentTargetLang}`;
            const cached = this.wordLookupCache.get(cacheKey);

            const wordItem: VocabWordItem = {
                word,
                lemma: cached?.lemma || '',
                dictMeaning: cached?.dictMeaning || undefined,
                pos: cached?.pos || '',
                phonetic: cached?.reading || phonetic,
                meaning: cached?.meaning || '',
                sentence: selection.originalText,
                sentenceTranslation: selection.translatedText || '',
                timestamp: currentTimestamp,
                frequency: 1,
                source: 'user',
                createdAt: Date.now(),
                sourceLang: effectiveSourceLang,
                targetLang: this.currentTargetLang,
            };

            this.messageService.saveUserVocabWord({
                movieId,
                showTitle: this.currentShowTitle,
                wordItem,
            });

            this.showToast(`⭐ Saved "${word}" to vocabulary`, container);
        }
    }

    /**
     * Handle user Left Click on a subtitle token:
     * 1. Pauses playback using platform adapter.
     * 2. Opens dictionary/learning popover card.
     * 3. Triggers definition lookup.
     */
    handleTokenClick(
        token: SubtitleToken,
        cueText: string,
        translatedText: string | undefined,
        tokenEl: HTMLElement,
        container: HTMLElement,
    ): void {
        if (!token.isWordLike || !token.text.trim()) return;

        const autoPause = this.settings.autoPauseOnTokenClick !== false;
        if (autoPause && !this.adapter.isPlaybackPaused()) {
            this.adapter.pausePlayback();
            this.pausedByLearning = true;
        }

        const word = token.text.trim();
        const isMarked = this.userVocabWords.has(word.toLowerCase());

        const effectiveSourceLang =
            this.currentSourceLang ||
            this.resolveCueLanguage(cueText);

        this.popover.show({
            word,
            sourceLang: effectiveSourceLang,
            targetLang: this.currentTargetLang,
            tokenEl,
            container,
            isMarked,
            contextSentence: cueText,
            contextTranslation: translatedText,
            onToggleMark: () => {
                this.toggleUserMarkedWord(
                    word,
                    cueText,
                    translatedText,
                    tokenEl,
                );
            },
            onClose: () => {
                if (this.pausedByLearning) {
                    this.pausedByLearning = false;
                    this.adapter.resumePlayback();
                }
            },
        });

        // Check lookup cache
        const cacheKey = `${word}_${effectiveSourceLang}_${this.currentTargetLang}`;
        if (this.wordLookupCache.has(cacheKey)) {
            this.popover.updateDefinition(this.wordLookupCache.get(cacheKey)!);
            return;
        }

        // Fetch definition asynchronously
        this.messageService
            .lookupWordDefinition({
                word,
                contextSentence: cueText,
                contextTranslation: translatedText,
                sourceLang: effectiveSourceLang,
                targetLang: this.currentTargetLang,
            })
            .then((res) => {
                if (res && res.success && res.data) {
                    if (
                        res.data.meaning &&
                        res.data.meaning !==
                            'Tap to lookup or right-click to save'
                    ) {
                        this.wordLookupCache.set(cacheKey, res.data);
                    }
                    this.popover.updateDefinition(res.data);
                }
            })
            .catch((err) => {
                this.logger.warn(
                    'Lookup',
                    'Failed lookup for word:',
                    word,
                    err,
                );
            });
    }

    /**
     * Handle user Right Click on a subtitle token:
     * Quick-marks or unmarks the word as a user vocabulary word.
     * Explicitly binds the context sentence as the example sentence.
     */
    handleTokenContextMenu(
        e: MouseEvent,
        token: SubtitleToken,
        cueText: string,
        translatedText: string | undefined,
        tokenEl: HTMLElement,
        container: HTMLElement,
    ): void {
        e.preventDefault();
        e.stopPropagation();

        if (!token.isWordLike || !token.text.trim()) return;

        const word = token.text.trim();
        this.toggleUserMarkedWord(
            word,
            cueText,
            translatedText,
            tokenEl,
            container,
        );
    }

    private async toggleUserMarkedWord(
        word: string,
        contextSentence: string,
        contextTranslation: string | undefined,
        tokenEl?: HTMLElement,
        container?: HTMLElement,
    ): Promise<void> {
        const movieId = this.currentMovieId || 'default';
        const normalized = word.toLowerCase();
        const isCurrentlyMarked = this.userVocabWords.has(normalized);

        if (isCurrentlyMarked) {
            // Remove word from user vocabulary
            this.userVocabWords.delete(normalized);
            if (tokenEl) {
                tokenEl.classList.remove('is-user-marked');
            }
            this.messageService.deleteUserVocabWord({ movieId, word });
            this.showToast(`🗑️ Removed "${word}" from vocabulary`, container);
        } else {
            // Add word to user vocabulary with context sentence as example!
            this.userVocabWords.add(normalized);
            if (tokenEl) {
                tokenEl.classList.add('is-user-marked');
            }

            const currentTimestamp =
                (await this.adapter?.getContentTime()) ??
                this.adapter?.getVideoElement()?.currentTime ??
                0;

            const effectiveSourceLang =
                this.currentSourceLang ||
                this.resolveCueLanguage(contextSentence);

            const cacheKey = `${word}_${effectiveSourceLang}_${this.currentTargetLang}`;
            const cached = this.wordLookupCache.get(cacheKey);

            const wordItem: VocabWordItem = {
                word,
                lemma: cached?.lemma || '',
                dictMeaning: cached?.dictMeaning || undefined,
                pos: cached?.pos || '',
                phonetic: cached?.reading || '',
                meaning: cached?.meaning || '',
                sentence: contextSentence, // Contex sentence as example!
                sentenceTranslation: contextTranslation || '',
                timestamp: currentTimestamp,
                frequency: 1,
                source: 'user', // Explicitly user-marked!
                createdAt: Date.now(),
                sourceLang: effectiveSourceLang,
                targetLang: this.currentTargetLang,
            };

            this.messageService.saveUserVocabWord({
                movieId,
                showTitle: this.currentShowTitle,
                wordItem,
            });

            this.showToast(`⭐ Saved "${word}" to vocabulary`, container);
        }
    }

    private showToast(message: string, container?: HTMLElement): void {
        const target = container || document.body;
        const toast = document.createElement('div');
        toast.className = 'ncw-learning-toast';
        toast.textContent = message;
        target.appendChild(toast);

        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 2200);
    }

    destroy(): void {
        this.popover.hide();
        this.learningCueCache.clear();
        this.wordLookupCache.clear();
        this.userVocabWords.clear();
    }
}
