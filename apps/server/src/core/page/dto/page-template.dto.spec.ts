import 'reflect-metadata';
import { validate } from 'class-validator';
import { PageTemplateDiscoveryDto } from './page-template.dto';

describe('PageTemplateDiscoveryDto', () => {
  it('requires a valid spaceId', async () => {
    const missing = new PageTemplateDiscoveryDto();
    const invalid = new PageTemplateDiscoveryDto();
    invalid.spaceId = 'not-a-uuid';

    expect(
      (await validate(missing)).some((error) => error.property === 'spaceId'),
    ).toBe(true);
    expect(
      (await validate(invalid)).some((error) => error.property === 'spaceId'),
    ).toBe(true);
  });

  it('accepts a valid spaceId', async () => {
    const dto = new PageTemplateDiscoveryDto();
    dto.spaceId = '019fdaa0-0000-7000-8000-000000000001';

    expect(await validate(dto)).toEqual([]);
  });
});
