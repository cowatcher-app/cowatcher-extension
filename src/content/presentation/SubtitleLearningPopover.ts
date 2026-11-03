import { WordLookupResult } from '@shared/domain/entities/SubtitleLearning';
import { NCW_I18N } from '@shared/utils/i18n';
import { ContentMessageService } from '../application/services/ContentMessageService';

export interface PopoverOpenParams {
    word: string;
    sourceLang?: string;
    targetLang?: string;
    tokenEl: HTMLElement;
    container: HTMLElement;
    isMarked: boolean;
    contextSentence?: string;
    contextTranslation?: string;
    onToggleMark: () => void;
    onClose: () => void;
}

export class SubtitleLearningPopover {
    private element: HTMLElement | null = null;
    private backdropElement: HTMLElement | null = null;
    private currentParams: PopoverOpenParams | null = null;
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
    private readonly messageService: ContentMessageService;

    constructor(
        messageService: ContentMessageService = ContentMessageService.getInstance(),
    ) {
        this.messageService = messageService;
    }

    get isVisible(): boolean {
        return this.element !== null && this.element.isConnected;
    }

    show(params: PopoverOpenParams): void {
        this.hide(false);
        this.currentParams = params;

        const el = document.createElement('div');
        el.className = 'ncw-learning-popover';

        const header = document.createElement('div');
        header.className = 'ncw-pop-header';

        const titleArea = document.createElement('div');
        titleArea.className = 'ncw-pop-title-area';

        const wordEl = document.createElement('span');
        wordEl.className = 'ncw-pop-word';
        wordEl.textContent = params.word;
        titleArea.appendChild(wordEl);

        const lemmaEl = document.createElement('span');
        lemmaEl.className = 'ncw-pop-lemma';
        lemmaEl.style.display = 'none';
        titleArea.appendChild(lemmaEl);

        const phoneticEl = document.createElement('span');
        phoneticEl.className = 'ncw-pop-phonetic';
        phoneticEl.textContent = '...';
        titleArea.appendChild(phoneticEl);

        const posEl = document.createElement('span');
        posEl.className = 'ncw-pop-pos';
        posEl.style.display = 'none';
        titleArea.appendChild(posEl);

        header.appendChild(titleArea);

        const actions = document.createElement('div');
        actions.className = 'ncw-pop-actions';

        // TTS Speak button
        const ttsBtn = document.createElement('button');
        ttsBtn.className = 'ncw-pop-btn-icon';
        ttsBtn.title = 'Speak pronunciation';
        ttsBtn.innerHTML = '🔊';
        ttsBtn.onclick = (e) => {
            e.stopPropagation();
            this.speak(params.word, params.sourceLang);
        };
        actions.appendChild(ttsBtn);

        // Star / Mark word button
        const starBtn = document.createElement('button');
        starBtn.className = `ncw-pop-btn-icon ncw-pop-star ${params.isMarked ? 'is-marked' : ''}`;
        starBtn.title = params.isMarked
            ? 'Remove from vocabulary'
            : 'Save to vocabulary';
        starBtn.innerHTML = params.isMarked ? '★' : '☆';
        starBtn.onclick = (e) => {
            e.stopPropagation();
            params.onToggleMark();
            params.isMarked = !params.isMarked;
            starBtn.innerHTML = params.isMarked ? '★' : '☆';
            starBtn.classList.toggle('is-marked', params.isMarked);
            starBtn.title = params.isMarked
                ? 'Remove from vocabulary'
                : 'Save to vocabulary';
        };
        actions.appendChild(starBtn);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ncw-pop-btn-icon';
        closeBtn.title = 'Close (Esc)';
        closeBtn.innerHTML = '✕';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            this.hide();
        };
        actions.appendChild(closeBtn);

        header.appendChild(actions);
        el.appendChild(header);

        // Meaning & Grammar Body
        const body = document.createElement('div');
        body.className = 'ncw-pop-body';

        const dictMeaningEl = document.createElement('div');
        dictMeaningEl.className = 'ncw-pop-dict-meaning';
        dictMeaningEl.style.display = 'none';
        body.appendChild(dictMeaningEl);

        const meaningEl = document.createElement('div');
        meaningEl.className = 'ncw-pop-meaning';
        meaningEl.textContent = 'Loading definition...';
        body.appendChild(meaningEl);

        const grammarEl = document.createElement('div');
        grammarEl.className = 'ncw-pop-grammar';
        grammarEl.style.display = 'none';
        body.appendChild(grammarEl);

        // Example Sentence
        if (params.contextSentence) {
            const exampleBox = document.createElement('div');
            exampleBox.className = 'ncw-pop-example';

            const origEx = document.createElement('div');
            origEx.className = 'ncw-pop-ex-orig';
            origEx.textContent = params.contextSentence;
            exampleBox.appendChild(origEx);

            if (params.contextTranslation) {
                const transEx = document.createElement('div');
                transEx.className = 'ncw-pop-ex-trans';
                transEx.textContent = params.contextTranslation;
                exampleBox.appendChild(transEx);
            }
            body.appendChild(exampleBox);
        }

        el.appendChild(body);

        // Backdrop covering the container to absorb dismiss clicks and avoid triggering player play/pause
        const backdrop = document.createElement('div');
        backdrop.className = 'ncw-popover-backdrop';
        backdrop.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
        });
        backdrop.addEventListener('click', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
        });
        params.container.appendChild(backdrop);
        this.backdropElement = backdrop;

        params.container.appendChild(el);
        this.element = el;

        // Position relative to token element
        this.positionPopover(params.tokenEl, params.container, el);

        // Listeners for outside click and Esc key
        this.outsideClickHandler = (e: MouseEvent) => {
            if (
                this.element &&
                !this.element.contains(e.target as Node) &&
                !params.tokenEl.contains(e.target as Node)
            ) {
                this.hide();
            }
        };
        setTimeout(() => {
            if (this.outsideClickHandler) {
                document.addEventListener(
                    'mousedown',
                    this.outsideClickHandler,
                );
            }
        }, 10);

        this.keydownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.hide();
            }
        };
        document.addEventListener('keydown', this.keydownHandler);
    }

    updateDefinition(result: WordLookupResult): void {
        if (!this.element) return;

        const lemmaEl = this.element.querySelector(
            '.ncw-pop-lemma',
        ) as HTMLElement | null;
        if (lemmaEl) {
            if (
                result.lemma &&
                result.lemma.trim().toLowerCase() !==
                    result.word.trim().toLowerCase()
            ) {
                const baseLabel = NCW_I18N.t('popover.basePrefix') || 'Base';
                lemmaEl.textContent = `(${baseLabel}: ${result.lemma.trim()})`;
                lemmaEl.title = `Root lemma: ${result.lemma.trim()}`;
                lemmaEl.style.display = 'inline-block';
            } else {
                lemmaEl.style.display = 'none';
            }
        }

        if (result.reading) {
            const phoneticEl = this.element.querySelector('.ncw-pop-phonetic');
            if (phoneticEl) {
                phoneticEl.textContent = `[${result.reading}]`;
            }
        } else {
            const phoneticEl = this.element.querySelector('.ncw-pop-phonetic');
            if (phoneticEl) phoneticEl.textContent = '';
        }

        if (result.pos) {
            const posEl = this.element.querySelector(
                '.ncw-pop-pos',
            ) as HTMLElement;
            if (posEl) {
                posEl.textContent = result.pos;
                posEl.style.display = 'inline-block';
            }
        }

        const dictMeaningEl = this.element.querySelector(
            '.ncw-pop-dict-meaning',
        ) as HTMLElement | null;
        const meaningEl = this.element.querySelector(
            '.ncw-pop-meaning',
        ) as HTMLElement | null;

        if (dictMeaningEl) {
            if (result.dictMeaning) {
                const dictPrefix = NCW_I18N.t('popover.dictPrefix') || 'Dict';
                dictMeaningEl.textContent = `📖 ${dictPrefix}: ${result.dictMeaning}`;
                dictMeaningEl.style.display = 'block';
            } else {
                dictMeaningEl.style.display = 'none';
            }
        }

        if (meaningEl) {
            if (
                result.dictMeaning &&
                result.meaning &&
                result.meaning !== result.dictMeaning
            ) {
                const contextPrefix =
                    NCW_I18N.t('popover.contextPrefix') || 'Context';
                meaningEl.textContent = `💡 ${contextPrefix}: ${result.meaning}`;
                meaningEl.style.display = 'block';
            } else {
                meaningEl.textContent = result.meaning;
                meaningEl.style.display = 'block';
            }
        }

        if (result.grammarNotes) {
            const grammarEl = this.element.querySelector(
                '.ncw-pop-grammar',
            ) as HTMLElement;
            if (grammarEl) {
                grammarEl.textContent = `💡 ${result.grammarNotes}`;
                grammarEl.style.display = 'block';
            }
        }
    }

    hide(triggerOnClose: boolean = true): void {
        if (this.outsideClickHandler) {
            document.removeEventListener('mousedown', this.outsideClickHandler);
            this.outsideClickHandler = null;
        }
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }
        if (this.backdropElement && this.backdropElement.parentElement) {
            this.backdropElement.parentElement.removeChild(
                this.backdropElement,
            );
        }
        this.backdropElement = null;
        if (this.element && this.element.parentElement) {
            this.element.parentElement.removeChild(this.element);
        }
        this.element = null;
        if (this.currentParams) {
            const params = this.currentParams;
            this.currentParams = null;
            if (triggerOnClose) {
                params.onClose();
            }
        }
    }

    private positionPopover(
        tokenEl: HTMLElement,
        container: HTMLElement,
        popover: HTMLElement,
    ): void {
        const tokenRect = tokenEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        const tokenLeft = tokenRect.left - containerRect.left;
        const tokenTop = tokenRect.top - containerRect.top;

        const popWidth = 300;
        const popHeight = 180;

        let left = tokenLeft + tokenRect.width / 2 - popWidth / 2;
        let top = tokenTop - popHeight - 12; // Above token by default

        // If clipping at top, place below token
        if (top < 10) {
            top = tokenTop + tokenRect.height + 12;
        }

        // Keep horizontally within container
        left = Math.max(
            10,
            Math.min(left, containerRect.width - popWidth - 10),
        );

        // Keep vertically within container
        if (containerRect.height > popHeight + 20) {
            top = Math.max(
                10,
                Math.min(top, containerRect.height - popHeight - 10),
            );
        }

        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    }

    private currentAudio: HTMLAudioElement | null = null;

    private async speak(word: string, lang?: string): Promise<void> {
        const text = word.trim();
        if (!text) return;

        try {
            // Request high-fidelity cloud TTS through ContentMessageService
            const response = await this.messageService.getTtsAudio({
                text,
                lang: lang || 'en',
            });

            if (!response?.success || !response?.audioBase64) {
                this.fallbackSpeak(text, lang);
                return;
            }

            if (this.currentAudio) {
                this.currentAudio.pause();
                this.currentAudio = null;
            }
            const audio = new Audio(
                `data:audio/mp3;base64,${response.audioBase64}`,
            );
            this.currentAudio = audio;
            await audio.play().catch(() => {
                this.fallbackSpeak(text, lang);
            });
        } catch {
            this.fallbackSpeak(text, lang);
        }
    }

    private fallbackSpeak(word: string, lang?: string): void {
        if (typeof window === 'undefined' || !('speechSynthesis' in window))
            return;
        try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(word);
            if (lang) {
                utterance.lang = lang;
            }
            window.speechSynthesis.speak(utterance);
        } catch {
            // Ignore speech synthesis errors
        }
    }
}
