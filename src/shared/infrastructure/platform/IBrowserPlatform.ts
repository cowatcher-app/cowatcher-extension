export interface ActiveTabInfo {
    id?: number;
    url?: string;
    title?: string;
}

export interface PopupWindowOptions {
    url: string;
    width?: number;
    height?: number;
    title?: string;
}

export interface PlatformMessageSender {
    id?: string;
    url?: string;
    tab?: ActiveTabInfo;
}

export type PlatformMessageListener = (
    message: unknown,
    sender: PlatformMessageSender,
    sendResponse: (res?: unknown) => void,
) => boolean | void;

/**
 * Generic Browser Platform API Abstraction.
 * Decouples platform actions (tabs, window navigation, declarative header rules, runtime messaging).
 */
export interface IBrowserPlatform {
    getURL(path: string): string;
    getActiveTab(): Promise<ActiveTabInfo | null>;
    openOptionsPage(): void;
    createTab(url: string): void;
    openPopupWindow(options: PopupWindowOptions): Promise<number | undefined>;
    setupOllamaRules(customHost?: string): Promise<void>;
    setupStorageSecurity(
        accessLevel?: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
    ): Promise<void>;
    onInstalled(callback: () => void): void;
    onStartup(callback: () => void): void;
    isContextValid(): boolean;

    // --- Background Alarms ---
    createAlarm(
        name: string,
        alarmInfo: {
            periodInMinutes?: number;
            delayInMinutes?: number;
            when?: number;
        },
    ): void;
    onAlarm(callback: (alarmName: string) => void): () => void;

    // --- Runtime Messaging & Tabs Lifecycle ---
    sendMessage<T = unknown>(message: unknown): Promise<T>;
    broadcastToTabs(message: unknown): Promise<void>;
    onMessage(listener: PlatformMessageListener): () => void;
    onTabRemoved(callback: (tabId: number) => void): () => void;
    onWindowRemoved(callback: (windowId: number) => void): () => void;
    closeWindow(windowId: number): Promise<void>;
}
