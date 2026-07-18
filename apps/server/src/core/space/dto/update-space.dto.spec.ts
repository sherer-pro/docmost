import { validate } from 'class-validator';
import {
  UpdateSpaceDocumentFieldsDto,
  UpdateSpaceDto,
} from './update-space.dto';

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

describe('UpdateSpaceDto AI participation field', () => {
  it.each([true, false])('accepts %p', async (aiParticipation) => {
    const documentFields = Object.assign(new UpdateSpaceDocumentFieldsDto(), {
      aiParticipation,
    });
    const dto = Object.assign(new UpdateSpaceDto(), {
      spaceId: '11111111-1111-4111-8111-111111111111',
      documentFields,
    });

    expect(await validate(dto)).toEqual([]);
  });

  it('rejects a non-boolean value', async () => {
    const documentFields = Object.assign(new UpdateSpaceDocumentFieldsDto(), {
      aiParticipation: 'yes',
    });
    const dto = Object.assign(new UpdateSpaceDto(), {
      spaceId: '11111111-1111-4111-8111-111111111111',
      documentFields,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'documentFields')).toBe(
      true,
    );
  });
});

describe('UpdateSpaceDto reading time field', () => {
  it.each([true, false])('accepts %p', async (readingTime) => {
    const documentFields = Object.assign(new UpdateSpaceDocumentFieldsDto(), {
      readingTime,
    });
    const dto = Object.assign(new UpdateSpaceDto(), {
      spaceId: '11111111-1111-4111-8111-111111111111',
      documentFields,
    });

    expect(await validate(dto)).toEqual([]);
  });

  it('rejects a non-boolean value', async () => {
    const documentFields = Object.assign(new UpdateSpaceDocumentFieldsDto(), {
      readingTime: 'yes',
    });
    const dto = Object.assign(new UpdateSpaceDto(), {
      spaceId: '11111111-1111-4111-8111-111111111111',
      documentFields,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'documentFields')).toBe(
      true,
    );
  });
});
