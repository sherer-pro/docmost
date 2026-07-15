import { validate } from 'class-validator';
import { UpdatePageDto } from './update-page.dto';

describe('UpdatePageDto heading numbering', () => {
  it.each([true, false, null])('accepts %p as an override', async (value) => {
    const dto = Object.assign(new UpdatePageDto(), {
      pageId: 'page-1',
      headingNumberingEnabled: value,
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('rejects non-boolean values', async () => {
    const dto = Object.assign(new UpdatePageDto(), {
      pageId: 'page-1',
      headingNumberingEnabled: 'yes',
    });

    const errors = await validate(dto);

    expect(
      errors.some((error) => error.property === 'headingNumberingEnabled'),
    ).toBe(true);
  });

  it('merges the override with existing page settings', () => {
    const dto = Object.assign(new UpdatePageDto(), {
      pageId: 'page-1',
      headingNumberingEnabled: false,
    });

    expect(
      dto.toSettingsPayload({
        status: 'TODO',
        headingNumbering: { enabled: true },
      }),
    ).toEqual({
      status: 'TODO',
      headingNumbering: { enabled: false },
    });
  });

  it('stores null to restore inheritance', () => {
    const dto = Object.assign(new UpdatePageDto(), {
      pageId: 'page-1',
      headingNumberingEnabled: null,
    });

    expect(dto.toSettingsPayload(null)).toEqual({
      headingNumbering: { enabled: null },
    });
  });
});
