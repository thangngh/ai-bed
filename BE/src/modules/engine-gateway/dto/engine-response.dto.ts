export interface EngineResponse {
  requestId: string;
  title: string;
  content: any[];
  // PENDING is the Engine's own default (GenerateResponse.safety_status and
  // PipelineResult.safety_verdict both start there) and is also what the
  // gateway substitutes when the field is absent, so it belongs in the union.
  safetyStatus: 'APPROVED' | 'REJECTED' | 'FLAGGED' | 'FALLBACK' | 'PENDING';
  memories?: any[];
  llmCalls: number;
  retryCount: number;
  latencyMs: number;
  wordCount: number;
  isFallback: boolean;
  error?: string;
}
