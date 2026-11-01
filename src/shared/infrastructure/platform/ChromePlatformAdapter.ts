import { Logger } from '@shared/utils/logger';
import {
    IBrowserPlatform,
    ActiveTabInfo,
    PopupWindowOptions,
    PlatformMessageSender,
    PlatformMessageListener,
} from './IBrowserPlatform';

interface WebExtensionPolyfill {
    runtime?: {
        getURL?: (path: string) => string;
        sendMessage?: (message: unknown) => Promise<unknown>;
    };
    declarativeNetRequest?: typeof chrome.declarativeNetRequest;
}

declare const browser: WebExtensionPolyfill | undefined;

/**
 * Chrome Platform Implementation of IBrowserPlatform.
 */
export class ChromePlatformAdapter implements IBrowserPlatform {
    private static instance: ChromePlatformAdapter | null = null;

    private logger: Logger = new Logger('ChromePlatformAdapter');

    static getInstance(): ChromePlatformAdapter {
        if (!ChromePlatformAdapter.instance) {
            ChromePlatformAdapter.instance = new ChromePlatformAdapter();
        }
        return ChromePlatformAdapter.instance;
    }

    async getActiveTab(): Promise<ActiveTabInfo | null> {
        return new Promise((resolve) => {
            if (
                typeof chrome === 'undefined' ||
                !chrome.tabs ||
                !chrome.tabs.query
            ) {
                resolve(null);
                return;
            }
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs && tabs[0];
                this.logger.info(
                    'Platform',
                    `get tab id: ${tab.id}, tab title: ${tab.title}, tab url: ${tab.url}`,
                );
                if (tab) {
                    resolve({
                        id: tab.id,
                        url: tab.url,
                        title: tab.title,
                    });
                } else {
                    resolve(null);
                }
            });
        });
    }

    openOptionsPage(): void {
        if (
            typeof chrome !== 'undefined' &&
            chrome.runtime &&
            chrome.runtime.openOptionsPage
        ) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open('../options/options.html', '_blank');
        }
    }

    createTab(url: string): void {
        if (
            typeof chrome !== 'undefined' &&
            chrome.tabs &&
            chrome.tabs.create
        ) {
            chrome.tabs.create({ url });
        } else {
            window.open(url, '_blank');
        }
    }

    getURL(path: string): string {
        const cleanPath = path.replace(/^\/+/, '');
        if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
            return chrome.runtime.getURL(cleanPath);
        }
        if (
            typeof browser !== 'undefined' &&
            browser?.runtime?.getURL
        ) {
            return browser.runtime.getURL(cleanPath);
        }
        return cleanPath;
    }

    async openPopupWindow(
        options: PopupWindowOptions,
    ): Promise<number | undefined> {
        const width = options.width || 760;
        const height = options.height || 800;

        let fullUrl = options.url;
        if (
            !fullUrl.startsWith('http://') &&
            !fullUrl.startsWith('https://') &&
            !fullUrl.startsWith('chrome-extension://') &&
            !fullUrl.startsWith('moz-extension://')
        ) {
            fullUrl = this.getURL(fullUrl);
        }

        if (typeof chrome !== 'undefined' && chrome.windows?.create) {
            // Calculate centered position if screen info available
            let left: number | undefined;
            let top: number | undefined;
            try {
                if (typeof window !== 'undefined' && window.screen) {
                    left = Math.round((window.screen.availWidth - width) / 2);
                    top = Math.round((window.screen.availHeight - height) / 2);
                }
            } catch {
                // Fallback to default
            }

            try {
                const win = await chrome.windows.create({
                    url: fullUrl,
                    type: 'popup',
                    width,
                    height,
                    left,
                    top,
                    focused: true,
                });
                return win?.id;
            } catch (e) {
                this.logger.warn(
                    'Platform',
                    'chrome.windows.create failed, falling back to window.open:',
                    e,
                );
            }
        }

        if (
            typeof window !== 'undefined' &&
            typeof window.open === 'function'
        ) {
            window.open(
                fullUrl,
                options.title || 'PopupWindow',
                `width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no`,
            );
        } else if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
            chrome.tabs.create({ url: fullUrl });
        }
        return undefined;
    }

    async setupOllamaRules(customHost?: string): Promise<void> {
        const dnr =
            (typeof chrome !== 'undefined' && chrome.declarativeNetRequest) ||
            (typeof browser !== 'undefined' &&
                browser?.declarativeNetRequest);
        if (!dnr) return;

        try {
            const modifyHeadersType = (dnr.RuleActionType?.MODIFY_HEADERS ||
                'modifyHeaders') as chrome.declarativeNetRequest.RuleActionType;
            const removeOp = (dnr.HeaderOperation?.REMOVE ||
                'remove') as chrome.declarativeNetRequest.HeaderOperation;
            const xmlHttpRes = (dnr.ResourceType?.XMLHTTPREQUEST ||
                'xmlhttprequest') as chrome.declarativeNetRequest.ResourceType;
            const otherRes = (dnr.ResourceType?.OTHER ||
                'other') as chrome.declarativeNetRequest.ResourceType;

            const rules: chrome.declarativeNetRequest.Rule[] = [
                {
                    id: 101,
                    priority: 10,
                    action: {
                        type: modifyHeadersType,
                        requestHeaders: [
                            { header: 'Origin', operation: removeOp },
                        ],
                    },
                    condition: {
                        urlFilter: ':11434/',
                        resourceTypes: [xmlHttpRes, otherRes],
                    },
                },
                {
                    id: 102,
                    priority: 10,
                    action: {
                        type: modifyHeadersType,
                        requestHeaders: [
                            { header: 'Origin', operation: removeOp },
                        ],
                    },
                    condition: {
                        urlFilter: '||localhost/',
                        resourceTypes: [xmlHttpRes, otherRes],
                    },
                },
                {
                    id: 103,
                    priority: 10,
                    action: {
                        type: modifyHeadersType,
                        requestHeaders: [
                            { header: 'Origin', operation: removeOp },
                        ],
                    },
                    condition: {
                        urlFilter: '||127.0.0.1/',
                        resourceTypes: [xmlHttpRes, otherRes],
                    },
                },
            ];

            if (customHost) {
                try {
                    const u = new URL(customHost);
                    rules.push({
                        id: 104,
                        priority: 10,
                        action: {
                            type: modifyHeadersType,
                            requestHeaders: [
                                {
                                    header: 'Origin',
                                    operation: removeOp,
                                },
                            ],
                        },
                        condition: {
                            urlFilter: `||${u.host}/`,
                            resourceTypes: [xmlHttpRes, otherRes],
                        },
                    });
                } catch {
                    // Ignore invalid URL
                }
            }

            await dnr.updateDynamicRules({
                removeRuleIds: [101, 102, 103, 104],
                addRules: rules,
            });
        } catch {
            // Ignore rules failure
        }
    }

    async setupStorageSecurity(
        accessLevel:
            | 'TRUSTED_CONTEXTS'
            | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' = 'TRUSTED_CONTEXTS',
    ): Promise<void> {
        try {
            if (
                typeof chrome !== 'undefined' &&
                chrome.storage?.local &&
                typeof (
                    chrome.storage.local as {
                        setAccessLevel?: (options: {
                            accessLevel: string;
                        }) => Promise<void>;
                    }
                ).setAccessLevel === 'function'
            ) {
                await (
                    chrome.storage.local as {
                        setAccessLevel: (options: {
                            accessLevel: string;
                        }) => Promise<void>;
                    }
                ).setAccessLevel({ accessLevel });
                this.logger.info(
                    'Platform',
                    `Storage local access level restricted to: ${accessLevel}`,
                );
            }
        } catch (e) {
            this.logger.debug(
                'Platform',
                'Storage setAccessLevel not supported in this runtime, safely ignored:',
                e,
            );
        }
    }

    onInstalled(callback: () => void): void {
        if (
            typeof chrome !== 'undefined' &&
            chrome.runtime &&
            chrome.runtime.onInstalled
        ) {
            chrome.runtime.onInstalled.addListener(callback);
        }
    }

    onStartup(callback: () => void): void {
        if (
            typeof chrome !== 'undefined' &&
            chrome.runtime &&
            chrome.runtime.onStartup
        ) {
            chrome.runtime.onStartup.addListener(callback);
        }
    }

    isContextValid(): boolean {
        return Boolean(
            typeof chrome !== 'undefined' &&
            chrome.runtime &&
            chrome.runtime.id,
        );
    }

    createAlarm(
        name: string,
        alarmInfo: {
            periodInMinutes?: number;
            delayInMinutes?: number;
            when?: number;
        },
    ): void {
        if (
            typeof chrome !== 'undefined' &&
            chrome.alarms &&
            typeof chrome.alarms.create === 'function'
        ) {
            chrome.alarms.create(
                name,
                alarmInfo as chrome.alarms.AlarmCreateInfo,
            );
        }
    }

    onAlarm(callback: (alarmName: string) => void): () => void {
        if (
            typeof chrome !== 'undefined' &&
            chrome.alarms &&
            chrome.alarms.onAlarm
        ) {
            const listener = (alarm: chrome.alarms.Alarm) => {
                callback(alarm.name);
            };
            chrome.alarms.onAlarm.addListener(listener);
            return () => chrome.alarms.onAlarm.removeListener(listener);
        }
        return () => {};
    }

    async sendMessage<T = unknown>(message: unknown): Promise<T> {
        if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
            try {
                const response = await browser.runtime.sendMessage(message);
                return (response ?? {
                    success: false,
                    error: 'No response',
                }) as T;
            } catch (err) {
                return {
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                } as T;
            }
        }

        return new Promise((resolve) => {
            try {
                if (!this.isContextValid()) {
                    resolve({
                        success: false,
                        error: 'Extension context invalidated',
                    } as T);
                    return;
                }

                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({
                            success: false,
                            error: chrome.runtime.lastError.message,
                        } as T);
                        return;
                    }
                    resolve(response as T);
                });
            } catch (err) {
                resolve({
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                } as T);
            }
        });
    }

    async broadcastToTabs(message: unknown): Promise<void> {
        if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query)
            return;
        try {
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
                if (tab.id) {
                    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
                }
            }
        } catch (_e) {
            // Ignore
        }
    }

    onMessage(listener: PlatformMessageListener): () => void {
        if (
            typeof chrome === 'undefined' ||
            !chrome.runtime ||
            !chrome.runtime.onMessage
        ) {
            return () => {};
        }

        const chromeListener = (
            message: unknown,
            sender: chrome.runtime.MessageSender,
            sendResponse: (res?: unknown) => void,
        ) => {
            const platformSender: PlatformMessageSender = {
                id: sender.id,
                url: sender.url,
                tab: sender.tab
                    ? {
                          id: sender.tab.id,
                          url: sender.tab.url,
                          title: sender.tab.title,
                      }
                    : undefined,
            };
            return listener(message, platformSender, sendResponse);
        };

        chrome.runtime.onMessage.addListener(chromeListener);
        return () => chrome.runtime.onMessage.removeListener(chromeListener);
    }

    onTabRemoved(callback: (tabId: number) => void): () => void {
        if (
            typeof chrome === 'undefined' ||
            !chrome.tabs ||
            !chrome.tabs.onRemoved
        ) {
            return () => {};
        }

        chrome.tabs.onRemoved.addListener(callback);
        return () => chrome.tabs.onRemoved.removeListener(callback);
    }

    onWindowRemoved(callback: (windowId: number) => void): () => void {
        if (
            typeof chrome === 'undefined' ||
            !chrome.windows ||
            !chrome.windows.onRemoved
        ) {
            return () => {};
        }

        chrome.windows.onRemoved.addListener(callback);
        return () => chrome.windows.onRemoved.removeListener(callback);
    }

    async closeWindow(windowId: number): Promise<void> {
        if (
            typeof chrome !== 'undefined' &&
            chrome.windows &&
            chrome.windows.remove
        ) {
            try {
                await chrome.windows.remove(windowId);
            } catch {
                // Window might already be closed
            }
        }
    }
}
