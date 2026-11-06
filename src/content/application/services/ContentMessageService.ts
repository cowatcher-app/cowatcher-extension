import { ContentBackgroundBus } from '@shared/infrastructure/bus/ContentBackgroundBus';
import { AiSubState } from '@shared/domain/entities/AiSubState';
import { ContextDTO } from '@shared/domain/entities/Context';
import { ExtensionSettings } from '@shared/domain/constants/SettingsDefaults';
import {
    TranslateCueItem,
    ReviewCueItem,
    PrecedingContextItem,
    MessagePayloadMap,
} from '@shared/types/Messages';
import { MergeAsrCueItem } from '@shared/domain/entities/Subtitle';
import { LanguageInfo } from '@shared/domain/value-objects/Language';
import { StreamingPlatformId } from '@shared/domain/constants/StreamingPlatforms';
import { ActiveFrictionBreak } from '@shared/domain/entities/ViewingFriction';
import NCW_CONSTANTS from '@shared/utils/constants';

export class ContentMessageService {
    private static instance: ContentMessageService | null = null;

    static getInstance(): ContentMessageService {
        if (!ContentMessageService.instance) {
            ContentMessageService.instance = new ContentMessageService();
        }
        return ContentMessageService.instance;
    }

    // --- AI Sub State Operations ---

    async fetchAiSubState(): Promise<AiSubState | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_AI_SUB_STATE,
            undefined,
        );
        return res.success && res.state ? new AiSubState(res.state) : null;
    }

    async setAiSubEnabled(
        enabled: boolean,
        platform?: StreamingPlatformId,
    ): Promise<AiSubState | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.SET_AI_SUB_ENABLED,
            {
                enabled,
                platform,
            },
        );
        return res.success && res.state ? new AiSubState(res.state) : null;
    }

    onAiSubStateChanged(callback: (state: AiSubState) => void): () => void {
        return ContentBackgroundBus.onMessage(
            NCW_CONSTANTS.MESSAGE_TYPES.PUSH_AI_SUB_STATE_CHANGED,
            (payload) => {
                if (payload && payload.state) {
                    callback(new AiSubState(payload.state));
                }
            },
        );
    }

    // --- Settings Operations ---

    async fetchSettings(): Promise<ExtensionSettings | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_SETTINGS,
            undefined,
        );
        return res.success && res.settings ? res.settings : null;
    }

    async saveSettings(
        settings: Partial<ExtensionSettings>,
    ): Promise<ExtensionSettings | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.SAVE_SETTINGS,
            { settings },
        );
        return res.success && res.settings ? res.settings : null;
    }

    // --- Glossary Operations ---

    async fetchGlossary(
        params: {
            videoId?: string;
            mainTitle?: string;
            showId?: string;
        } = {},
    ): Promise<ContextDTO | null> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_CONTEXT,
            params,
        );
        return res.success ? res.context : null;
    }

    async getGlossaryContext(params: {
        videoId?: string;
        mainTitle?: string;
        showId?: string;
    }): Promise<{ success: boolean; context: ContextDTO | null }> {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_CONTEXT,
            params,
        );
    }

    onGlossaryChanged(callback: (context: ContextDTO) => void): () => void {
        return ContentBackgroundBus.onMessage(
            NCW_CONSTANTS.MESSAGE_TYPES.PUSH_GLOSSARY_CHANGED,
            (payload) => {
                if (payload && payload.context) {
                    callback(payload.context);
                }
            },
        );
    }

    onCuesStale(
        callback: (
            payload: MessagePayloadMap[typeof NCW_CONSTANTS.MESSAGE_TYPES.PUSH_CUES_STALE]['request'],
        ) => void,
    ): () => void {
        return ContentBackgroundBus.onMessage(
            NCW_CONSTANTS.MESSAGE_TYPES.PUSH_CUES_STALE,
            (payload) => {
                if (payload) {
                    callback(payload);
                }
            },
        );
    }

    async warmupGlossaryContext(params: {
        title: string;
        mainTitle: string;
        sampleDialogues: string;
        videoId: string;
        showId?: string;
        seasonId?: string;
        showSummary?: string;
        episodeSummary?: string;
    }): Promise<{ success: boolean; context: ContextDTO | null }> {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.WARMUP_CONTEXT,
            params,
        );
    }

    // --- Translation Pipeline Operations ---

    async mergeAsrBatch(params: { items: MergeAsrCueItem[] }): Promise<{
        success: boolean;
        mergedCues?: MergeAsrCueItem[];
        error?: string;
    }> {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.MERGE_ASR_BATCH,
            params,
        );
    }

    async translateBatch(params: {
        items: TranslateCueItem[];
        contextItems?: PrecedingContextItem[];
        trackHash?: string;
        showId?: string;
        movieId?: string;
        mainTitle?: string;
        urgent?: boolean;
    }): Promise<{
        success: boolean;
        results?: Record<number, string>;
        error?: string;
    }> {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.TRANSLATE_BATCH,
            params,
        );
    }

    async reviewBatch(params: {
        items: ReviewCueItem[];
        contextItems?: PrecedingContextItem[];
        trackHash?: string;
        showId?: string;
        movieId?: string;
        mainTitle?: string;
        status?: 'reviewed' | 'pre_reviewed';
    }): Promise<{
        success: boolean;
        corrections?: Record<number, string>;
        usedTermsMap?: Record<number, Record<string, number>>;
        updatedContext?: ContextDTO;
        error?: string;
    }> {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.SUPERVISOR_REVIEW,
            params,
        );
    }

    async getSubtitleCache(params: {
        trackHash: string;
        movieId?: string;
        targetLanguage?: string;
    }) {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_SUBTITLE_CACHE,
            params,
        );
    }

    async saveSubtitleCache(params: {
        trackHash: string;
        movieId: string;
        showTitle?: string;
        targetLanguage: string;
        provider?: string;
        translationModel?: string;
        supervisorModel?: string;
        results: Record<string | number, string>;
    }) {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.SAVE_SUBTITLE_CACHE,
            params,
        );
    }

    async extractTermsFromNativeBilingualCues(params: {
        showId: string;
        targetLanguage: LanguageInfo;
        pairs: Array<{ originalText: string; translatedText: string }>;
    }) {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.EXTRACT_NATIVE_TERMS,
            params,
        );
    }

    async clearQueues(): Promise<void> {
        await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.CLEAR_QUEUES,
            undefined,
        );
    }

    async sendHeartbeat(params: {
        showId?: string | null;
        videoId?: string | null;
        targetLanguage?: LanguageInfo;
    }): Promise<boolean> {
        try {
            const res = await ContentBackgroundBus.send(
                NCW_CONSTANTS.MESSAGE_TYPES.HEARTBEAT,
                params,
            );
            return Boolean(res?.success);
        } catch {
            return false;
        }
    }

    async unloadContext(
        showId: string,
        targetLanguage: LanguageInfo,
    ): Promise<void> {
        await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.UNLOAD_CONTEXT,
            {
                showId,
                targetLanguage,
            },
        );
    }

    async notifyEpisodeChanged(
        showId: string,
        targetLanguage: LanguageInfo,
        title?: string,
        mainTitle?: string,
        showSynopsis?: string,
        episodeSynopsis?: string,
        episodeId?: string,
        episodeNumber?: string,
        seasonId?: string,
    ): Promise<void> {
        await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.EPISODE_CHANGED,
            {
                showId,
                targetLanguage,
                title,
                mainTitle,
                showSynopsis,
                episodeSynopsis,
                episodeId,
                episodeNumber,
                seasonId,
            },
        );
    }

    async feedVocabCues(params: {
        movieId: string;
        cues: TranslateCueItem[];
        showTitle: string;
        sourceLanguage?: LanguageInfo | 'auto';
        trackHash?: string;
    }): Promise<void> {
        await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.FEED_VOCAB_CUES,
            params,
        );
    }

    async saveUserVocabWord(params: {
        movieId: string;
        showTitle?: string;
        wordItem: import('@shared/domain/entities/Vocabulary').VocabWordItem;
    }) {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.SAVE_USER_VOCAB_WORD,
            params,
        );
    }

    async deleteUserVocabWord(params: { movieId: string; word: string }) {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.DELETE_USER_VOCAB_WORD,
            params,
        );
    }

    async lookupWordDefinition(
        req: import('@shared/domain/entities/SubtitleLearning').WordLookupRequest,
    ) {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.LOOKUP_WORD_DEFINITION,
            req,
        );
    }

    async getVocabData(movieId?: string) {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_VOCAB_DATA,
            { movieId },
        );
        return res?.data || null;
    }

    onVocabChanged(
        callback: (
            data: import('@shared/domain/entities/Vocabulary').EpisodeVocabData,
        ) => void,
    ): () => void {
        return ContentBackgroundBus.onMessage(
            NCW_CONSTANTS.MESSAGE_TYPES.PUSH_VOCAB_CHANGED,
            (payload) => {
                if (payload && payload.data) {
                    callback(payload.data);
                }
            },
        );
    }

    async recordWatchSession(
        session: import('@shared/domain/entities/WatchHistory').WatchSession,
    ) {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.RECORD_WATCH_SESSION,
            { session },
        );
    }

    async getTodayWatchTime(excludedPlatforms: string[] = []): Promise<{
        todaySeconds: number;
        todaySessions: number;
        platformSeconds: Record<string, number>;
        todayRestSeconds: number;
        todayBreakCount: number;
    }> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_TODAY_WATCH_TIME,
            { excludedPlatforms },
        );
        return {
            todaySeconds: res?.todaySeconds || 0,
            todaySessions: res?.todaySessions || 0,
            platformSeconds: res?.platformSeconds || {},
            todayRestSeconds: res?.todayRestSeconds || 0,
            todayBreakCount: res?.todayBreakCount || 0,
        };
    }

    async recordRestTime(restSeconds: number): Promise<{
        totalRestSeconds: number;
        breakCount: number;
    }> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.RECORD_REST_TIME,
            { restSeconds },
        );
        return {
            totalRestSeconds: res?.totalRestSeconds || 0,
            breakCount: res?.breakCount || 0,
        };
    }

    async getFrictionAdvice(params: {
        reason: string;
        showTitle?: string;
        watchMinutes: number;
        todayMinutes: number;
        watchSeconds?: number;
        todaySeconds?: number;
        todayRestSeconds?: number;
        todayBreakCount?: number;
        platform?: string;
        curfewTime?: string;
    }): Promise<string | undefined> {
        try {
            const res = await ContentBackgroundBus.send(
                NCW_CONSTANTS.MESSAGE_TYPES.GET_FRICTION_ADVICE,
                params,
            );
            return res?.success ? res.advice : undefined;
        } catch {
            return undefined;
        }
    }

    async closeCurrentTab(): Promise<boolean> {
        try {
            const res = await ContentBackgroundBus.send(
                NCW_CONSTANTS.MESSAGE_TYPES.CLOSE_CURRENT_TAB,
                {},
            );
            return res?.success ?? false;
        } catch {
            return false;
        }
    }

    async sendFrictionHeartbeat(params: {
        isPlaying: boolean;
        platform: string;
        showTitle?: string;
    }): Promise<{
        shouldPause: boolean;
        activeBreak: ActiveFrictionBreak | null;
        continuousSeconds: number;
        todaySeconds: number;
        todayRestSeconds: number;
        todayBreakCount: number;
        isStoppedForToday: boolean;
    }> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.FRICTION_HEARTBEAT,
            params,
        );
        return {
            shouldPause: res?.shouldPause ?? false,
            activeBreak: res?.activeBreak ?? null,
            continuousSeconds: res?.continuousSeconds ?? 0,
            todaySeconds: res?.todaySeconds ?? 0,
            todayRestSeconds: res?.todayRestSeconds ?? 0,
            todayBreakCount: res?.todayBreakCount ?? 0,
            isStoppedForToday: res?.isStoppedForToday ?? false,
        };
    }

    async tickFrictionBreak(breakId: string): Promise<{
        remainingSeconds: number;
        isCompleted: boolean;
    }> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.TICK_FRICTION_BREAK,
            { breakId },
        );
        return {
            remainingSeconds: res?.remainingSeconds ?? 0,
            isCompleted: res?.isCompleted ?? true,
        };
    }

    async completeFrictionBreak(
        breakId: string,
        passedChallenge?: boolean,
    ): Promise<{ success: boolean; canResume: boolean }> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.COMPLETE_FRICTION_BREAK,
            { breakId, passedChallenge },
        );
        return {
            success: res?.success ?? false,
            canResume: res?.canResume ?? true,
        };
    }

    async dismissHardBlock(breakId: string): Promise<boolean> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.DISMISS_HARD_BLOCK,
            { breakId },
        );
        return res?.success ?? false;
    }

    async updateFrictionPenalty(params: {
        breakId: string;
        consecutiveFailures: number;
        sequenceLength: number;
        lockoutUntil?: number;
    }): Promise<boolean> {
        const res = await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.UPDATE_FRICTION_PENALTY,
            params,
        );
        return res?.success ?? false;
    }

    async getPhoneticReading(params: {
        word: string;
        lang: string;
        system?: string;
    }): Promise<{ success: boolean; reading: string; error?: string }> {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_PHONETIC_READING,
            params,
        );
    }

    async getPhoneticBatch(params: {
        words: string[];
        lang: string;
        system?: string;
    }): Promise<{
        success: boolean;
        readings: Record<string, string>;
        error?: string;
    }> {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_PHONETIC_BATCH,
            params,
        );
    }

    async getTtsAudio(params: {
        text: string;
        lang: string;
    }): Promise<{ success: boolean; audioBase64?: string; error?: string }> {
        return await ContentBackgroundBus.send(
            NCW_CONSTANTS.MESSAGE_TYPES.GET_TTS_AUDIO,
            params,
        );
    }

    onSettingsChanged(
        callback: (settings: ExtensionSettings) => void,
    ): () => void {
        return ContentBackgroundBus.onMessage(
            NCW_CONSTANTS.MESSAGE_TYPES.PUSH_SETTINGS_CHANGED,
            (payload) => {
                if (payload && payload.settings) {
                    callback(payload.settings);
                }
            },
        );
    }
}
