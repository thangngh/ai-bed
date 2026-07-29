export interface EngineResponse {
  requestId: string;
  title: string;
  content: any[];
  safetyStatus: 'APPROVED' | 'REJECTED' | 'FLAGGED' | 'FALLBACK';
  memories?: any[];
  llmCalls: number;
  retryCount: number;
  latencyMs: number;
  wordCount: number;
  isFallback: boolean;
  error?: string;
}
