/**
 * CryptoVault
 * Standard Web Crypto API utility for PBKDF2 key derivation and AES-GCM-256 encryption.
 * Zero external dependencies.
 */

export interface EncryptedData {
    ciphertext: string;
    salt: string;
    iv: string;
}

export class CryptoVault {
    private static readonly PBKDF2_ITERATIONS = 100000;
    private static readonly SALT_BYTE_LENGTH = 16;
    private static readonly IV_BYTE_LENGTH = 12;

    /**
     * Converts a Uint8Array into a Base64 string.
     */
    static toBase64(bytes: Uint8Array): string {
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Converts a Base64 string into a Uint8Array.
     */
    static fromBase64(base64: string): Uint8Array {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    /**
     * Derives an AES-GCM 256-bit CryptoKey from a user password and salt using PBKDF2.
     */
    private static async deriveKey(
        password: string,
        salt: Uint8Array,
    ): Promise<CryptoKey> {
        const subtle = CryptoVault.getSubtleCrypto();
        const encoder = new TextEncoder();
        const passwordKey = await subtle.importKey(
            'raw',
            encoder.encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveKey'],
        );

        return await subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt as unknown as BufferSource,
                iterations: CryptoVault.PBKDF2_ITERATIONS,
                hash: 'SHA-256',
            },
            passwordKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt'],
        );
    }

    /**
     * Encrypts plaintext using AES-GCM 256-bit with PBKDF2 derived key.
     */
    static async encrypt(
        plaintext: string,
        password: string,
    ): Promise<EncryptedData> {
        if (!plaintext) {
            return { ciphertext: '', salt: '', iv: '' };
        }
        const subtle = CryptoVault.getSubtleCrypto();
        const salt = CryptoVault.getRandomValues(
            new Uint8Array(CryptoVault.SALT_BYTE_LENGTH),
        );
        const iv = CryptoVault.getRandomValues(
            new Uint8Array(CryptoVault.IV_BYTE_LENGTH),
        );

        const key = await CryptoVault.deriveKey(password, salt);
        const encoder = new TextEncoder();
        const ciphertextBuffer = await subtle.encrypt(
            { name: 'AES-GCM', iv: iv as unknown as BufferSource },
            key,
            encoder.encode(plaintext),
        );

        return {
            ciphertext: CryptoVault.toBase64(new Uint8Array(ciphertextBuffer)),
            salt: CryptoVault.toBase64(salt),
            iv: CryptoVault.toBase64(iv),
        };
    }

    /**
     * Decrypts ciphertext using AES-GCM 256-bit with PBKDF2 derived key.
     * Throws an error if password is wrong or ciphertext has been corrupted.
     */
    static async decrypt(
        ciphertext: string,
        salt: string,
        iv: string,
        password: string,
    ): Promise<string> {
        if (!ciphertext) return '';

        try {
            const subtle = CryptoVault.getSubtleCrypto();
            const saltBytes = CryptoVault.fromBase64(salt);
            const ivBytes = CryptoVault.fromBase64(iv);
            const ciphertextBytes = CryptoVault.fromBase64(ciphertext);

            const key = await CryptoVault.deriveKey(password, saltBytes);
            const decryptedBuffer = await subtle.decrypt(
                { name: 'AES-GCM', iv: ivBytes as unknown as BufferSource },
                key,
                ciphertextBytes as unknown as BufferSource,
            );

            const decoder = new TextDecoder();
            return decoder.decode(decryptedBuffer);
        } catch {
            throw new Error('INVALID_PASSWORD');
        }
    }

    /**
     * Masks an API key for safe display (e.g. sk-or-••••••••abcd).
     */
    static maskApiKey(key: string): string {
        if (!key || typeof key !== 'string') return '';
        const trimmed = key.trim();
        if (trimmed.length <= 8) {
            return '••••••••';
        }
        if (trimmed.startsWith('sk-or-v1-')) {
            const suffix = trimmed.slice(-4);
            return `sk-or-••••••••${suffix}`;
        }
        if (trimmed.startsWith('sk-')) {
            const suffix = trimmed.slice(-4);
            return `sk-••••••••${suffix}`;
        }
        const prefix = trimmed.slice(0, 3);
        const suffix = trimmed.slice(-4);
        return `${prefix}••••••••${suffix}`;
    }

    private static getSubtleCrypto(): SubtleCrypto {
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            return crypto.subtle;
        }
        throw new Error('Web Cryptography API (crypto.subtle) is not available in this environment.');
    }

    private static getRandomValues<T extends ArrayBufferView>(array: T): T {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            return crypto.getRandomValues(
                array as unknown as ArrayBufferView<ArrayBuffer>,
            ) as unknown as T;
        }
        throw new Error('Web Cryptography API (crypto.getRandomValues) is not available.');
    }
}
