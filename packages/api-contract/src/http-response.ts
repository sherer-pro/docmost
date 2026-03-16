/**
 * Unified HTTP response contract for endpoints that pass through
 * TransformHttpResponseInterceptor on the backend.
 */
export interface ApiResponseEnvelope<T> {
  /** Endpoint business payload. */
  data: T;
  /** Application-level success indicator. */
  success: true;
  /** Original HTTP status code. */
  status: number;
}

/**
 * In the UI, the axios interceptor usually unwraps `response.data`,
 * so this type represents the resulting value after unwrap.
 */
export type UnwrappedApiResponse<T> = T;
