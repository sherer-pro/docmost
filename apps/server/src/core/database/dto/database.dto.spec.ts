import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BatchUpdateDatabaseCellsDto,
  BatchUpdateDatabaseRowsDto,
  CreateDatabasePropertyDto,
  CreateDatabaseViewDto,
  UpdateDatabasePropertyDto,
} from './database.dto';

const uuid = '00000000-0000-4000-8000-000000000001';

async function validatePayload<T extends object>(
  dtoClass: new () => T,
  payload: Record<string, unknown>,
) {
  return validate(plainToInstance(dtoClass, payload));
}

describe('database DTO limits', () => {
  it('accepts only non-negative integer property positions', async () => {
    await expect(
      validatePayload(UpdateDatabasePropertyDto, { position: 2 }),
    ).resolves.toHaveLength(0);

    const negativeErrors = await validatePayload(UpdateDatabasePropertyDto, {
      position: -1,
    });
    const decimalErrors = await validatePayload(UpdateDatabasePropertyDto, {
      position: 1.5,
    });

    expect(JSON.stringify(negativeErrors)).toContain('min');
    expect(JSON.stringify(decimalErrors)).toContain('isInt');
  });

  it('rejects select settings with too many options', async () => {
    const errors = await validatePayload(CreateDatabasePropertyDto, {
      name: 'Status',
      type: 'select',
      settings: {
        options: Array.from({ length: 101 }, (_, index) => ({
          label: `Option ${index}`,
          value: `option-${index}`,
        })),
      },
    });

    expect(JSON.stringify(errors)).toContain('arrayMaxSize');
  });

  it('rejects row cell batch payloads with too many cells', async () => {
    const errors = await validatePayload(BatchUpdateDatabaseCellsDto, {
      cells: Array.from({ length: 201 }, () => ({
        propertyId: uuid,
        value: 'value',
      })),
    });

    expect(JSON.stringify(errors)).toContain('arrayMaxSize');
  });

  it('rejects row batch payloads with too many rows', async () => {
    const errors = await validatePayload(BatchUpdateDatabaseRowsDto, {
      rows: Array.from({ length: 201 }, (_, index) => ({
        pageId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        cells: [],
      })),
    });

    expect(JSON.stringify(errors)).toContain('arrayMaxSize');
  });

  it('rejects view config payloads that exceed the JSON size cap', async () => {
    const errors = await validatePayload(CreateDatabaseViewDto, {
      name: 'Large view',
      type: 'table',
      config: {
        value: 'x'.repeat(50_001),
      },
    });

    expect(JSON.stringify(errors)).toContain('maxJsonStringifiedLength');
  });

  it('rejects view config payloads that exceed the JSON depth cap', async () => {
    let config: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 13; index += 1) {
      config = { nested: config };
    }

    const errors = await validatePayload(CreateDatabaseViewDto, {
      name: 'Deep view',
      type: 'table',
      config,
    });

    expect(JSON.stringify(errors)).toContain('maxJsonDepth');
  });
});
