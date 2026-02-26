/**
 * Единый контракт HTTP-ответа для endpoint-ов, проходящих через
 * TransformHttpResponseInterceptor на backend.
 */
export interface ApiResponseEnvelope<T> {
  /** Полезная нагрузка бизнес-ответа endpoint-а. */
  data: T;
  /** Индикатор успешной обработки запроса на уровне приложения. */
  success: true;
  /** HTTP-статус исходного ответа. */
  status: number;
}

/**
 * В UI-коде клиентский axios interceptor обычно делает unwrap response.data,
 * поэтому этот тип отражает итоговый тип после unwrap.
 */
export type UnwrappedApiResponse<T> = T;
