/**
 * CredentialVaultService
 * Manages secure storage, optional AES-GCM-256 encryption, and in-memory session lifecycle
 * for sensitive API credentials.
 */

import {
    StoredCredentials,
    CredentialVaultStatus,
} from '@shared/domain/entities/CredentialVault';
import { NCW_STORAGE_KEYS } from '@shared/domain/constants/StorageKeys';
import { CryptoVault } from '@shared/infrastructure/security/CryptoVault';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { IBrowserStorage } from '@shared/infrastructure/storage/IBrowserStorage';
import { IBrowserPlatform } from '@shared/infrastructure/platform/IBrowserPlatform';
import { BrowserPlatformFactory } from '@shared/infrastructure/platform/BrowserPlatformFactory';
import { Logger } from '@shared/utils/logger';

const SESSION_CACHE_KEY = 'ncw_session_unlocked_key';

export class CredentialVaultService {
    private static instance: CredentialVaultService | null = null;
    private storage: IBrowserStorage;
    private platform: IBrowserPlatform;
    private currentRecord: StoredCredentials | null = null;
    private sessionUnlockedKey: string | null = null;
    private initialized: boolean = false;
    private logger: Logger = new Logger('CredentialVaultService');

    // On-demand prompt state & deduplication
    private activeUnlockPromise: Promise<boolean> | null = null;
    private activeUnlockResolve: ((success: boolean) => void) | null = null;
    private activeUnlockWindowId: number | null = null;
    private unlockTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

    private constructor(
        storage: IBrowserStorage = BrowserStorageFactory.getStorage(),
        platform: IBrowserPlatform = BrowserPlatformFactory.getPlatform(),
    ) {
        this.storage = storage;
        this.platform = platform;

        // Automatically resolve pending prompt with false if user manually closes the window
        this.platform.onWindowRemoved((windowId) => {
            if (this.activeUnlockWindowId && this.activeUnlockWindowId === windowId) {
                this.resolveUnlock(false);
            }
        });
    }

    static getInstance(
        storage?: IBrowserStorage,
        platform?: IBrowserPlatform,
    ): CredentialVaultService {
        if (!CredentialVaultService.instance) {
            CredentialVaultService.instance = new CredentialVaultService(
                storage,
                platform,
            );
        }
        return CredentialVaultService.instance;
    }

    async init(): Promise<void> {
        if (this.initialized) return;

        await this.loadFromStorage();
        await this.restoreSessionKey();
        await this.migrateLegacySettings();

        this.storage.onChanged((changes) => {
            if (changes[NCW_STORAGE_KEYS.SECURE_CREDENTIALS]?.newValue) {
                this.currentRecord = changes[
                    NCW_STORAGE_KEYS.SECURE_CREDENTIALS
                ].newValue as StoredCredentials;
            }
        });

        this.initialized = true;
    }

    private async loadFromStorage(): Promise<void> {
        try {
            const res = await this.storage.get<StoredCredentials>([
                NCW_STORAGE_KEYS.SECURE_CREDENTIALS,
            ]);
            this.currentRecord = res?.[NCW_STORAGE_KEYS.SECURE_CREDENTIALS] || null;
        } catch (err) {
            this.logger.error(
                'CredentialVault',
                'Failed to load secure credentials from storage',
                err,
            );
        }
    }

    /**
     * Attempts to restore the session key from chrome.storage.session (in-memory).
     */
    private async restoreSessionKey(): Promise<void> {
        if (
            typeof chrome !== 'undefined' &&
            chrome.storage &&
            'session' in chrome.storage &&
            chrome.storage.session
        ) {
            try {
                const sessionRes = await new Promise<Record<string, unknown>>(
                    (resolve) => {
                        chrome.storage.session.get([SESSION_CACHE_KEY], (res) => {
                            resolve(res || {});
                        });
                    },
                );
                if (
                    sessionRes[SESSION_CACHE_KEY] &&
                    typeof sessionRes[SESSION_CACHE_KEY] === 'string'
                ) {
                    this.sessionUnlockedKey = sessionRes[SESSION_CACHE_KEY] as string;
                }
            } catch {
                // chrome.storage.session may not be permitted in all contexts
            }
        }
    }

    private async persistSessionKey(key: string | null): Promise<void> {
        this.sessionUnlockedKey = key;
        if (
            typeof chrome !== 'undefined' &&
            chrome.storage &&
            'session' in chrome.storage &&
            chrome.storage.session
        ) {
            try {
                if (key) {
                    await new Promise<void>((resolve) => {
                        chrome.storage.session.set(
                            { [SESSION_CACHE_KEY]: key },
                            () => resolve(),
                        );
                    });
                } else {
                    await new Promise<void>((resolve) => {
                        chrome.storage.session.remove([SESSION_CACHE_KEY], () =>
                            resolve(),
                        );
                    });
                }
            } catch {
                // Ignore fallback error
            }
        }
    }

    /**
     * Seamlessly migrates legacy unencrypted settings.openrouterApiKey into the vault,
     * removing it from general settings to eliminate content script leakage.
     */
    private async migrateLegacySettings(): Promise<void> {
        try {
            const settingsRes = await this.storage.get<Record<string, unknown>>([
                NCW_STORAGE_KEYS.SETTINGS,
            ]);
            const settings = settingsRes?.[NCW_STORAGE_KEYS.SETTINGS] as
                | Record<string, unknown>
                | undefined;

            if (settings && typeof settings.openrouterApiKey === 'string') {
                const legacyKey = settings.openrouterApiKey.trim();

                // If vault has no credentials yet but legacy settings had a key, migrate it
                if (legacyKey && (!this.currentRecord || !this.currentRecord.hasKey)) {
                    this.logger.info(
                        'CredentialVault',
                        'Migrating legacy API key from settings into secure vault',
                    );
                    const newRecord: StoredCredentials = {
                        version: 1,
                        isEncrypted: false,
                        hasKey: true,
                        unencryptedKey: legacyKey,
                        maskedKey: CryptoVault.maskApiKey(legacyKey),
                        updatedAt: Date.now(),
                    };
                    await this.storage.set({
                        [NCW_STORAGE_KEYS.SECURE_CREDENTIALS]: newRecord,
                    });
                    this.currentRecord = newRecord;
                }

                // Strip openrouterApiKey from general settings to prevent broadcast to content scripts
                delete settings.openrouterApiKey;
                await this.storage.set({
                    [NCW_STORAGE_KEYS.SETTINGS]: settings,
                });
            }
        } catch (err) {
            this.logger.error(
                'CredentialVault',
                'Error during legacy settings credential migration',
                err,
            );
        }
    }

    getStatus(): CredentialVaultStatus {
        const hasKey = Boolean(this.currentRecord?.hasKey);
        const isEncrypted = Boolean(this.currentRecord?.isEncrypted);
        const isUnlocked =
            !isEncrypted || Boolean(this.sessionUnlockedKey && this.sessionUnlockedKey.length > 0);
        const maskedKey = this.currentRecord?.maskedKey || '';

        return {
            hasKey,
            isEncrypted,
            isUnlocked,
            maskedKey,
        };
    }

    async getApiKey(promptIfLocked: boolean = true): Promise<string> {
        if (!this.initialized) {
            await this.init();
        }

        if (!this.currentRecord || !this.currentRecord.hasKey) {
            return '';
        }

        if (this.currentRecord.isEncrypted) {
            if (this.sessionUnlockedKey) {
                return this.sessionUnlockedKey;
            }
            // Check session storage in case SW woke up
            await this.restoreSessionKey();
            if (this.sessionUnlockedKey) {
                return this.sessionUnlockedKey;
            }

            // On-demand JIT prompt: open dialog and await user entering master password!
            if (promptIfLocked) {
                const unlocked = await this.promptUnlock();
                if (unlocked && this.sessionUnlockedKey) {
                    return this.sessionUnlockedKey;
                }
            }

            throw new Error('CREDENTIAL_VAULT_LOCKED');
        }

        return this.currentRecord.unencryptedKey || '';
    }

    async promptUnlock(): Promise<boolean> {
        // Reuse pending prompt if already open (deduplicate simultaneous requests)
        if (this.activeUnlockPromise) {
            return this.activeUnlockPromise;
        }

        this.activeUnlockPromise = new Promise<boolean>((resolve) => {
            this.activeUnlockResolve = resolve;
        });

        try {
            const winId = await this.platform.openPopupWindow({
                url: 'unlock/unlock.html',
                width: 380,
                height: 320,
                title: 'CoWatcher - Unlock Credentials',
            });
            this.activeUnlockWindowId = winId || null;

            // Timeout after 120s to prevent permanent hang
            if (this.unlockTimeoutTimer) clearTimeout(this.unlockTimeoutTimer);
            this.unlockTimeoutTimer = setTimeout(() => {
                this.resolveUnlock(false);
            }, 120000);
        } catch (err) {
            this.logger.error(
                'CredentialVault',
                'Failed to open unlock dialog window',
                err,
            );
            this.resolveUnlock(false);
        }

        return this.activeUnlockPromise;
    }

    resolveUnlock(success: boolean): void {
        if (this.unlockTimeoutTimer) {
            clearTimeout(this.unlockTimeoutTimer);
            this.unlockTimeoutTimer = null;
        }

        const winId = this.activeUnlockWindowId;
        this.activeUnlockWindowId = null;

        if (this.activeUnlockResolve) {
            const resolve = this.activeUnlockResolve;
            this.activeUnlockResolve = null;
            this.activeUnlockPromise = null;
            resolve(success);
        }

        if (winId) {
            this.platform.closeWindow(winId).catch(() => {});
        }
    }

    cancelUnlock(): void {
        this.resolveUnlock(false);
    }

    async saveCredentials(params: {
        apiKey?: string;
        masterPassword?: string;
        enableEncryption?: boolean;
    }): Promise<CredentialVaultStatus> {
        if (!this.initialized) {
            await this.init();
        }

        const { apiKey, masterPassword, enableEncryption } = params;

        // Case 1: Empty or clearing API Key
        if (apiKey !== undefined && apiKey.trim() === '') {
            await this.clear();
            return this.getStatus();
        }

        // Determine key to store
        let targetKey = apiKey?.trim();
        if (!targetKey) {
            // Reusing existing key (e.g. toggling encryption mode)
            if (this.currentRecord?.isEncrypted) {
                targetKey = this.sessionUnlockedKey || undefined;
            } else {
                targetKey = this.currentRecord?.unencryptedKey;
            }
        }

        if (!targetKey) {
            throw new Error('No API key provided or currently unlocked.');
        }

        // Determine encryption mode
        const shouldEncrypt =
            enableEncryption !== undefined
                ? enableEncryption
                : Boolean(this.currentRecord?.isEncrypted);

        if (shouldEncrypt) {
            if (!masterPassword || masterPassword.length < 4) {
                throw new Error('Master password must be at least 4 characters.');
            }

            const encrypted = await CryptoVault.encrypt(targetKey, masterPassword);
            const record: StoredCredentials = {
                version: 1,
                isEncrypted: true,
                hasKey: true,
                maskedKey: CryptoVault.maskApiKey(targetKey),
                ciphertext: encrypted.ciphertext,
                salt: encrypted.salt,
                iv: encrypted.iv,
                updatedAt: Date.now(),
            };

            await this.storage.set({
                [NCW_STORAGE_KEYS.SECURE_CREDENTIALS]: record,
            });
            this.currentRecord = record;
            await this.persistSessionKey(targetKey);
        } else {
            // Unencrypted mode (default out-of-the-box experience)
            const record: StoredCredentials = {
                version: 1,
                isEncrypted: false,
                hasKey: true,
                maskedKey: CryptoVault.maskApiKey(targetKey),
                unencryptedKey: targetKey,
                updatedAt: Date.now(),
            };

            await this.storage.set({
                [NCW_STORAGE_KEYS.SECURE_CREDENTIALS]: record,
            });
            this.currentRecord = record;
            await this.persistSessionKey(null);
        }

        return this.getStatus();
    }

    async unlock(password: string): Promise<boolean> {
        if (!this.initialized) {
            await this.init();
        }

        if (!this.currentRecord || !this.currentRecord.isEncrypted) {
            return true;
        }

        const { ciphertext, salt, iv } = this.currentRecord;
        if (!ciphertext || !salt || !iv) {
            return false;
        }

        try {
            const decryptedKey = await CryptoVault.decrypt(
                ciphertext,
                salt,
                iv,
                password,
            );
            await this.persistSessionKey(decryptedKey);
            this.resolveUnlock(true);
            return true;
        } catch {
            return false;
        }
    }

    async lock(): Promise<void> {
        await this.persistSessionKey(null);
    }

    async disableEncryption(password: string): Promise<boolean> {
        if (!this.initialized) {
            await this.init();
        }

        if (!this.currentRecord || !this.currentRecord.isEncrypted) {
            return true;
        }

        const unlocked = await this.unlock(password);
        if (!unlocked || !this.sessionUnlockedKey) {
            return false;
        }

        const key = this.sessionUnlockedKey;
        const record: StoredCredentials = {
            version: 1,
            isEncrypted: false,
            hasKey: true,
            maskedKey: CryptoVault.maskApiKey(key),
            unencryptedKey: key,
            updatedAt: Date.now(),
        };

        await this.storage.set({
            [NCW_STORAGE_KEYS.SECURE_CREDENTIALS]: record,
        });
        this.currentRecord = record;
        await this.persistSessionKey(null);
        return true;
    }

    async clear(): Promise<void> {
        await this.storage.remove(NCW_STORAGE_KEYS.SECURE_CREDENTIALS);
        this.currentRecord = null;
        await this.persistSessionKey(null);
    }
}
