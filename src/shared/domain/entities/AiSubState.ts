import { Language, LanguageInfo } from '../value-objects/Language';
import {
    StreamingPlatformId,
    STREAMING_PLATFORMS,
} from '../constants/StreamingPlatforms';

export class AiSubState {
    readonly enabled: boolean;
    readonly platformEnabled: Partial<Record<StreamingPlatformId, boolean>>;
    readonly targetLanguage: LanguageInfo;
    readonly displayMode: 'bilingual' | 'translated' | 'original';
    readonly isOverlayVisible: boolean;
    readonly updatedAt: number;

    constructor(props: {
        enabled: boolean;
        platformEnabled?: Partial<Record<StreamingPlatformId, boolean>>;
        targetLanguage: LanguageInfo;
        displayMode?: 'bilingual' | 'translated' | 'original';
        isOverlayVisible?: boolean;
        updatedAt?: number;
    }) {
        this.enabled = props.enabled;
        this.platformEnabled = props.platformEnabled ?? {
            [STREAMING_PLATFORMS.NETFLIX]: props.enabled,
            [STREAMING_PLATFORMS.TVER]: props.enabled,
            [STREAMING_PLATFORMS.YOUTUBE]: props.enabled,
            [STREAMING_PLATFORMS.BILIBILI]: props.enabled,
            [STREAMING_PLATFORMS.ITVX]: props.enabled,
            [STREAMING_PLATFORMS.CHANNEL4]: props.enabled,
        };
        this.targetLanguage = props.targetLanguage;
        this.displayMode = props.displayMode ?? 'bilingual';
        this.isOverlayVisible = props.isOverlayVisible ?? true;
        this.updatedAt = props.updatedAt ?? Date.now();
    }

    static defaultState(): AiSubState {
        return new AiSubState({
            enabled: true,
            platformEnabled: {
                [STREAMING_PLATFORMS.NETFLIX]: true,
                [STREAMING_PLATFORMS.TVER]: true,
                [STREAMING_PLATFORMS.YOUTUBE]: true,
                [STREAMING_PLATFORMS.BILIBILI]: true,
                [STREAMING_PLATFORMS.ITVX]: true,
                [STREAMING_PLATFORMS.CHANNEL4]: true,
            },
            targetLanguage: Language.DEFAULT,
            displayMode: 'bilingual',
            isOverlayVisible: true,
            updatedAt: Date.now(),
        });
    }

    isPlatformEnabled(platform?: string | null): boolean {
        if (!platform) {
            return this.enabled;
        }
        const val = this.platformEnabled
            ? this.platformEnabled[platform as StreamingPlatformId]
            : undefined;
        return typeof val === 'boolean' ? val : this.enabled;
    }

    withEnabled(enabled: boolean, platform?: StreamingPlatformId): AiSubState {
        if (platform) {
            return new AiSubState({
                ...this,
                platformEnabled: {
                    ...this.platformEnabled,
                    [platform]: enabled,
                },
                updatedAt: Date.now(),
            });
        }
        return new AiSubState({
            ...this,
            enabled,
            platformEnabled: {
                ...this.platformEnabled,
                [STREAMING_PLATFORMS.NETFLIX]: enabled,
                [STREAMING_PLATFORMS.TVER]: enabled,
                [STREAMING_PLATFORMS.YOUTUBE]: enabled,
                [STREAMING_PLATFORMS.BILIBILI]: enabled,
                [STREAMING_PLATFORMS.ITVX]: enabled,
                [STREAMING_PLATFORMS.CHANNEL4]: enabled,
            },
            updatedAt: Date.now(),
        });
    }

    withTargetLanguage(targetLanguage: LanguageInfo): AiSubState {
        return new AiSubState({
            ...this,
            targetLanguage,
            updatedAt: Date.now(),
        });
    }
}
