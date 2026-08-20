import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PageReferencesQueryDto } from './page.dto';

describe('PageReferencesQueryDto', () => {
  it('accepts comma-separated and repeated UUID query values', () => {
    const dto = plainToInstance(PageReferencesQueryDto, {
      ids: [
        '11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
      ],
    });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.ids).toHaveLength(3);
  });

  it('rejects more than 50 IDs', () => {
    const dto = plainToInstance(PageReferencesQueryDto, {
      ids: Array.from(
        { length: 51 },
        (_, index) =>
          `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      ),
    });

    expect(validateSync(dto)).not.toHaveLength(0);
  });

  it('rejects missing and invalid IDs', () => {
    const missing = plainToInstance(PageReferencesQueryDto, {});
    const invalid = plainToInstance(PageReferencesQueryDto, {
      ids: 'not-a-page-id',
    });

    expect(validateSync(missing)).not.toHaveLength(0);
    expect(validateSync(invalid)).not.toHaveLength(0);
  });
});
