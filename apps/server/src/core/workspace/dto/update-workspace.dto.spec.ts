import { validate } from 'class-validator';
import { UpdateWorkspaceDto } from './update-workspace.dto';

describe('UpdateWorkspaceDto page history retention', () => {
  it.each(['read', 'edit', undefined])(
    'accepts initial editor mode %p',
    async (value) => {
      await expect(
        validate(
          Object.assign(new UpdateWorkspaceDto(), {
            defaultPageEditMode: value,
          }),
        ),
      ).resolves.toHaveLength(0);
    },
  );

  it.each(['invalid', true, null])(
    'rejects initial editor mode %p',
    async (value) => {
      expect(
        await validate(
          Object.assign(new UpdateWorkspaceDto(), {
            defaultPageEditMode: value,
          }),
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'defaultPageEditMode' }),
        ]),
      );
    },
  );
  async function validateRetention(value: number | null) {
    const dto = Object.assign(new UpdateWorkspaceDto(), {
      pageHistoryRetentionDays: value,
    });
    return validate(dto);
  }

  it.each([null, 30, 3650])('accepts %p retention days', async (value) => {
    await expect(validateRetention(value)).resolves.toHaveLength(0);
  });

  it.each([29, 3651, 30.5])('rejects %p retention days', async (value) => {
    const errors = await validateRetention(value);
    expect(
      errors.some((error) => error.property === 'pageHistoryRetentionDays'),
    ).toBe(true);
  });
});
