import { SetMetadata } from '@nestjs/common';

/**
 * Явно помечает endpoint как исключение из CSRF-проверки.
 *
 * Используется только для маршрутов, где CSRF-токен архитектурно недоступен
 * (например, логин/восстановление пароля до появления сессии).
 */
export const IS_CSRF_EXEMPT_KEY = 'isCsrfExempt';
export const CsrfExempt = () => SetMetadata(IS_CSRF_EXEMPT_KEY, true);
