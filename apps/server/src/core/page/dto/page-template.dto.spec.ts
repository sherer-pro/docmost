import 'reflect-metadata';
import { validate } from 'class-validator';
import {
  PageTemplateDestinationsDto,
  PageTemplateDiscoveryDto,
  PageTemplatePolicyGroupsDto,
} from './page-template.dto';

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

  it('accepts active and archived states while rejecting unknown values', async () => {
    const active = new PageTemplateDiscoveryDto();
    active.spaceId = '019fdaa0-0000-7000-8000-000000000001';
    active.archiveState = 'active';
    const archived = new PageTemplateDiscoveryDto();
    archived.spaceId = active.spaceId;
    archived.archiveState = 'archived';
    const invalid = new PageTemplateDiscoveryDto();
    invalid.spaceId = active.spaceId;
    invalid.archiveState = 'all' as never;

    expect(await validate(active)).toEqual([]);
    expect(await validate(archived)).toEqual([]);
    expect(
      (await validate(invalid)).some(
        (error) => error.property === 'archiveState',
      ),
    ).toBe(true);
  });
});

describe('PageTemplateDestinationsDto', () => {
  it('defaults to destination and accepts the source purpose', async () => {
    const destination = new PageTemplateDestinationsDto();
    destination.spaceId = '019fdaa0-0000-7000-8000-000000000001';
    const source = new PageTemplateDestinationsDto();
    source.spaceId = destination.spaceId;
    source.purpose = 'source';

    expect(destination.purpose).toBe('destination');
    expect(await validate(destination)).toEqual([]);
    expect(await validate(source)).toEqual([]);
  });

  it('accepts an exact canonical page lookup and rejects invalid IDs', async () => {
    const valid = new PageTemplateDestinationsDto();
    valid.spaceId = '019fdaa0-0000-7000-8000-000000000001';
    valid.purpose = 'source';
    valid.pageId = '019fdaa0-0000-7000-8000-000000000002';
    const invalid = new PageTemplateDestinationsDto();
    invalid.spaceId = valid.spaceId;
    invalid.purpose = 'source';
    invalid.pageId = 'stale-slug';

    expect(await validate(valid)).toEqual([]);
    expect(
      (await validate(invalid)).some((error) => error.property === 'pageId'),
    ).toBe(true);
  });
});

describe('PageTemplatePolicyGroupsDto', () => {
  it('accepts bounded cursor pagination and rejects oversized searches', async () => {
    const valid = new PageTemplatePolicyGroupsDto();
    valid.limit = 50;
    valid.cursor = 'opaque';
    valid.query = 'Design';
    const invalid = new PageTemplatePolicyGroupsDto();
    invalid.limit = 51;
    invalid.query = 'x'.repeat(201);

    expect(await validate(valid)).toEqual([]);
    expect((await validate(invalid)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['limit', 'query']),
    );
  });
});
