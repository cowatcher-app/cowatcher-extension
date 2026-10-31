import { ExtensionSettings } from '@shared/utils/constants';
import { SubtitleLearningManager } from '../application/learning/SubtitleLearningManager';
import { SubtitleToken, LearningCueItem } from '@shared/domain/entities/SubtitleLearning';
import { SubtitleSelectionController } from './SubtitleSelectionController';

export interface OverlayCueItem {
    id: number | string;
    originalText: string;
    translatedText: string | null;
    position?: 'bottom' | 'top' | 'left-vertical' | 'right-vertical' | string;
}

export class SubtitleOverlay {
    container: HTMLElement | null = null;
    slots: {
        bottom: HTMLElement | null;
        top: HTMLElement | null;
        rightVertical: HTMLElement | null;
        leftVertical: HTMLElement | null;
    } = {
        bottom: null,
        top: null,
        rightVertical: null,
        leftVertical: null,
    };
    translatedEl: HTMLElement | null = null;
    originalEl: HTMLElement | null = null;
    wrapper: HTMLElement | null = null;
    currentText: { original: string; translated: string | null } = {
        original: '',
        translated: '',
    };
    isVisible: boolean = false;
    settings: Partial<ExtensionSettings> = {};
    private targetContainer: HTMLElement | null = null;
    private containerResolver: (() => HTMLElement | null) | null = null;
    private learningManager?: SubtitleLearningManager;
    private readonly selectionController = new SubtitleSelectionController();

    setLearningManager(manager: SubtitleLearningManager): void {
        this.learningManager = manager;
        this.selectionController.setListener(manager);
        this.learningManager.setOnPhoneticUpdateListener((cue) => {
            this.handlePhoneticsUpdated(cue);
        });
    }

    bindContainerResolver(resolver: () => HTMLElement | null): void {
        this.containerResolver = resolver;
    }

    init(settings: Partial<ExtensionSettings> = {}): void {
        this.settings = settings;
        this.ensureInDOM();
    }

    updateSettings(settings: Partial<ExtensionSettings>): void {
        const oldSwap = Boolean(this.settings.swapSubtitleOrder);
        const oldLearning = Boolean(this.settings.enableSubtitleLearning);
        const oldChineseSystem = this.settings.chinesePhoneticSystem || 'pinyin';
        const oldKoreanSystem = this.settings.koreanPhoneticSystem || 'default';
        this.settings = { ...this.settings, ...settings };
        const newChineseSystem = this.settings.chinesePhoneticSystem || 'pinyin';
        const newKoreanSystem = this.settings.koreanPhoneticSystem || 'default';
        this.applyStyles();
        if (this.settings.enabled === false) {
            this.hide(true);
        } else {
            if (
                settings.swapSubtitleOrder !== undefined &&
                settings.swapSubtitleOrder !== oldSwap
            ) {
                this.reorderVisibleWrappers();
            }
            if (
                (settings.enableSubtitleLearning !== undefined &&
                    settings.enableSubtitleLearning !== oldLearning) ||
                oldChineseSystem !== newChineseSystem ||
                oldKoreanSystem !== newKoreanSystem
            ) {
                this.resetRenderedTokens();
            }
        }
    }

    private resetRenderedTokens(): void {
        if (!this.slots) return;
        Object.values(this.slots).forEach((slotEl) => {
            if (!slotEl) return;
            const wrappers = slotEl.querySelectorAll('.ncw-subtitle-wrapper');
            wrappers.forEach((wrapper) => {
                const cueId = wrapper.getAttribute('data-cue-id') || 0;
                const origEl = wrapper.querySelector(
                    '.ncw-original-text',
                ) as HTMLElement | null;
                const transEl = wrapper.querySelector(
                    '.ncw-translated-text',
                ) as HTMLElement | null;
                if (origEl) {
                    const originalText =
                        origEl.dataset.originalRaw ||
                        wrapper.getAttribute('data-original-text') ||
                        origEl.dataset.renderedText ||
                        '';
                    const translatedText =
                        wrapper.getAttribute('data-translated-text') ||
                        (transEl ? transEl.textContent : null);
                    origEl.dataset.learningMode = '';
                    origEl.dataset.renderedText = '';
                    origEl.innerHTML = '';
                    if (originalText) {
                        this.renderOriginalTextContent(
                            origEl,
                            cueId,
                            originalText,
                            translatedText,
                        );
                    }
                }
            });
        });
    }

    private reorderVisibleWrappers(): void {
        if (!this.slots) return;
        const swap = Boolean(this.settings.swapSubtitleOrder);
        Object.values(this.slots).forEach((slotEl) => {
            if (!slotEl) return;
            const wrappers = slotEl.querySelectorAll('.ncw-subtitle-wrapper');
            wrappers.forEach((wrapper) => {
                const transEl = wrapper.querySelector('.ncw-translated-text');
                const origEl = wrapper.querySelector('.ncw-original-text');
                if (transEl && origEl) {
                    const firstChild = wrapper.firstElementChild;
                    if (swap && firstChild !== origEl) {
                        wrapper.insertBefore(origEl, transEl);
                    } else if (!swap && firstChild !== transEl) {
                        wrapper.insertBefore(transEl, origEl);
                    }
                }
            });
        });
    }

    ensureInDOM(): void {
        if (
            this.container &&
            document.body &&
            document.body.contains(this.container)
        ) {
            return;
        }

        if (typeof document === 'undefined') return;

        const existing = document.getElementById('ncw-subtitle-container');
        if (existing) existing.remove();

        this.container = document.createElement('div');
        this.container.id = 'ncw-subtitle-container';
        this.container.className = 'ncw-subtitle-master-container';

        const slotConfigs = [
            { key: 'bottom' as const, className: 'ncw-slot ncw-slot-bottom' },
            { key: 'top' as const, className: 'ncw-slot ncw-slot-top' },
            {
                key: 'rightVertical' as const,
                className: 'ncw-slot ncw-slot-right-vertical',
            },
            {
                key: 'leftVertical' as const,
                className: 'ncw-slot ncw-slot-left-vertical',
            },
        ];

        slotConfigs.forEach(({ key, className }) => {
            const slotEl = document.createElement('div');
            slotEl.className = className;
            slotEl.style.visibility = 'hidden';
            slotEl.style.opacity = '0';
            if (this.container) {
                this.container.appendChild(slotEl);
            }
            this.slots[key] = slotEl;
        });

        this.applyStyles();
    }

    mountToPlayer(customContainer?: HTMLElement | null): void {
        if (
            customContainer &&
            typeof document !== 'undefined' &&
            document.body &&
            document.body.contains(customContainer) &&
            customContainer !== document.body
        ) {
            this.targetContainer = customContainer;
        }

        if (
            !this.container ||
            !document.body ||
            !document.body.contains(this.container)
        ) {
            this.ensureInDOM();
        }

        if (typeof document === 'undefined') return;

        let target: HTMLElement;
        const resolved = this.containerResolver?.() || null;
        if (
            resolved &&
            document.body.contains(resolved) &&
            resolved !== document.body
        ) {
            target = resolved;
            this.targetContainer = resolved;
        } else if (
            this.targetContainer &&
            document.body.contains(this.targetContainer) &&
            this.targetContainer !== document.body
        ) {
            target = this.targetContainer;
        } else {
            return;
        }

        if (
            target &&
            this.container &&
            this.container.parentElement !== target
        ) {
            target.appendChild(this.container);
        }
    }

    applyStyles(): void {
        if (!this.container) return;

        const fontSize = this.settings.fontSize || 26;
        const offsetBottom = this.settings.subOffsetBottom || 80;
        const bgOpacity =
            this.settings.bgOpacity !== undefined
                ? this.settings.bgOpacity
                : 0.0;
        const translationOpacity =
            this.settings.translationOpacity !== undefined
                ? this.settings.translationOpacity
                : 1.0;

        const showOriginalSmaller = this.settings.showOriginalSmaller !== false;
        const origRatio = showOriginalSmaller ? 0.75 : 1.0;

        const enableAnimation = Boolean(this.settings.enableAnimation);
        const enableGlass = Boolean(this.settings.enableGlassEffect);
        const swap = Boolean(this.settings.swapSubtitleOrder);

        this.container.classList.toggle('ncw-enable-anim', enableAnimation);
        this.container.classList.toggle('ncw-glass-effect', enableGlass);
        this.container.classList.toggle('ncw-swapped-subs', swap);

        if (this.container.style) {
            this.container.style.setProperty(
                '--ncw-font-size',
                `${fontSize}px`,
            );
            this.container.style.setProperty(
                '--ncw-font-size-orig',
                `${Math.round(fontSize * origRatio)}px`,
            );
            this.container.style.setProperty(
                '--ncw-bg-opacity',
                String(bgOpacity),
            );
            this.container.style.setProperty(
                '--ncw-trans-opacity',
                String(translationOpacity),
            );
            this.container.style.setProperty(
                '--ncw-bottom-offset',
                `${offsetBottom}px`,
            );
        }

        if (this.slots && this.slots.bottom && this.slots.bottom.style) {
            this.slots.bottom.style.bottom = `${offsetBottom}px`;
        }
    }

    showCues(cues: OverlayCueItem[] = []): void {
        if (this.settings.enabled === false) {
            this.hide(true);
            return;
        }

        if (!cues || cues.length === 0) {
            this.hide();
            return;
        }

        this.ensureInDOM();
        this.mountToPlayer(this.targetContainer);

        const slotMap: Record<string, OverlayCueItem[]> = {
            bottom: [],
            top: [],
            rightVertical: [],
            leftVertical: [],
        };

        cues.forEach((c) => {
            const pos = c.position || 'bottom';
            if (pos === 'top') {
                slotMap.top.push(c);
            } else if (
                pos === 'right-vertical' ||
                pos === 'vertical' ||
                pos === 'vertical-rl'
            ) {
                slotMap.rightVertical.push(c);
            } else if (pos === 'left-vertical' || pos === 'vertical-lr') {
                slotMap.leftVertical.push(c);
            } else {
                slotMap.bottom.push(c);
            }
        });

        const mode = this.settings.displayMode || 'bilingual';
        let anyVisible = false;

        if (this.slots) {
            for (const [slotKey, slotCues] of Object.entries(slotMap)) {
                const slotEl = (
                    this.slots as Record<string, HTMLElement | null>
                )[slotKey];
                if (!slotEl) continue;

                if (slotCues.length === 0) {
                    slotEl.style.opacity = '0';
                    slotEl.style.visibility = 'hidden';
                    slotEl.innerHTML = '';
                } else {
                    anyVisible = true;
                    this.reconcileSlotCues(slotEl, slotCues, mode);
                    slotEl.style.visibility = 'visible';
                    slotEl.style.opacity = '1';
                }
            }
        }

        this.isVisible = anyVisible;
        if (cues[0]) {
            this.currentText = {
                original: cues[0].originalText,
                translated: cues[0].translatedText,
            };
            this.wrapper =
                this.slots?.bottom?.querySelector?.('.ncw-subtitle-wrapper') ||
                null;
            this.translatedEl =
                this.wrapper?.querySelector?.('.ncw-translated-text') || null;
            this.originalEl =
                this.wrapper?.querySelector?.('.ncw-original-text') || null;
        }
    }

    reconcileSlotCues(
        slotEl: HTMLElement,
        slotCues: OverlayCueItem[],
        mode: string,
    ): void {
        if (!slotEl) return;

        const existingMap = new Map<string, HTMLElement>();
        const children = Array.from(slotEl.children) as HTMLElement[];
        children.forEach((child) => {
            const cueId = child.getAttribute('data-cue-id');
            if (cueId !== null && cueId !== undefined) {
                existingMap.set(String(cueId), child);
            }
        });

        const targetIds = new Set(
            slotCues.map((c) =>
                String(c.id !== undefined && c.id !== null ? c.id : 0),
            ),
        );

        children.forEach((child) => {
            const cueId = child.getAttribute('data-cue-id');
            if (cueId && !targetIds.has(String(cueId))) {
                child.remove();
            }
        });

        slotCues.forEach((cue) => {
            const idStr = String(
                cue.id !== undefined && cue.id !== null ? cue.id : 0,
            );
            const existing = existingMap.get(idStr);

            if (existing) {
                this.updateCueWrapper(
                    existing,
                    cue.originalText,
                    cue.translatedText,
                    mode,
                );
                if (existing.parentElement !== slotEl) {
                    slotEl.appendChild(existing);
                }
            } else {
                const newWrapper = this.createCueWrapper(
                    cue.id,
                    cue.originalText,
                    cue.translatedText,
                    mode,
                );
                slotEl.appendChild(newWrapper);
            }
        });
    }

    private createTokenElement(
        token: SubtitleToken,
        displayText: string,
    ): Node {
        if (!token.isWordLike) {
            return document.createTextNode(displayText);
        }

        const span = document.createElement('span');
        span.className = `ncw-token${token.isUserMarked ? ' is-user-marked' : ''}`;
        span.setAttribute('data-token-id', token.id);

        const phonetic = token.phonetic || token.reading;
        if (phonetic && phonetic !== displayText) {
            const ruby = document.createElement('ruby');
            ruby.className = 'ncw-token-ruby';
            ruby.appendChild(document.createTextNode(displayText));
            const rt = document.createElement('rt');
            rt.className = 'ncw-token-phonetic';
            rt.textContent = phonetic;
            rt.style.userSelect = 'none';
            rt.style.webkitUserSelect = 'none';
            rt.style.pointerEvents = 'none';
            ruby.appendChild(rt);
            span.appendChild(ruby);
        } else {
            span.textContent = displayText;
        }

        return span;
    }

    private handlePhoneticsUpdated(cue: LearningCueItem): void {
        if (!this.container) return;
        const wrapper = this.container.querySelector(
            `[data-cue-id="${cue.cueId}"]`,
        );
        if (!wrapper) return;
        const origEl = wrapper.querySelector('.ncw-original-text');
        if (!origEl) return;

        for (const token of cue.tokens) {
            const phonetic = token.phonetic || token.reading;
            if (!phonetic || phonetic === token.text) continue;

            const span = origEl.querySelector(
                `[data-token-id="${token.id}"]`,
            ) as HTMLElement | null;
            if (span) {
                const existingRt = span.querySelector<HTMLElement>('.ncw-token-phonetic');
                if (existingRt) {
                    if (existingRt.textContent !== phonetic) {
                        existingRt.textContent = phonetic;
                    }
                } else {
                    span.innerHTML = '';
                    const ruby = document.createElement('ruby');
                    ruby.className = 'ncw-token-ruby';
                    ruby.appendChild(document.createTextNode(token.text));
                    const rt = document.createElement('rt');
                    rt.className = 'ncw-token-phonetic';
                    rt.textContent = phonetic;
                    rt.style.userSelect = 'none';
                    rt.style.webkitUserSelect = 'none';
                    rt.style.pointerEvents = 'none';
                    ruby.appendChild(rt);
                    span.appendChild(ruby);
                }
            }
        }
    }

    private renderOriginalTextContent(
        origEl: HTMLElement,
        cueId: number | string,
        originalText: string,
        translatedText: string | null,
    ): void {
        const isLearning = Boolean(
            this.learningManager && this.learningManager.isEnabled,
        );
        const learningStateKey = isLearning ? 'learning' : 'plain';

        origEl.dataset.originalRaw = originalText;

        if (
            origEl.dataset.renderedText === originalText &&
            origEl.dataset.learningMode === learningStateKey
        ) {
            return;
        }

        origEl.dataset.renderedText = originalText;
        origEl.dataset.learningMode = learningStateKey;

        if (!isLearning) {
            origEl.innerHTML = (originalText || '').replace(/\n/g, '<br/>');
            return;
        }

        const numCueId =
            typeof cueId === 'number'
                ? cueId
                : parseInt(String(cueId), 10) || 0;
        const learningCue = this.learningManager!.getOrCreateLearningCue(
            numCueId,
            originalText,
            translatedText || undefined,
        );

        origEl.innerHTML = '';
        for (const token of learningCue.tokens) {
            if (token.text.includes('\n')) {
                const parts = token.text.split('\n');
                parts.forEach((part, idx) => {
                    if (idx > 0) {
                        origEl.appendChild(document.createElement('br'));
                    }
                    if (part) {
                        origEl.appendChild(
                            this.createTokenElement(token, part),
                        );
                    }
                });
            } else {
                origEl.appendChild(
                    this.createTokenElement(token, token.text),
                );
            }
        }

        this.selectionController.attach(
            origEl,
            learningCue,
            this.container || document.body,
        );
    }

    createCueWrapper(
        cueId: number | string,
        originalText: string,
        translatedText: string | null,
        mode: string = 'bilingual',
    ): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.className = 'ncw-subtitle-wrapper';
        wrapper.setAttribute('data-cue-id', String(cueId));
        wrapper.setAttribute('data-original-text', originalText);
        if (translatedText) {
            wrapper.setAttribute('data-translated-text', translatedText);
        }

        const formattedTrans = (translatedText || '').replace(/\n/g, '<br/>');

        const transEl = document.createElement('div');
        transEl.className = 'ncw-sub-line ncw-translated-text';
        transEl.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
        });

        const origEl = document.createElement('div');
        origEl.className = 'ncw-sub-line ncw-original-text';

        const swap = Boolean(this.settings.swapSubtitleOrder);

        if (mode === 'bilingual') {
            transEl.innerHTML =
                formattedTrans || '<span class="ncw-translating">...</span>';
            transEl.style.display = 'block';
            this.renderOriginalTextContent(
                origEl,
                cueId,
                originalText,
                translatedText,
            );
            origEl.style.display = originalText ? 'block' : 'none';

            if (swap) {
                if (originalText) wrapper.appendChild(origEl);
                wrapper.appendChild(transEl);
            } else {
                wrapper.appendChild(transEl);
                if (originalText) wrapper.appendChild(origEl);
            }
        } else if (mode === 'translated') {
            transEl.innerHTML =
                formattedTrans || (originalText || '').replace(/\n/g, '<br/>');
            transEl.style.display = 'block';
            wrapper.appendChild(transEl);
        } else if (mode === 'original') {
            this.renderOriginalTextContent(
                origEl,
                cueId,
                originalText,
                translatedText,
            );
            origEl.style.display = 'block';
            wrapper.appendChild(origEl);
        }

        return wrapper;
    }

    updateCueWrapper(
        wrapper: HTMLElement,
        originalText: string,
        translatedText: string | null,
        mode: string,
    ): void {
        if (!wrapper) return;

        const cueId = wrapper.getAttribute('data-cue-id') || 0;
        wrapper.setAttribute('data-original-text', originalText);
        if (translatedText) {
            wrapper.setAttribute('data-translated-text', translatedText);
        } else {
            wrapper.removeAttribute('data-translated-text');
        }
        const formattedTrans = (translatedText || '').replace(/\n/g, '<br/>');

        const transEl = wrapper.querySelector(
            '.ncw-translated-text',
        ) as HTMLElement | null;
        const origEl = wrapper.querySelector(
            '.ncw-original-text',
        ) as HTMLElement | null;
        const swap = Boolean(this.settings.swapSubtitleOrder);

        if (mode === 'bilingual') {
            const targetTrans =
                formattedTrans || '<span class="ncw-translating">...</span>';
            if (transEl && transEl.innerHTML !== targetTrans) {
                transEl.innerHTML = targetTrans;
            }
            if (origEl) {
                this.renderOriginalTextContent(
                    origEl,
                    cueId,
                    originalText,
                    translatedText,
                );
                origEl.style.display = originalText ? 'block' : 'none';
            }

            if (origEl && transEl) {
                const firstChild = wrapper.firstElementChild;
                if (swap && firstChild !== origEl) {
                    wrapper.insertBefore(origEl, transEl);
                } else if (!swap && firstChild !== transEl) {
                    wrapper.insertBefore(transEl, origEl);
                }
            }
        } else if (mode === 'translated') {
            const targetTrans =
                formattedTrans || (originalText || '').replace(/\n/g, '<br/>');
            if (transEl && transEl.innerHTML !== targetTrans) {
                transEl.innerHTML = targetTrans;
            }
        } else if (mode === 'original') {
            if (origEl) {
                this.renderOriginalTextContent(
                    origEl,
                    cueId,
                    originalText,
                    translatedText,
                );
            }
        }
    }

    show(
        originalText: string,
        translatedText: string | null,
        position: string = 'bottom',
    ): void {
        this.showCues([{ id: 0, originalText, translatedText, position }]);
    }

    hide(immediate: boolean = false): void {
        if (this.slots) {
            const animEnabled = Boolean(this.settings.enableAnimation);
            Object.values(this.slots).forEach((slotEl) => {
                if (!slotEl || !slotEl.style) return;
                slotEl.style.opacity = '0';
                if (
                    immediate ||
                    !animEnabled ||
                    this.settings.enabled === false
                ) {
                    slotEl.style.visibility = 'hidden';
                    slotEl.innerHTML = '';
                }
            });
        }
        this.isVisible = false;
    }
}

export default SubtitleOverlay;
