import { join } from 'path';
import * as fs from 'node:fs';

/**
 * Возвращает абсолютный путь к директории собранного фронтенда (`apps/client/dist`).
 *
 * Почему нужен перебор нескольких кандидатов:
 * - в dev-режиме `__dirname` указывает на `apps/server/src/...`;
 * - в production-сборке Nest (`nest build`) код находится в `apps/server/dist/apps/server/src/...`;
 * - в Docker-контейнере рабочая директория обычно `/app`, где фронтенд лежит в `/app/apps/client/dist`.
 *
 * Функция проверяет наиболее вероятные варианты и возвращает первый существующий путь.
 * Если директория не найдена, возвращается `undefined` — вызывающий код уже решает,
 * как корректно обработать отсутствие клиентских ассетов.
 *
 * @param baseDir Директория, относительно которой строятся пути (обычно `__dirname`).
 */
export function resolveClientDistPath(baseDir: string): string | undefined {
  const candidatePaths = [
    // Nest production build: .../apps/server/dist/apps/server/src/** -> /app/apps/client/dist
    join(baseDir, '..', '..', '..', '..', '..', '..', 'client', 'dist'),
    // Локальный запуск из исходников: .../apps/server/src/** -> .../apps/client/dist
    join(baseDir, '..', '..', '..', '..', 'client', 'dist'),
    // Запуск из корня монорепозитория (или контейнера) с cwd=/app
    join(process.cwd(), 'apps', 'client', 'dist'),
  ];

  return candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
}
