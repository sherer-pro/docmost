import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Возвращает версию приложения из ближайшего package.json.
 *
 * Логика рассчитана на оба сценария запуска:
 * - из исходников (`apps/server/src/...`);
 * - из собранного dist (`apps/server/dist/apps/server/src/...`).
 *
 * Если package.json не найден или не читается, возвращается `unknown`.
 */
export function getAppVersion(): string {
  const candidates = [
    join(process.cwd(), 'package.json'),
    join(__dirname, '..', '..', '..', 'package.json'),
    join(__dirname, '..', '..', '..', '..', '..', '..', 'package.json'),
  ];

  for (const packageJsonPath of candidates) {
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      if (typeof packageJson?.version === 'string') {
        return packageJson.version;
      }
    } catch {
      // Игнорируем некорректные файлы и переходим к следующему кандидату.
    }
  }

  return 'unknown';
}
