/**
 * Main World Injected Script Entry Point
 * Registers platform-specific injected adapters and boots the matching adapter.
 */
import { Logger } from '@shared/utils/logger';
import { InjectedAdapterRegistry } from './domain/InjectedAdapterRegistry';
import { NetflixInjectedAdapter } from './infrastructure/adapters/netflix/NetflixInjectedAdapter';
import { TVerInjectedAdapter } from './infrastructure/adapters/tver/TVerInjectedAdapter';
import { YouTubeInjectedAdapter } from './infrastructure/adapters/youtube/YouTubeInjectedAdapter';
import { BilibiliInjectedAdapter } from './infrastructure/adapters/bilibili/BilibiliInjectedAdapter';
import { ItvxInjectedAdapter } from './infrastructure/adapters/itvx/ItvxInjectedAdapter';

declare global {
    interface Window {
        __NCW_INJECTED_INITIALIZED__?: boolean;
    }
}

const logger = new Logger('injected');

(function () {
    'use strict';

    if (window.__NCW_INJECTED_INITIALIZED__) return;
    window.__NCW_INJECTED_INITIALIZED__ = true;
    try {
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.setAttribute('data-ncw-injected', 'true');
        }
    } catch {}

    logger.info(
        'Injected',
        'Injected script entry initialized in page context.',
    );

    // 1. Register available platform adapters
    InjectedAdapterRegistry.register(new NetflixInjectedAdapter());
    InjectedAdapterRegistry.register(new TVerInjectedAdapter());
    InjectedAdapterRegistry.register(new YouTubeInjectedAdapter());
    InjectedAdapterRegistry.register(new BilibiliInjectedAdapter());
    InjectedAdapterRegistry.register(new ItvxInjectedAdapter());
    // Future platforms:
    // InjectedAdapterRegistry.register(new DisneyInjectedAdapter());

    // 2. Resolve matching adapter for current URL
    const activeAdapter = InjectedAdapterRegistry.getMatchingAdapter();
    if (activeAdapter) {
        logger.info(
            'Injected',
            `Injected adapter activated: ${activeAdapter.platformId}`,
        );
        activeAdapter.initialize();
    } else {
        logger.info(
            'Injected',
            'No matching injected adapter found for current URL:',
            window.location.href,
        );
    }
})();

export {};
