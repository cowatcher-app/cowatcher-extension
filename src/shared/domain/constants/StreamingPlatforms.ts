export const STREAMING_PLATFORMS = {
    NETFLIX: 'netflix',
    TVER: 'tver',
    YOUTUBE: 'youtube',
    BILIBILI: 'bilibili',
} as const;

export type StreamingPlatformId =
    (typeof STREAMING_PLATFORMS)[keyof typeof STREAMING_PLATFORMS];
