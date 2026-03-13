import * as fs from 'node:fs';
import { ShareSeoController } from './share-seo.controller';
import { resolveClientDistPath } from '../../common/utils/client-dist-path';

jest.mock('../../common/utils/client-dist-path', () => ({
  resolveClientDistPath: jest.fn(),
}));

describe('ShareSeoController', () => {
  const shareService = {
    getShareForPage: jest.fn(),
  };
  const workspaceRepo = {
    findFirst: jest.fn(),
    findByHostname: jest.fn(),
  };
  const environmentService = {
    isSelfHosted: jest.fn(),
  };

  const controller = new ShareSeoController(
    shareService as any,
    workspaceRepo as any,
    environmentService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    environmentService.isSelfHosted.mockReturnValue(true);
    workspaceRepo.findFirst.mockResolvedValue({ id: 'workspace-1' });
  });

  it('escapes malicious titles before injecting title and meta tags', async () => {
    const indexHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Docmost</title>
          <!--meta-tags-->
        </head>
        <body></body>
      </html>
    `.trim();

    const resolveClientDistPathMock =
      resolveClientDistPath as jest.MockedFunction<typeof resolveClientDistPath>;
    resolveClientDistPathMock.mockReturnValue('D:/tmp/client-dist');

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(indexHtml);

    shareService.getShareForPage.mockResolvedValue({
      searchIndexing: false,
      sharedPage: {
        title: '"><script>alert(1)</script>',
      },
    });

    const res = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    await controller.getShare(
      res as any,
      { raw: { headers: {} } } as any,
      'share-1',
      'some-page-slug-id',
    );

    expect(res.type).toHaveBeenCalledWith('text/html');
    expect(res.send).toHaveBeenCalledTimes(1);

    const renderedHtml = res.send.mock.calls[0][0];
    expect(typeof renderedHtml).toBe('string');

    expect(renderedHtml).toContain(
      '<title>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>',
    );
    expect(renderedHtml).toContain(
      'content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"',
    );
    expect(renderedHtml).toContain('name="robots" content="noindex"');
    expect(renderedHtml).not.toContain('<script>alert(1)</script>');
  });
});
