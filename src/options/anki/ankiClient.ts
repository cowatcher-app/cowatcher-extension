import { AnkiCard } from './ankiTypes';

const ANKI_CONNECT_URL = 'http://127.0.0.1:8765';
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Concrete client for AnkiConnect JSON-RPC API (http://127.0.0.1:8765).
 */
export class AnkiConnectClient {
    private async invoke<T>(
        action: string,
        params: Record<string, unknown> = {},
    ): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const res = await fetch(ANKI_CONNECT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, version: 6, params }),
                signal: controller.signal,
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }

            const data = (await res.json()) as {
                error: string | null;
                result: T;
            };

            if (data.error) {
                throw new Error(data.error);
            }

            return data.result;
        } finally {
            clearTimeout(timer);
        }
    }

    async isAvailable(): Promise<boolean> {
        try {
            const version = await this.invoke<number>('version');
            return typeof version === 'number' && version >= 6;
        } catch {
            return false;
        }
    }

    async getDeckNames(): Promise<string[]> {
        return this.invoke<string[]>('deckNames');
    }

    async createDeck(deckName: string): Promise<number> {
        return this.invoke<number>('createDeck', { deck: deckName });
    }

    async canAddNotes(notes: AnkiCard[]): Promise<boolean[]> {
        return this.invoke<boolean[]>('canAddNotes', {
            notes: notes.map((n) => ({
                deckName: n.deckName,
                modelName: n.modelName,
                fields: n.fields,
                tags: n.tags,
            })),
        });
    }

    async addNotes(notes: AnkiCard[]): Promise<(number | null)[]> {
        return this.invoke<(number | null)[]>('addNotes', {
            notes: notes.map((n) => ({
                deckName: n.deckName,
                modelName: n.modelName,
                fields: n.fields,
                tags: n.tags,
            })),
        });
    }

    async storeMediaFile(
        filename: string,
        dataBase64: string,
    ): Promise<string> {
        return this.invoke<string>('storeMediaFile', {
            filename,
            data: dataBase64,
        });
    }

    async getModelNames(): Promise<string[]> {
        return this.invoke<string[]>('modelNames');
    }

    async getModelFieldNames(modelName: string): Promise<string[]> {
        return this.invoke<string[]>('modelFieldNames', { modelName });
    }

    async getModelTemplates(
        modelName: string,
    ): Promise<Record<string, { Front: string; Back: string }>> {
        return this.invoke<Record<string, { Front: string; Back: string }>>(
            'modelTemplates',
            { modelName },
        );
    }

    async getModelStyling(modelName: string): Promise<{ css: string }> {
        return this.invoke<{ css: string }>('modelStyling', { modelName });
    }

    async updateModelTemplates(model: {
        name: string;
        templates: Record<string, { Front: string; Back: string }>;
    }): Promise<void> {
        return this.invoke<void>('updateModelTemplates', { model });
    }

    async updateModelStyling(model: {
        name: string;
        css: string;
    }): Promise<void> {
        return this.invoke<void>('updateModelStyling', { model });
    }

    async createModel(params: {
        modelName: string;
        inOrderFields: string[];
        css?: string;
        cardTemplates: Array<{ Name: string; Front: string; Back: string }>;
    }): Promise<Record<string, unknown>> {
        return this.invoke<Record<string, unknown>>('createModel', params);
    }
}
