/**
 * CoWatcher - Background Service Worker Entry
 * Coordinates domain services and registers message dispatchers without direct chrome platform coupling.
 */

import { AiSubStateService } from './application/services/AiSubStateService';
import { GlossaryService } from './application/services/GlossaryService';
import { BackgroundMessageService } from './presentation/BackgroundMessageService';
import { BrowserPlatformFactory } from '@shared/infrastructure/platform/BrowserPlatformFactory';
import { BrowserStorageFactory } from '@shared/infrastructure/storage/BrowserStorageFactory';
import { ContentBackgroundBus } from '@shared/infrastructure/bus/ContentBackgroundBus';
import { TrackCacheRepositoryFactory } from './infrastructure/cache/TrackCacheRepositoryFactory';
import { Logger } from '@shared/utils/logger';
import NCW_CONSTANTS from '@shared/utils/constants';

const logger: Logger = new Logger('background');

const platform = BrowserPlatformFactory.getPlatform();
const storage = BrowserStorageFactory.getStorage();
const cacheRepository = TrackCacheRepositoryFactory.getRepository();

const CACHE_CLEANUP_ALARM = 'NCW_CACHE_CLEANUP_ALARM';

// Setup 24-hour periodic cache cleanup alarm (1440 minutes)
const setupCacheCleanupAlarm = () => {
    platform.createAlarm(CACHE_CLEANUP_ALARM, {
        periodInMinutes: 1440,
        delayInMinutes: 15,
    });
};

// 1. Initialize Authoritative Domain Services
AiSubStateService.getInstance(storage)
    .initialize()
    .catch((err) => {
        logger.warn('Subtitle', 'Failed to initialize AiSubStateService:', err);
    });

GlossaryService.getInstance(storage)
    .initialize()
    .catch((err) => {
        logger.warn('Glossary', 'Failed to initialize GlossaryService:', err);
    });

// 2. Register Central Message Dispatcher
const backgroundService = BackgroundMessageService.getInstance(storage);
backgroundService.registerHandlers();
backgroundService.init().catch((err) => {
    logger.warn('Background', 'Failed during backgroundService init:', err);
});

// 3. Configure declarativeNetRequest Rules, Storage Security & Alarms via Platform Adapter
platform.setupStorageSecurity('TRUSTED_CONTEXTS').catch(() => {});

platform.onInstalled(() => {
    platform.setupStorageSecurity('TRUSTED_CONTEXTS').catch(() => {});
    platform.setupOllamaRules();
    setupCacheCleanupAlarm();
});
platform.onStartup(() => {
    platform.setupStorageSecurity('TRUSTED_CONTEXTS').catch(() => {});
    platform.setupOllamaRules();
    setupCacheCleanupAlarm();
});
platform.setupOllamaRules();
setupCacheCleanupAlarm();

// 4. Register top-level Alarm Listener (Wakes up service worker even if dormant)
platform.onAlarm(async (alarmName) => {
    if (alarmName === CACHE_CLEANUP_ALARM) {
        try {
            const res = await storage.get<Record<string, unknown>>([
                NCW_CONSTANTS.STORAGE_KEYS.SETTINGS,
            ]);
            const settings = res?.[NCW_CONSTANTS.STORAGE_KEYS.SETTINGS] as {
                cacheRetention?: '1w' | '1m' | '1y';
            } | undefined;
            const retention = settings?.cacheRetention || '1m';
            const cleaned = await cacheRepository.cleanExpiredRecords(retention);
            logger.info(
                'Background',
                `Periodic 24h cache cleanup executed (retention: ${retention}). Removed ${cleaned} expired records.`,
            );
        } catch (err) {
            logger.warn(
                'Background',
                'Failed during periodic cache cleanup:',
                err,
            );
        }
    }
});

ContentBackgroundBus.onMessage(
    NCW_CONSTANTS.MESSAGE_TYPES.PUSH_SETTINGS_CHANGED,
    (payload) => {
        if (payload && payload.settings && payload.settings.ollamaHost) {
            platform.setupOllamaRules(payload.settings.ollamaHost);
        }
    },
);
