/**
 * ViewingFrictionOverlay
 * Fullscreen-compatible mindful micro-break overlay for viewing static friction.
 */

import {
    FrictionBreakContext,
    FrictionScreenType,
    FrictionTriggerReason,
} from '@shared/domain/entities/ViewingFriction';
import { NCW_I18N } from '@shared/utils/i18n';
import { ContentMessageService } from '../application/services/ContentMessageService';
import {
    RhythmBeatItem,
    ViewingFrictionTemplate,
} from './ViewingFrictionTemplate';

export interface ViewingFrictionOverlayCallbacks {
    onContinue: () => void;
    onDone: () => void;
}

export class ViewingFrictionOverlay {
    private element: HTMLElement | null = null;
    private containerResolver: () => HTMLElement | null;
    private uiLang: string = 'en';
    private activeTimer: ReturnType<typeof setInterval> | null = null;
    private rhythmActiveTimer: ReturnType<typeof setTimeout> | null = null;
    private introTimer: ReturnType<typeof setTimeout> | null = null;
    private callbacks: ViewingFrictionOverlayCallbacks | null = null;
    private currentContext: FrictionBreakContext | null = null;
    private currentSequenceLength: number = 4;

    constructor(containerResolver: () => HTMLElement | null) {
        this.containerResolver = containerResolver;
    }

    setLanguage(lang: string): void {
        this.uiLang = lang || 'en';
    }

    show(
        context: FrictionBreakContext,
        screenType: FrictionScreenType,
        callbacks: ViewingFrictionOverlayCallbacks,
    ): void {
        this.hide();
        this.currentContext = context;
        this.callbacks = callbacks;

        const container = this.containerResolver() || document.body;
        const overlay = document.createElement('div');
        overlay.className = 'ncw-friction-overlay';
        if (container === document.body) {
            overlay.style.position = 'fixed';
        }
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        overlay.innerHTML = ViewingFrictionTemplate.renderMainContent(
            context,
            screenType,
            this.uiLang,
        );
        container.appendChild(overlay);
        this.element = overlay;

        this.bindEvents(overlay, screenType, context);
    }

    hide(): void {
        if (this.activeTimer) {
            clearInterval(this.activeTimer);
            this.activeTimer = null;
        }
        if (this.rhythmActiveTimer) {
            clearTimeout(this.rhythmActiveTimer);
            this.rhythmActiveTimer = null;
        }
        if (this.introTimer) {
            clearTimeout(this.introTimer);
            this.introTimer = null;
        }
        this.currentSequenceLength = 4;
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.element = null;
        this.currentContext = null;
    }

    isVisible(): boolean {
        return this.element !== null;
    }

    getContext(): FrictionBreakContext | null {
        return this.currentContext;
    }

    updateAdvice(advice: string): void {
        if (!this.element || !advice) return;
        const box = this.element.querySelector('.ncw-friction-advice-box');
        if (box) {
            const contentEl = box.querySelector('.ncw-friction-advice-text');
            if (contentEl) {
                contentEl.textContent = advice;
            }
            (box as HTMLElement).style.display = 'block';
        }
    }

    setRestingMode(reason?: FrictionTriggerReason): void {
        if (!this.element) return;
        const card = this.element.querySelector('.ncw-friction-card');
        if (card) {
            card.innerHTML = ViewingFrictionTemplate.renderRestingCard(
                this.uiLang,
                reason,
            );
            const wakeBtn = card.querySelector('#ncw-friction-wake-btn');
            wakeBtn?.addEventListener('click', () => {
                this.callbacks?.onContinue();
            });
            const closeTabBtn = card.querySelector('#ncw-friction-close-tab-btn');
            closeTabBtn?.addEventListener('click', () => {
                try {
                    window.close();
                } catch {}
                ContentMessageService.getInstance().closeCurrentTab().catch(() => {});
            });
        }
    }

    private bindEvents(
        overlay: HTMLElement,
        screenType: FrictionScreenType,
        context: FrictionBreakContext,
    ): void {
        const btnContinue = overlay.querySelector(
            '#ncw-friction-continue-btn',
        ) as HTMLButtonElement | null;
        const btnDone = overlay.querySelector(
            '#ncw-friction-done-btn',
        ) as HTMLButtonElement | null;
        const introEl = overlay.querySelector(
            '#ncw-friction-intro',
        ) as HTMLElement | null;
        const cardEl = overlay.querySelector(
            '#ncw-friction-card',
        ) as HTMLElement | null;

        let isCardRevealed = false;

        const startActivityTimer = () => {
            if (this.activeTimer) return;

            // Countdown timer for interval breaks or screensaver when NOT a hard block
            const isHardBlock =
                context.reason === 'daily_limit' || context.reason === 'curfew';
            const isCountdownActive =
                !isHardBlock &&
                (context.reason === 'interval' || screenType === 'screensaver');

            if (isCountdownActive) {
                let remain = context.countdownSeconds || 20;
                const timerEl = overlay.querySelector('#ncw-friction-timer-num');
                if (timerEl) {
                    timerEl.textContent = String(remain);
                }
                this.activeTimer = setInterval(() => {
                    remain--;
                    if (timerEl) {
                        timerEl.textContent = String(Math.max(0, remain));
                    }
                    if (remain <= 0) {
                        if (this.activeTimer) {
                            clearInterval(this.activeTimer);
                            this.activeTimer = null;
                        }
                        if (context.autoResumeOnTimer !== false) {
                            this.callbacks?.onContinue();
                        } else if (btnContinue) {
                            btnContinue.style.animation =
                                'ncw-pulse-glow 1.5s infinite';
                        }
                    }
                }, 1000);
            } else if (screenType === 'breathing') {
                const phaseEl = overlay.querySelector('#ncw-breathing-phase-text');
                const lang = this.uiLang;
                let step = 0; // 0: inhale (4s), 1: hold (7s), 2: exhale (8s)
                let cycleCount = 0;

                const updatePhase = () => {
                    if (!phaseEl) return;
                    if (step === 0) {
                        phaseEl.textContent = NCW_I18N.getText(
                            'frictionBreathingInhale',
                            lang,
                        );
                        step = 1;
                        this.activeTimer = setTimeout(updatePhase, 4000);
                    } else if (step === 1) {
                        phaseEl.textContent = NCW_I18N.getText(
                            'frictionBreathingHold',
                            lang,
                        );
                        step = 2;
                        this.activeTimer = setTimeout(updatePhase, 7000);
                    } else {
                        phaseEl.textContent = NCW_I18N.getText(
                            'frictionBreathingExhale',
                            lang,
                        );
                        step = 0;
                        cycleCount++;
                        if (cycleCount >= 1 && context.autoResumeOnTimer !== false) {
                            // After one full calming breath cycle (19s), auto-resume
                            this.activeTimer = setTimeout(() => {
                                this.callbacks?.onContinue();
                            }, 2000);
                        } else {
                            this.activeTimer = setTimeout(updatePhase, 8000);
                        }
                    }
                };
                this.activeTimer = setTimeout(updatePhase, 4000);
            }
        };

        const revealCard = () => {
            if (isCardRevealed) return;
            isCardRevealed = true;
            if (this.introTimer) {
                clearTimeout(this.introTimer);
                this.introTimer = null;
            }
            if (introEl) {
                introEl.classList.add('ncw-intro-dissolve');
                setTimeout(() => {
                    if (introEl.parentNode) {
                        introEl.style.display = 'none';
                    }
                }, 400);
            }
            if (cardEl) {
                cardEl.classList.add('ncw-card-revealed');
            }
            startActivityTimer();
        };

        // Skip intro immediately on clicking the intro stage
        introEl?.addEventListener('click', (e) => {
            e.stopPropagation();
            revealCard();
        });

        // Auto transition after 3.2s
        this.introTimer = setTimeout(() => {
            revealCard();
        }, 3200);

        btnDone?.addEventListener('click', () => {
            this.setRestingMode(context.reason);
            this.callbacks?.onDone();
        });

        // Continue Watching interaction difficulty
        const difficulty = context.unlockDifficulty || 'none';

        if (difficulty === 'none') {
            btnContinue?.addEventListener('click', () => {
                this.callbacks?.onContinue();
            });
        } else {
            btnContinue?.addEventListener('click', (e) => {
                e.preventDefault();
                this.startRhythmChallenge(overlay, difficulty);
            });
        }
    }

    private generateBeat(difficulty: 'easy' | 'hard'): RhythmBeatItem {
        const targets = [0, 1, 1, 2, 2, 3, 4];
        const target = targets[Math.floor(Math.random() * targets.length)];

        if (difficulty === 'easy') {
            return {
                target,
                label: String(target),
            };
        }

        const hardPool: Record<number, string[]> = {
            0: ['1 - 1', '0 * 1', '3 - 3', '5 * 0', '2 * 2 - 4', '8 / 2 - 4'],
            1: ['4 - 5 + 2', '7 - 6', '3 / 3', '2 * 2 - 3', '9 / 3 - 2', '5 - 2 * 2'],
            2: ['1 + 1', '6 / 3', '5 - 3', '2 * 3 - 4', '8 / 4', '7 - 2 - 3'],
            3: ['4 * 3 / 4', '1 + 2', '9 / 3', '7 - 4', '2 * 2 - 1', '6 / 2'],
            4: ['2 * 2 / 2 * 2', '2 * 2', '8 / 2', '1 + 3', '6 - 2', '3 * 2 - 2'],
        };
        const pool = hardPool[target] || ['1 + 1'];
        const label = pool[Math.floor(Math.random() * pool.length)];
        return {
            target,
            label,
        };
    }

    private startRhythmChallenge(
        overlay: HTMLElement,
        difficulty: 'easy' | 'hard',
    ): void {
        const lang = this.uiLang;
        const card = overlay.querySelector('.ncw-friction-card');
        const actionsEl = overlay.querySelector('.ncw-friction-actions');
        const btnContinue = overlay.querySelector(
            '#ncw-friction-continue-btn',
        ) as HTMLElement | null;

        if (!card || !actionsEl) return;

        // Hide Continue button while in rhythm challenge
        if (btnContinue) {
            btnContinue.style.display = 'none';
        }

        // Remove any prior stage
        const existingStage = overlay.querySelector('#ncw-rhythm-stage');
        if (existingStage) {
            existingStage.remove();
        }

        const stageEl = document.createElement('div');
        stageEl.id = 'ncw-rhythm-stage';
        stageEl.className = 'ncw-rhythm-stage';

        stageEl.innerHTML = ViewingFrictionTemplate.renderRhythmStage(
            difficulty,
            lang,
        );

        actionsEl.parentNode?.insertBefore(stageEl, actionsEl);

        const progressEl = stageEl.querySelector(
            '#ncw-rhythm-progress',
        ) as HTMLElement;
        const trackEl = stageEl.querySelector(
            '#ncw-rhythm-track',
        ) as HTMLElement;
        const exprEl = stageEl.querySelector(
            '#ncw-rhythm-expr',
        ) as HTMLElement;
        const hintEl = stageEl.querySelector(
            '#ncw-rhythm-hint',
        ) as HTMLElement;
        const barEl = stageEl.querySelector('#ncw-rhythm-bar') as HTMLElement;
        const tapBtn = stageEl.querySelector(
            '#ncw-rhythm-tap-btn',
        ) as HTMLButtonElement;
        const counterEl = stageEl.querySelector(
            '#ncw-rhythm-counter',
        ) as HTMLElement;
        const msgEl = stageEl.querySelector('#ncw-rhythm-msg') as HTMLElement;

        let currentRoundBeats: RhythmBeatItem[] = [];
        let currentClicks = 0;
        let currentTarget = 0;
        let isAcceptingClicks = false;
        let isRoundTerminated = false;

        const cleanupTimers = () => {
            if (this.rhythmActiveTimer) {
                clearTimeout(this.rhythmActiveTimer);
                this.rhythmActiveTimer = null;
            }
        };

        const handleTap = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isAcceptingClicks || isRoundTerminated) return;

            currentClicks++;
            counterEl.textContent = `Clicks: ${currentClicks} / ${currentTarget}`;
            tapBtn.classList.add('ncw-tap-active');
            setTimeout(() => tapBtn.classList.remove('ncw-tap-active'), 70);

            // Immediate fail if user exceeded the target
            if (currentClicks > currentTarget) {
                handleFail();
            }
        };

        tapBtn.addEventListener('click', handleTap);

        const handleFail = () => {
            cleanupTimers();
            isAcceptingClicks = false;
            isRoundTerminated = true;

            stageEl.classList.add('ncw-shake');
            tapBtn.classList.add('ncw-tap-fail');

            this.currentSequenceLength = Math.min(
                8,
                this.currentSequenceLength + 1,
            );
            const penaltyLen = this.currentSequenceLength;

            msgEl.textContent = NCW_I18N.getText(
                'frictionRhythmFailed',
                lang,
                { len: penaltyLen },
            );
            msgEl.className = 'ncw-rhythm-msg ncw-msg-fail';

            this.rhythmActiveTimer = setTimeout(() => {
                stageEl.classList.remove('ncw-shake');
                tapBtn.classList.remove('ncw-tap-fail');
                startRound();
            }, 1200);
        };

        const runBeat = (idx: number) => {
            if (isRoundTerminated) return;

            if (idx >= currentRoundBeats.length) {
                // Perfect rhythm completed!
                cleanupTimers();
                isAcceptingClicks = false;
                isRoundTerminated = true;

                msgEl.textContent = NCW_I18N.getText(
                    'frictionRhythmSuccess',
                    lang,
                );
                msgEl.className = 'ncw-rhythm-msg ncw-msg-success';

                this.rhythmActiveTimer = setTimeout(() => {
                    this.callbacks?.onContinue();
                }, 600);
                return;
            }

            const beat = currentRoundBeats[idx];
            currentTarget = beat.target;
            currentClicks = 0;
            isAcceptingClicks = true;

            // Highlight pills
            const pills = trackEl.querySelectorAll('.ncw-rhythm-pill');
            pills.forEach((p, pIdx) => {
                if (pIdx < idx) {
                    p.className = 'ncw-rhythm-pill ncw-pill-passed';
                } else if (pIdx === idx) {
                    p.className = 'ncw-rhythm-pill ncw-pill-active';
                } else {
                    p.className = 'ncw-rhythm-pill';
                }
            });

            // Progress text
            progressEl.textContent = NCW_I18N.getText(
                'frictionRhythmProgress',
                lang,
                {
                    current: idx + 1,
                    total: currentRoundBeats.length,
                },
            );

            // Target expression & hint
            exprEl.textContent = beat.label;
            hintEl.textContent =
                beat.target === 0
                    ? NCW_I18N.getText('frictionRhythmRest', lang)
                    : NCW_I18N.getText('frictionRhythmClicksGoal', lang, {
                          target: beat.target,
                      });
            counterEl.textContent = `Clicks: 0 / ${beat.target}`;

            // Reset and trigger smooth 1s timer bar animation
            barEl.style.transition = 'none';
            barEl.style.width = '100%';
            void barEl.offsetWidth; // Reflow
            barEl.style.transition = 'width 1s linear';
            barEl.style.width = '0%';

            // Schedule end of this 1s beat
            cleanupTimers();
            this.rhythmActiveTimer = setTimeout(() => {
                if (isRoundTerminated) return;
                if (currentClicks !== currentTarget) {
                    handleFail();
                } else {
                    runBeat(idx + 1);
                }
            }, 1000);
        };

        const startRound = () => {
            cleanupTimers();
            isRoundTerminated = false;
            isAcceptingClicks = false;

            currentRoundBeats = [];
            for (let i = 0; i < this.currentSequenceLength; i++) {
                currentRoundBeats.push(this.generateBeat(difficulty));
            }

            // Render track pills
            trackEl.innerHTML =
                ViewingFrictionTemplate.renderRhythmPills(currentRoundBeats);

            // Ready state
            progressEl.textContent = NCW_I18N.getText(
                'frictionRhythmReady',
                lang,
            );
            exprEl.textContent = '⏱️';
            hintEl.textContent = NCW_I18N.getText('frictionRhythmReady', lang);
            counterEl.textContent = '';
            msgEl.textContent = '';
            msgEl.className = 'ncw-rhythm-msg';

            barEl.style.transition = 'none';
            barEl.style.width = '100%';

            this.rhythmActiveTimer = setTimeout(() => {
                runBeat(0);
            }, 1000);
        };

        startRound();
    }
}
