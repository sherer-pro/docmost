import { type Kysely, sql } from 'kysely';

/**
 * Миграция совместимости:
 * исторический тип `text` заменяем на поддерживаемый `multiline_text`.
 * Это синхронизирует старые данные с новым контрактом API/UI.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE database_properties
    SET type = 'multiline_text'
    WHERE type = 'text'
  `.execute(db);
}

/**
 * Откат возвращает прежнее значение для совместимости rollback-сценариев.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE database_properties
    SET type = 'text'
    WHERE type = 'multiline_text'
  `.execute(db);
}
