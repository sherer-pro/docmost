import { validate } from 'class-validator';
import { UpdateSpaceDto } from './update-space.dto';

describe('UpdateSpaceDto heading numbering', () => {
  it.each([true, false])('accepts %p', async (value) => {
    const dto = Object.assign(new UpdateSpaceDto(), {
      spaceId: '11111111-1111-4111-8111-111111111111',
      headingNumberingEnabled: value,
    });

    expect(await validate(dto)).toEqual([]);
  });

  it('rejects non-boolean values', async () => {
    const dto = Object.assign(new UpdateSpaceDto(), {
      spaceId: '11111111-1111-4111-8111-111111111111',
      headingNumberingEnabled: 'yes',
    });

    const errors = await validate(dto);

    expect(
      errors.some((error) => error.property === 'headingNumberingEnabled'),
    ).toBe(true);
  });
});
