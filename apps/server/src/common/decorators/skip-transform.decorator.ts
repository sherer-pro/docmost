import { SetMetadata } from '@nestjs/common';

export const SKIP_TRANSFORM_KEY = 'SKIP_TRANSFORM';

/**
 * Отключает оборачивание ответа в единый envelope `{ data, success, status }`.
 *
 * Применять только для endpoint-ов, где контракт должен остаться "сырым":
 * - plain text или нестандартный payload (например, `robots.txt`),
 * - health-check endpoint-ы, где внешний мониторинг ожидает формат Terminus.
 *
 * Текущие осознанные исключения контракта:
 * - `GET /api/health`
 * - `GET /api/robots.txt`
 */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);
