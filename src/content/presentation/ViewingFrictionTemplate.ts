/**
 * ViewingFrictionTemplate
 * Pure HTML templates and markup generators for ViewingFrictionOverlay.
 */

import {
    FrictionBreakContext,
    FrictionScreenType,
    FrictionTriggerReason,
} from '@shared/domain/entities/ViewingFriction';
import { NCW_I18N } from '@shared/utils/i18n';

export interface RhythmBeatItem {
    target: number;
    label: string;
}

export const ViewingFrictionTemplate = {
    escapeHtml(str: string): string {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    getCuratedQuotes(lang: string): Array<{ text: string; author: string }> {
        return [
            {
                text: NCW_I18N.getText('frictionQuote1Text', lang),
                author: NCW_I18N.getText('frictionQuote1Author', lang),
            },
            {
                text: NCW_I18N.getText('frictionQuote2Text', lang),
                author: NCW_I18N.getText('frictionQuote2Author', lang),
            },
            {
                text: NCW_I18N.getText('frictionQuote3Text', lang),
                author: NCW_I18N.getText('frictionQuote3Author', lang),
            },
            {
                text: NCW_I18N.getText('frictionQuote4Text', lang),
                author: NCW_I18N.getText('frictionQuote4Author', lang),
            },
            {
                text: NCW_I18N.getText('frictionQuote5Text', lang),
                author: NCW_I18N.getText('frictionQuote5Author', lang),
            },
        ];
    },

    renderActivity(
        screenType: FrictionScreenType,
        lang: string,
        countdownSeconds: number = 20,
        isInterval: boolean = false,
        isHardBlock: boolean = false,
        reason?: FrictionTriggerReason,
    ): string {
        if (isHardBlock) {
            const notice =
                reason === 'curfew'
                    ? NCW_I18N.getText('frictionCurfewNotice', lang)
                    : NCW_I18N.getText('frictionDailyLimitNotice', lang);
            return `
                <div class="ncw-friction-activity ncw-friction-hardblock-wrap" style="padding: 18px 24px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 12px; max-width: 480px; margin: 12px auto; text-align: center;">
                    <div style="font-size: 32px; margin-bottom: 8px;">🛑</div>
                    <div style="font-size: 14px; color: #fca5a5; line-height: 1.6;">
                        ${this.escapeHtml(notice)}
                    </div>
                </div>
            `;
        }

        const countdownBadge = isInterval && screenType !== 'screensaver'
            ? `
                <div class="ncw-friction-countdown-badge">
                    <span class="ncw-countdown-pulse">⏱️</span>
                    <span>${NCW_I18N.getText('frictionAutoResumeCountdown', lang, {
                        sec: `<strong id="ncw-friction-timer-num">${countdownSeconds}</strong>`,
                    })}</span>
                </div>
            `
            : '';

        if (screenType === 'breathing') {
            return `
                <div class="ncw-friction-activity ncw-friction-breathing-wrap">
                    <div class="ncw-friction-breathing-orb">
                        <span id="ncw-breathing-phase-text">${NCW_I18N.getText('frictionBreathingInhale', lang)}</span>
                    </div>
                    <div class="ncw-friction-hint">
                        ${this.escapeHtml(NCW_I18N.getText('frictionBreathingFormula', lang))}
                    </div>
                    ${countdownBadge}
                </div>
            `;
        }

        if (screenType === 'quote') {
            const quotes = this.getCuratedQuotes(lang);
            const chosen = quotes[Math.floor(Math.random() * quotes.length)];
            return `
                <div class="ncw-friction-activity ncw-friction-quote-wrap">
                    <blockquote class="ncw-friction-quote">
                        "${this.escapeHtml(chosen.text)}"
                    </blockquote>
                    <div class="ncw-friction-author">— ${this.escapeHtml(chosen.author)}</div>
                    ${countdownBadge}
                </div>
            `;
        }

        if (screenType === 'puzzle') {
            return `
                <div class="ncw-friction-activity ncw-friction-puzzle-wrap">
                    <div class="ncw-friction-puzzle-title">🧠 ${NCW_I18N.getText('frictionPuzzlePrompt', lang)}</div>
                    <div style="font-size: 18px; font-weight: 700; color: #38bdf8; margin: 10px 0;">
                        ${this.escapeHtml(NCW_I18N.getText('frictionPuzzleFocusHint', lang))}
                    </div>
                    <div class="ncw-friction-hint">
                        ${NCW_I18N.getText('friction2020Rule', lang)}
                    </div>
                    ${countdownBadge}
                </div>
            `;
        }

        // Default: 'screensaver' with 20-20-20 eye rest rule & countdown
        return `
            <div class="ncw-friction-activity ncw-friction-screensaver-wrap">
                <div class="ncw-friction-countdown-circle">
                    <span id="ncw-friction-timer-num">${countdownSeconds}</span>
                    <span style="font-size: 11px; text-transform: uppercase; color: #94a3b8;">${this.escapeHtml(NCW_I18N.getText('frictionSecondsUnit', lang))}</span>
                </div>
                <div class="ncw-friction-hint" style="max-width: 440px; margin: 12px auto 0 auto;">
                    👁️ ${NCW_I18N.getText('friction2020Rule', lang)}
                </div>
            </div>
        `;
    },

    renderMetrics(context: FrictionBreakContext, lang: string): string {
        const hours = Math.floor(context.todayMinutes / 60);
        const mins = Math.floor(context.todayMinutes % 60);

        const continuousDisplay =
            context.continuousMinutes < 1 &&
            context.continuousSeconds !== undefined
                ? NCW_I18N.getText('frictionMetricSeconds', lang, {
                      sec: context.continuousSeconds,
                  })
                : NCW_I18N.getText('frictionMetricMinutes', lang, {
                      min: context.continuousMinutes,
                  });

        const todayDisplay =
            context.todayMinutes < 1 && context.todaySeconds !== undefined
                ? NCW_I18N.getText('frictionMetricSeconds', lang, {
                      sec: context.todaySeconds,
                  })
                : NCW_I18N.getText('frictionMetricHoursMinutes', lang, {
                      hours,
                      min: mins,
                  });

        const restSeconds = context.todayRestSeconds || 0;
        const restMins = Math.floor(restSeconds / 60);
        const restSecRem = restSeconds % 60;
        const restDisplay =
            restSeconds < 60
                ? NCW_I18N.getText('frictionMetricSeconds', lang, { sec: restSeconds })
                : NCW_I18N.getText('frictionMetricMinutesSeconds', lang, {
                      min: restMins,
                      sec: restSecRem,
                  });

        return `
            <div class="ncw-friction-metrics">
                <span class="ncw-friction-pill">
                    ⏱️ ${NCW_I18N.getText('frictionContinuousMetric', lang, { time: continuousDisplay, min: continuousDisplay })}
                </span>
                <span class="ncw-friction-pill">
                    📅 ${NCW_I18N.getText('frictionTodayMetric', lang, { time: todayDisplay, hours, min: mins })}
                </span>
                <span class="ncw-friction-pill ncw-friction-pill-rest">
                    🌿 ${(context.todayBreakCount || 0) > 0 ? NCW_I18N.getText('frictionRestTodayMetricWithCount', lang, { time: restDisplay, count: context.todayBreakCount || 0 }) : NCW_I18N.getText('frictionRestTodayMetric', lang, { time: restDisplay })}
                </span>
                ${
                    context.curfewTime
                        ? `<span class="ncw-friction-pill">🌙 ${NCW_I18N.getText('frictionCurfewMetric', lang, { time: context.curfewTime })}</span>`
                        : ''
                }
            </div>
        `;
    },

    renderIntro(
        title: string,
        quote: { text: string; author: string },
        lang: string,
    ): string {
        return `
            <div class="ncw-friction-intro" id="ncw-friction-intro">
                <div class="ncw-friction-intro-title">${this.escapeHtml(title)}</div>
                <div class="ncw-friction-intro-body">
                    <div class="ncw-friction-intro-quote">"${this.escapeHtml(quote.text)}"</div>
                    <div class="ncw-friction-intro-author">— ${this.escapeHtml(quote.author)}</div>
                </div>
                <div class="ncw-friction-intro-hint">${NCW_I18N.getText('frictionSkipIntro', lang)}</div>
            </div>
        `;
    },

    renderMainContent(
        context: FrictionBreakContext,
        screenType: FrictionScreenType,
        lang: string,
    ): string {
        let title = NCW_I18N.getText('frictionBreakTitle', lang);
        let headerIcon = '🍵';
        if (context.reason === 'daily_limit') {
            title = NCW_I18N.getText('frictionDailyTitle', lang);
            headerIcon = '📊';
        } else if (context.reason === 'curfew') {
            title = NCW_I18N.getText('frictionCurfewTitle', lang);
            headerIcon = '🌙';
        }

        const quotes = this.getCuratedQuotes(lang);
        const introQuote = quotes[Math.floor(Math.random() * quotes.length)];
        const introHtml = this.renderIntro(title, introQuote, lang);

        const isHardBlock =
            context.reason === 'daily_limit' || context.reason === 'curfew';
        const countdownSeconds =
            context.remainingSeconds !== undefined
                ? context.remainingSeconds
                : context.countdownSeconds || 20;
        const isInterval = context.reason === 'interval';

        const metricPills = this.renderMetrics(context, lang);
        const activityHtml = this.renderActivity(
            screenType,
            lang,
            countdownSeconds,
            isInterval,
            isHardBlock,
            context.reason,
        );

        const adviceHtml = `
            <div class="ncw-friction-advice-box" style="${context.llmAdvice ? 'display: block;' : 'display: none;'}">
                <div class="ncw-friction-advice-header">
                    <span>✨ ${NCW_I18N.getText('frictionAdviceTitle', lang)}</span>
                </div>
                <div class="ncw-friction-advice-text">${this.escapeHtml(context.llmAdvice || '')}</div>
            </div>
        `;

        return `
            <div class="ncw-friction-backdrop"></div>
            ${introHtml}
            <div class="ncw-friction-card" id="ncw-friction-card">
                <div class="ncw-friction-header">
                    <span class="ncw-friction-icon">${headerIcon}</span>
                    <h2 class="ncw-friction-title">${this.escapeHtml(title)}</h2>
                    ${
                        context.showTitle
                            ? `<div class="ncw-friction-show-title">🎬 ${this.escapeHtml(context.showTitle)}</div>`
                            : ''
                    }
                </div>

                ${metricPills}
                ${activityHtml}
                ${adviceHtml}

                <div class="ncw-friction-penalty-banner" id="ncw-friction-penalty-banner" style="display: none;"></div>

                <div class="ncw-friction-actions">
                    ${
                        !isHardBlock
                            ? `
                            <button type="button" class="ncw-friction-btn ncw-friction-btn-primary" id="ncw-friction-continue-btn">
                                ${NCW_I18N.getText('frictionBtnContinue', lang)}
                            </button>
                            <button type="button" class="ncw-friction-btn ncw-friction-btn-ghost" id="ncw-friction-done-btn">
                                ${NCW_I18N.getText('frictionBtnDone', lang)}
                            </button>
                            `
                            : `
                            <button type="button" class="ncw-friction-btn ncw-friction-btn-primary" id="ncw-friction-done-btn" style="width: 100%; max-width: 280px; padding: 12px 24px;">
                                ${NCW_I18N.getText('frictionBtnDone', lang)}
                            </button>
                            `
                    }
                </div>
            </div>
        `;
    },

    renderRestingCard(lang: string, reason?: FrictionTriggerReason): string {
        const isCurfew = reason === 'curfew';
        const isLimit = reason === 'daily_limit';

        const icon = isCurfew ? '🌙' : isLimit ? '📊' : '🍵';
        const title = isCurfew
            ? NCW_I18N.getText('frictionCurfewTitle', lang)
            : isLimit
              ? NCW_I18N.getText('frictionDailyTitle', lang)
              : NCW_I18N.getText('frictionBtnDone', lang);

        const desc = isCurfew
            ? NCW_I18N.getText('frictionCurfewRestDesc', lang)
            : isLimit
              ? NCW_I18N.getText('frictionLimitRestDesc', lang)
              : NCW_I18N.getText('frictionDoneRestDesc', lang);

        return `
            <div style="font-size: 48px; margin-bottom: 16px;">${icon}</div>
            <h2 style="font-size: 24px; font-weight: 700; color: #f8fafc; margin: 0 0 10px 0;">
                ${this.escapeHtml(title)}
            </h2>
            <p style="font-size: 14px; color: #94a3b8; max-width: 420px; line-height: 1.6; margin: 0 0 24px 0;">
                ${this.escapeHtml(desc)}
            </p>
            <div style="display: flex; gap: 12px; justify-content: center;">
                <button type="button" class="ncw-friction-btn ncw-friction-btn-primary" id="ncw-friction-close-tab-btn" style="padding: 12px 28px;">
                    🚪 ${NCW_I18N.getText('frictionBtnCloseTab', lang)}
                </button>
            </div>
        `;
    },

    renderRhythmStage(difficulty: 'easy' | 'hard', lang: string): string {
        const modeBadge =
            difficulty === 'hard'
                ? NCW_I18N.getText('frictionModeArithmetic', lang)
                : NCW_I18N.getText('frictionModeRhythm', lang);

        return `
            <div class="ncw-rhythm-header">
                <span id="ncw-rhythm-progress"></span>
                <span style="color: #38bdf8;">${this.escapeHtml(modeBadge)}</span>
            </div>
            <div class="ncw-rhythm-track" id="ncw-rhythm-track"></div>
            <div class="ncw-rhythm-beat-box">
                <div class="ncw-rhythm-target-expr" id="ncw-rhythm-expr">...</div>
                <div class="ncw-rhythm-target-hint" id="ncw-rhythm-hint"></div>
            </div>
            <div class="ncw-rhythm-timer-wrap">
                <div class="ncw-rhythm-timer-bar" id="ncw-rhythm-bar" style="width: 100%;"></div>
            </div>
            <button type="button" class="ncw-rhythm-tap-pad" id="ncw-rhythm-tap-btn">
                ${NCW_I18N.getText('frictionRhythmTapBtn', lang)}
            </button>
            <div class="ncw-rhythm-counter" id="ncw-rhythm-counter">${this.escapeHtml(NCW_I18N.getText('frictionRhythmClicksInit', lang))}</div>
            <div class="ncw-rhythm-msg" id="ncw-rhythm-msg"></div>
        `;
    },

    renderRhythmPills(beats: RhythmBeatItem[]): string {
        return beats
            .map(
                (b, idx) =>
                    `<span class="ncw-rhythm-pill" data-idx="${idx}">${this.escapeHtml(b.label)}</span>`,
            )
            .join('');
    },
};
