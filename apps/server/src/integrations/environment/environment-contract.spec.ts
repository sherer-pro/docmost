import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function extractServiceKeys(source: string): string[] {
  return [
    ...new Set(
      [...source.matchAll(/get<[^>]+>\(\s*'([A-Z0-9_]+)'/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort();
}

function extractValidationKeys(source: string): string[] {
  return [
    ...new Set(
      [...source.matchAll(/^\s*([A-Z0-9_]+):\s*(?:string|boolean);/gm)].map(
        (match) => match[1],
      ),
    ),
  ].sort();
}

describe('Environment contract consistency', () => {
  it('keeps EnvironmentService and EnvironmentVariables keys in sync', () => {
    const serviceSource = readFileSync(
      join(__dirname, 'environment.service.ts'),
      'utf8',
    );
    const validationSource = readFileSync(
      join(__dirname, 'environment.validation.ts'),
      'utf8',
    );

    const serviceKeys = extractServiceKeys(serviceSource);
    const validationKeys = extractValidationKeys(validationSource);

    const missingInValidation = serviceKeys.filter(
      (key) => !validationKeys.includes(key),
    );
    const missingInService = validationKeys.filter(
      (key) => !serviceKeys.includes(key),
    );

    expect(missingInValidation).toEqual([]);
    expect(missingInService).toEqual([]);
  });
});
