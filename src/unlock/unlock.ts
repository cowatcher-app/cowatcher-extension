/**
 * Unlock Credentials Dialog Controller
 * Runs in standalone window mode.
 * Prompted on-demand when an LLM translation request requires the master password.
 */

import { ContentBackgroundBus } from '@shared/infrastructure/bus/ContentBackgroundBus';
import NCW_CONSTANTS from '@shared/utils/constants';

document.addEventListener('DOMContentLoaded', () => {
    const passwordInput = document.getElementById(
        'password-input',
    ) as HTMLInputElement | null;
    const btnTogglePwd = document.getElementById(
        'btn-toggle-pwd',
    ) as HTMLButtonElement | null;
    const btnUnlock = document.getElementById(
        'btn-unlock',
    ) as HTMLButtonElement | null;
    const btnCancel = document.getElementById(
        'btn-cancel',
    ) as HTMLButtonElement | null;
    const errorEl = document.getElementById(
        'unlock-error',
    ) as HTMLDivElement | null;

    let isUnlocked = false;

    // Toggle password visibility
    btnTogglePwd?.addEventListener('click', () => {
        if (!passwordInput) return;
        const isPwd = passwordInput.type === 'password';
        passwordInput.type = isPwd ? 'text' : 'password';
        btnTogglePwd.textContent = isPwd ? '🙈' : '👁️';
    });

    async function handleUnlock(): Promise<void> {
        if (!passwordInput || !btnUnlock) return;
        const password = passwordInput.value;
        if (!password) {
            showError('Please enter your master password.');
            return;
        }

        btnUnlock.disabled = true;
        const originalText = btnUnlock.textContent;
        btnUnlock.textContent = 'Unlocking...';
        clearError();

        try {
            const res = await ContentBackgroundBus.send(
                NCW_CONSTANTS.MESSAGE_TYPES.UNLOCK_CREDENTIALS,
                { password },
            );

            if (res.success) {
                isUnlocked = true;
                window.close();
            } else {
                showError('Incorrect master password.');
                triggerShake();
                passwordInput.select();
            }
        } catch {
            showError('Failed to communicate with background service.');
            triggerShake();
        } finally {
            btnUnlock.disabled = false;
            btnUnlock.textContent = originalText;
        }
    }

    async function handleCancel(): Promise<void> {
        if (!isUnlocked) {
            try {
                await ContentBackgroundBus.send(
                    NCW_CONSTANTS.MESSAGE_TYPES.CANCEL_UNLOCK,
                    undefined,
                );
            } catch {
                // Ignore cancel dispatch error
            }
        }
        window.close();
    }

    function showError(msg: string): void {
        if (errorEl) {
            errorEl.textContent = msg;
            errorEl.style.display = 'block';
        }
    }

    function clearError(): void {
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.style.display = 'none';
        }
    }

    function triggerShake(): void {
        if (passwordInput) {
            passwordInput.classList.remove('shake');
            // Trigger reflow to restart CSS animation
            void passwordInput.offsetWidth;
            passwordInput.classList.add('shake');
        }
    }

    btnUnlock?.addEventListener('click', handleUnlock);
    btnCancel?.addEventListener('click', handleCancel);

    passwordInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleUnlock();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
        }
    });

    window.addEventListener('beforeunload', () => {
        if (!isUnlocked) {
            ContentBackgroundBus.send(
                NCW_CONSTANTS.MESSAGE_TYPES.CANCEL_UNLOCK,
                undefined,
            ).catch(() => {});
        }
    });

    // Autofocus password input
    setTimeout(() => {
        passwordInput?.focus();
    }, 50);
});
