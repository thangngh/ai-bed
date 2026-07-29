export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
    retry_after?: number;
  };
  request_id?: string;
}

export interface SuccessResponse<T> {
  request_id?: string;
  data: T;
  meta?: {
    latency_ms?: number;
    llm_calls?: number;
    is_fallback?: boolean;
  };
}
