import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AddLabelsDto } from './label.dto';

describe('AddLabelsDto', () => {
  it('allows unicode label names', async () => {
    const dto = plainToInstance(AddLabelsDto, {
      pageId: '8f2e0b8b-6c6f-4f9d-a5c9-2a2c4e32b1c0',
      names: ['тест'],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects label names starting with tilde', async () => {
    const dto = plainToInstance(AddLabelsDto, {
      pageId: '8f2e0b8b-6c6f-4f9d-a5c9-2a2c4e32b1c0',
      names: ['~draft'],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('names');
  });
});
