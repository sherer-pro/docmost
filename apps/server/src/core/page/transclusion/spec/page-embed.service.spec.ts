import { PageEmbedService } from '../page-embed.service';

function buildService(
  edges: Array<{ referencePageId: string; sourcePageId: string }> = [],
) {
  const references = {
    findPageGraph: jest.fn(async () => edges),
  };
  const service = new PageEmbedService(
    null as any,
    references as any,
    null as any,
    null as any,
    { getMaxPageEmbedDepth: () => 5 } as any,
    {} as any,
  );
  return { service, references };
}

describe('PageEmbedService graph validation', () => {
  it('rejects direct self references', async () => {
    const { service } = buildService();
    await expect(
      service.assertGraphValid('workspace', 'page-a', ['page-a']),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'page_embed_self_reference' }),
    });
  });

  it('rejects indirect cycles against the persisted graph', async () => {
    const { service } = buildService([
      { referencePageId: 'page-b', sourcePageId: 'page-c' },
      { referencePageId: 'page-c', sourcePageId: 'page-a' },
    ]);
    await expect(
      service.assertGraphValid('workspace', 'page-a', ['page-b']),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'page_embed_cycle' }),
    });
  });

  it('accepts depth five and rejects depth six', async () => {
    const depthFive = [
      { referencePageId: 'b', sourcePageId: 'c' },
      { referencePageId: 'c', sourcePageId: 'd' },
      { referencePageId: 'd', sourcePageId: 'e' },
      { referencePageId: 'e', sourcePageId: 'f' },
    ];
    await expect(
      buildService(depthFive).service.assertGraphValid('workspace', 'a', ['b']),
    ).resolves.toBeUndefined();

    await expect(
      buildService([
        ...depthFive,
        { referencePageId: 'f', sourcePageId: 'g' },
      ]).service.assertGraphValid('workspace', 'a', ['b']),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'page_embed_depth_exceeded',
      }),
    });
  });

  it('rejects a deep graph without recursive stack growth', async () => {
    const edges = Array.from({ length: 9_000 }, (_, index) => ({
      referencePageId: `page-${index}`,
      sourcePageId: `page-${index + 1}`,
    }));

    await expect(
      buildService(edges).service.assertGraphValid('workspace', 'root', [
        'page-0',
      ]),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'page_embed_depth_exceeded',
      }),
    });
  });
});
