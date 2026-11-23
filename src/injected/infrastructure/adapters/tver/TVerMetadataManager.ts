import { VideoMetadata } from '../../../../content/domain/adapters/IStreamingAdapter';
import { InjectedMetadataLoadedPayload } from '../../../domain/IInjectedAdapter';
import { NCW_MESSAGE_TYPES } from '@shared/domain/constants/MessageTypes';
import { Logger } from '@shared/utils/logger';
import {
    TVerSeriesEpisodesResponse,
    TVerEpisodeContent,
    TVerV2EpisodeResponse,
} from './TVerTypes';

export class TVerMetadataManager {
    private readonly logger = new Logger('TVerMetadataManager');

    private capturedToken: string | null = null;
    private capturedUid: string | null = null;

    private readonly episodeToSeriesMap = new Map<string, string>();
    private readonly episodeMetadataCache = new Map<string, VideoMetadata>();
    private readonly seriesPayloadCache = new Map<string, TVerSeriesEpisodesResponse>();
    private readonly inFlightSeriesFetches = new Set<string>();
    private readonly inFlightEpisodeFetches = new Set<string>();

    setCapturedToken(token: string, uid?: string): void {
        this.capturedToken = token;
        if (uid) this.capturedUid = uid;
        if (typeof window !== 'undefined') {
            window.__NCW_TVER_CAPTURED_TOKEN__ = {
                token,
                uid: uid || undefined,
                capturedAt: Date.now(),
            };
        }
        this.logger.info(
            'TVer-AI-Sub',
            `Captured TVer token (${token.slice(0, 8)}...)`,
        );
    }

    getCapturedToken(): string | null {
        return this.capturedToken || window.__NCW_TVER_CAPTURED_TOKEN__?.token || null;
    }

    getCapturedUid(): string | null {
        return this.capturedUid || window.__NCW_TVER_CAPTURED_TOKEN__?.uid || null;
    }

    getSeriesId(episodeId: string): string | null {
        return this.episodeToSeriesMap.get(episodeId) || null;
    }

    isEpisodeCached(episodeId: string): boolean {
        return this.episodeMetadataCache.has(episodeId);
    }

    getCachedMetadata(episodeId: string): VideoMetadata | null {
        return this.episodeMetadataCache.get(episodeId) || null;
    }

    handleV2EpisodeResponse(
        data: TVerV2EpisodeResponse | null | undefined,
        currentEpisodeId?: string | null,
    ): InjectedMetadataLoadedPayload | null {
        try {
            const ep = data?.episode;
            if (!ep?.id) return null;

            const epId = String(ep.id);
            const seriesId = String(data?.series?.id || '');
            const mainTitle =
                data?.series?.title ||
                ep.share?.text ||
                (typeof document !== 'undefined' ? document.title : '');
            const episodeTitle = ep.title || '';
            const fullTitle = episodeTitle
                ? mainTitle
                    ? `${mainTitle} - ${episodeTitle}`
                    : episodeTitle
                : mainTitle;
            const episodeSynopsis =
                ep.description || ep.broadcast_date_label || ep.date_label || '';
            const showSummary = data?.series?.description || '';

            if (seriesId) {
                this.episodeToSeriesMap.set(epId, seriesId);
            }

            const meta: VideoMetadata = {
                mainTitle,
                episodeTitle,
                fullTitle,
                videoId: epId,
                showId: seriesId || epId,
                showSummary,
                episodeSummary: episodeSynopsis,
            };
            this.episodeMetadataCache.set(epId, meta);
            if (currentEpisodeId && currentEpisodeId !== epId) {
                this.episodeMetadataCache.set(currentEpisodeId, meta);
            }

            return {
                type: NCW_MESSAGE_TYPES.METADATA_LOADED,
                movieId: epId,
                showId: seriesId || epId,
                showTitle: mainTitle,
                showSynopsis: showSummary || undefined,
                seasonId: data?.season?.id,
                seasonTitle: data?.season?.title,
                currentEpisode: {
                    episodeId: epId,
                    episodeTitle,
                    episodeSynopsis,
                },
                rawMetadata: data,
            };
        } catch (err) {
            this.logger.warn(
                'TVer-AI-Sub',
                'Error parsing v2 episode response:',
                err,
            );
            return null;
        }
    }

    async fetchV2EpisodeMetadata(
        episodeId: string,
    ): Promise<InjectedMetadataLoadedPayload | null> {
        if (!episodeId || this.inFlightEpisodeFetches.has(episodeId)) {
            return null;
        }
        this.inFlightEpisodeFetches.add(episodeId);

        try {
            const resp = await fetch(
                `https://contents-api.tver.jp/contents/api/v2/episodes/${encodeURIComponent(episodeId)}`,
                {
                    headers: {
                        'x-tver-platform-type': 'web',
                        accept: '*/*',
                    },
                },
            );
            if (!resp.ok) return null;
            const data = (await resp.json()) as TVerV2EpisodeResponse;
            return this.handleV2EpisodeResponse(data, episodeId);
        } catch (err) {
            this.logger.warn(
                'TVer-AI-Sub',
                `Failed fetching v2 episode ${episodeId}:`,
                err,
            );
            return null;
        } finally {
            this.inFlightEpisodeFetches.delete(episodeId);
        }
    }

    handleSeriesEpisodesResponse(
        data: TVerSeriesEpisodesResponse | null | undefined,
        currentEpisodeId?: string | null,
    ): InjectedMetadataLoadedPayload | null {
        try {
            const rawGroups = data?.result?.contents || [];
            let foundSeriesTitle = '';
            let foundSeriesId = '';
            let currentEpisodeInfo: TVerEpisodeContent | null = null;

            for (const group of rawGroups) {
                const items = group?.contents || [];
                for (const item of items) {
                    if (item?.type === 'episode' && item.content) {
                        const c = item.content;
                        const epId = String(c.id);

                        if (!foundSeriesTitle && c.seriesTitle) {
                            foundSeriesTitle = c.seriesTitle;
                        }
                        if (!foundSeriesId && c.seriesID) {
                            foundSeriesId = String(c.seriesID);
                        }

                        const seriesId = foundSeriesId || String(c.seriesID || '');
                        if (seriesId) {
                            this.episodeToSeriesMap.set(epId, seriesId);
                        }

                        const mainTitle = foundSeriesTitle || c.seriesTitle || '';
                        const episodeTitle = c.title || '';
                        const fullTitle = episodeTitle
                            ? mainTitle
                                ? `${mainTitle} - ${episodeTitle}`
                                : episodeTitle
                            : mainTitle;

                        const meta: VideoMetadata = {
                            mainTitle,
                            episodeTitle,
                            fullTitle,
                            videoId: epId,
                            showId: seriesId,
                            episodeSummary: c.broadcastDateLabel || '',
                        };
                        this.episodeMetadataCache.set(epId, meta);

                        if (currentEpisodeId && epId === currentEpisodeId) {
                            currentEpisodeInfo = c;
                        } else if (!currentEpisodeInfo) {
                            currentEpisodeInfo = c;
                        }
                    }
                }
            }

            const effectiveSeriesId =
                foundSeriesId ||
                currentEpisodeInfo?.seriesID ||
                currentEpisodeId ||
                '';
            const effectiveSeriesTitle =
                foundSeriesTitle ||
                currentEpisodeInfo?.seriesTitle ||
                (typeof document !== 'undefined' ? document.title : '');

            if (effectiveSeriesId && data) {
                this.seriesPayloadCache.set(effectiveSeriesId, data);
            }

            const activeEpId = currentEpisodeInfo?.id || currentEpisodeId || '';

            const metaPayload: InjectedMetadataLoadedPayload = {
                type: NCW_MESSAGE_TYPES.METADATA_LOADED,
                movieId: activeEpId,
                showId: effectiveSeriesId,
                showTitle: effectiveSeriesTitle,
                currentEpisode: currentEpisodeInfo
                    ? {
                          episodeId: String(currentEpisodeInfo.id),
                          episodeTitle: currentEpisodeInfo.title || '',
                          episodeSynopsis: currentEpisodeInfo.broadcastDateLabel || '',
                      }
                    : undefined,
                rawMetadata: data,
            };

            return metaPayload;
        } catch (err) {
            this.logger.warn('TVer-AI-Sub', 'Error parsing series episodes response:', err);
            return null;
        }
    }

    async fetchSeriesEpisodes(
        seriesId: string,
        currentEpisodeId?: string | null,
    ): Promise<InjectedMetadataLoadedPayload | null> {
        const token = this.getCapturedToken();
        if (!seriesId || !token) return null;

        if (this.inFlightSeriesFetches.has(seriesId)) {
            return null;
        }
        this.inFlightSeriesFetches.add(seriesId);

        try {
            const url = new URL(
                `https://platform-api.tver.jp/service/api/v1/callSeriesEpisodes/${seriesId}`,
            );
            const uid = this.getCapturedUid();
            if (uid) url.searchParams.append('platform_uid', uid);
            url.searchParams.append('platform_token', token);
            url.searchParams.append('require_data', 'later,good,resume');

            const resp = await fetch(url.toString(), {
                headers: {
                    'x-tver-platform-type': 'web',
                    accept: 'application/json, text/plain, */*',
                },
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            return this.handleSeriesEpisodesResponse(data, currentEpisodeId);
        } catch (err) {
            this.logger.warn('TVer-AI-Sub', `Failed fetching series ${seriesId}:`, err);
            return null;
        } finally {
            this.inFlightSeriesFetches.delete(seriesId);
        }
    }

    getMetadata(
        episodeId: string,
        playerSeriesId?: string | null,
    ): {
        status: 'resolved' | 'null' | 'undefined';
        metadata?: VideoMetadata;
        payload?: InjectedMetadataLoadedPayload;
    } {
        if (!episodeId) return { status: 'undefined' };

        // 1. Direct hit in episode cache
        const cachedMeta = this.episodeMetadataCache.get(episodeId);
        if (cachedMeta) {
            return { status: 'resolved', metadata: cachedMeta };
        }

        // 2. Check if series data is already in cache to parse this episode
        const seriesId = this.episodeToSeriesMap.get(episodeId) || playerSeriesId;
        if (seriesId && this.seriesPayloadCache.has(seriesId)) {
            const payload = this.handleSeriesEpisodesResponse(
                this.seriesPayloadCache.get(seriesId),
                episodeId,
            );
            const meta = this.episodeMetadataCache.get(episodeId);
            if (meta) {
                return { status: 'resolved', metadata: meta, payload: payload || undefined };
            }
        }

        // 3. Proactively fetch if seriesId and token are known
        if (seriesId && this.getCapturedToken()) {
            this.fetchSeriesEpisodes(seriesId, episodeId).then((payload) => {
                if (payload && typeof window !== 'undefined') {
                    window.postMessage(payload, '*');
                }
            });
            return { status: 'undefined' };
        }

        return { status: 'undefined' };
    }

    clear(): void {
        this.episodeToSeriesMap.clear();
        this.episodeMetadataCache.clear();
        this.seriesPayloadCache.clear();
        this.inFlightSeriesFetches.clear();
    }
}
