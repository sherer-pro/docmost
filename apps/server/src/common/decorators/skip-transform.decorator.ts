import { SetMetadata } from '@nestjs/common';

export const SKIP_TRANSFORM_KEY = 'SKIP_TRANSFORM';

/**
 * Disables wrapping responses into the standard envelope `{ data, success, status }`.
 *
 * Use only for endpoints where the contract must stay "raw":
 * - plain text or non-standard payloads (for example, `robots.txt`),
 * - health-check endpoints where external monitors expect the Terminus format.
 *
 * Current intentional contract exceptions:
 * - `GET /api/health`
 * - `GET /api/robots.txt`
 */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);
