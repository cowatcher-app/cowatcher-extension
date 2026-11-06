/**
 * Viewing Static Friction (Mindful Viewing & Anti-Binge Guard) Domain Entities
 */

export type FrictionScreenType =
    | 'screensaver'
    | 'breathing'
    | 'quote'
    | 'puzzle';

export type FrictionUnlockDifficulty = 'none' | 'easy' | 'hard';

export type FrictionTriggerReason =
    | 'interval'
    | 'daily_limit'
    | 'curfew'
    | 'manual';

export interface FrictionPlatformRule {
    enabled?: boolean;
    intervalMinutes?: number;
    dailyLimitMinutes?: number;
}

export interface ViewingFrictionSettings {
    staticFrictionEnabled: boolean;
    frictionIntervalMinutes: number; // Continuous interval before break (e.g. 45 min)
    frictionDailyLimitMinutes: number; // Daily cumulative limit (0 to disable)
    frictionCurfewEnabled: boolean; // Late-night curfew alert
    frictionCurfewTime: string; // "23:30" (24-hour HH:mm)
    frictionScreenType: FrictionScreenType;
    frictionBreakDurationSeconds: number; // Break countdown duration before auto-resuming (e.g. 20s)
    frictionUnlockDifficulty: FrictionUnlockDifficulty;
    frictionAutoResumeOnTimer: boolean;
    frictionEnableLlmAdvice: boolean;
    frictionExcludedPlatforms: string[]; // Platforms excluded from total watch calculation
    frictionPlatformRules: Record<string, FrictionPlatformRule>;
}

export interface ActiveFrictionBreak {
    id: string;
    reason: FrictionTriggerReason;
    totalSeconds: number;
    remainingSeconds: number;
    startedAt: number;
    isHardBlock: boolean;
    curfewTime?: string;
    showTitle?: string;
    platform?: string;
    consecutiveFailures?: number;
    sequenceLength?: number;
    lockoutUntil?: number;
}

export interface FrictionBreakContext {
    breakId?: string;
    reason: FrictionTriggerReason;
    continuousMinutes: number;
    todayMinutes: number;
    continuousSeconds?: number;
    todaySeconds?: number;
    todayRestSeconds?: number;
    todayBreakCount?: number;
    curfewTime?: string;
    showTitle?: string;
    episodeTitle?: string;
    platform?: string;
    llmAdvice?: string;
    unlockDifficulty?: FrictionUnlockDifficulty;
    autoResumeOnTimer?: boolean;
    countdownSeconds?: number;
    remainingSeconds?: number;
    consecutiveFailures?: number;
    sequenceLength?: number;
    lockoutUntil?: number;
}
