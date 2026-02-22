import { SetMetadata } from '@nestjs/common';

/**
 * Explicitly marks an endpoint as exempt from CSRF validation.
 *
 * Use this only for routes where a CSRF token is not available by design
 * (for example login/password-reset flows before a session exists).
 */
export const IS_CSRF_EXEMPT_KEY = 'isCsrfExempt';
export const CsrfExempt = () => SetMetadata(IS_CSRF_EXEMPT_KEY, true);
