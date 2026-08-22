import { validate } from 'class-validator';
import { UpdateWorkspaceDto } from './update-workspace.dto';

describe('UpdateWorkspaceDto page history retention', () => {
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
    expect(errors.some((error) => error.property === 'pageHistoryRetentionDays')).toBe(
      true,
    );
  });
});
