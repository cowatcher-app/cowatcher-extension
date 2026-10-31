export type LlmRole = 'translator' | 'supervisor' | 'vocab';

export interface AiCapability {
    hasAi: boolean;
    provider?: string;
    model?: string;
    isSupervisor: boolean;
}
