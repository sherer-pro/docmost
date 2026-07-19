import { validate } from 'class-validator';
import { UpdatePageCustomFieldsDto, UpdatePageDto } from './update-page.dto';
import {
  PAGE_AI_ROLE,
  PAGE_AI_ROLE_VALUES,
} from '@docmost/api-contract';

describe('UpdatePageDto legacy heading numbering', () => {
  it('drops shared heading numbering while preserving other settings', () => {
    const dto = Object.assign(new UpdatePageDto(), {
      pageId: 'page-1',
      settings: {
        headingNumbering: { enabled: false },
        customSetting: true,
      },
    });

    expect(
      dto.toSettingsPayload({
        status: 'TODO',
        headingNumbering: { enabled: true },
      }),
    ).toEqual({
      status: 'TODO',
      customSetting: true,
    });
  });
});

describe('UpdatePageDto AI role', () => {
  it.each(PAGE_AI_ROLE_VALUES)(
    'accepts %s',
    async (aiRole) => {
      const customFields = Object.assign(new UpdatePageCustomFieldsDto(), {
        aiRole,
      });
      const dto = Object.assign(new UpdatePageDto(), {
        pageId: 'page-1',
        customFields,
      });

      expect(await validate(dto)).toEqual([]);
    },
  );

  it.each([null, 'invalid'])('rejects %p', async (aiRole) => {
    const customFields = Object.assign(new UpdatePageCustomFieldsDto(), {
      aiRole,
    });
    const dto = Object.assign(new UpdatePageDto(), {
      pageId: 'page-1',
      customFields,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'customFields')).toBe(
      true,
    );
  });

  it('preserves an existing value when custom fields omit it', () => {
    const dto = Object.assign(new UpdatePageDto(), {
      pageId: 'page-1',
      customFields: { status: 'DONE' },
    });

    expect(
      dto.toSettingsPayload({
        aiRole: PAGE_AI_ROLE.COAUTHOR_PLUS,
      }),
    ).toEqual({
      status: 'DONE',
      aiRole: PAGE_AI_ROLE.COAUTHOR_PLUS,
    });
  });
});
