import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const localesDir = path.resolve(__dirname, '../../public/locales');
const baseLocale = 'en-US';

type FlatTranslations = Record<string, unknown>;

function flattenTranslations(input: Record<string, unknown>, prefix = '', out: FlatTranslations = {}) {
  for (const [key, value] of Object.entries(input)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenTranslations(value as Record<string, unknown>, nextKey, out);
      continue;
    }
    out[nextKey] = value;
  }
  return out;
}

function loadLocale(locale: string) {
  const filePath = path.join(localesDir, locale, 'translation.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

describe('translation locale coverage', () => {
  it('ensures all locales include all en-US keys and have no empty values', () => {
    const locales = fs
      .readdirSync(localesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    const baseTranslations = flattenTranslations(loadLocale(baseLocale));
    const baseKeys = Object.keys(baseTranslations);

    for (const locale of locales) {
      if (locale === baseLocale) {
        continue;
      }

      const currentTranslations = flattenTranslations(loadLocale(locale));
      const missingKeys = baseKeys.filter((key) => !(key in currentTranslations));
      const emptyKeys = Object.entries(currentTranslations)
        .filter(([, value]) => value === '' || value === null || value === undefined)
        .map(([key]) => key);

      assert.deepEqual(
        missingKeys,
        [],
        `${locale} is missing ${missingKeys.length} key(s): ${missingKeys.join(', ')}`,
      );
      assert.deepEqual(
        emptyKeys,
        [],
        `${locale} has ${emptyKeys.length} empty key(s): ${emptyKeys.join(', ')}`,
      );
    }
  });
});
