/**
 * CredentialVault Domain Types
 */

export interface StoredCredentials {
    version: number;
    isEncrypted: boolean;
    hasKey: boolean;
    maskedKey?: string;
    // Unencrypted storage (default mode when master password is OFF)
    unencryptedKey?: string;
    // Encrypted storage (when master password is ON)
    ciphertext?: string;
    salt?: string;
    iv?: string;
    updatedAt: number;
}

export interface CredentialVaultStatus {
    hasKey: boolean;
    isEncrypted: boolean;
    isUnlocked: boolean;
    maskedKey: string;
}
