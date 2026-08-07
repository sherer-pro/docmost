import * as fs from 'node:fs';
import { ShareSeoController } from './share-seo.controller';
import { resolveClientDistPath } from '../../common/utils/client-dist-path';

jest.mock('../../common/utils/client-dist-path', () => ({
  resolveClientDistPath: jest.fn(),
}));

describe('ShareSeoController', () => {
  const shareService = {
    getShareForPage: jest.fn(),
    isSharingAllowed: jest.fn(),
  };
  const workspaceRepo = {
    findFirst: jest.fn(),
    findByHostname: jest.fn(),
  };
  const environmentService = {
    isSelfHosted: jest.fn(),
    getSubdomainHost: jest.fn(),
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
    environmentService.getSubdomainHost.mockReturnValue('docmost.test');
    workspaceRepo.findFirst.mockResolvedValue({ id: 'workspace-1' });
    shareService.isSharingAllowed.mockResolvedValue(true);
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
      spaceId: 'space-1',
      searchIndexing: false,
      sharedPage: {
        title: '"><script>alert(1)</script>',
      },
    });

    const res = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
      header: jest.fn(),
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

  it('injects metadata for public share URLs without a share id', async () => {
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
      spaceId: 'space-1',
      searchIndexing: true,
      sharedPage: {
        title: 'Public page',
      },
    });

    const res = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
      header: jest.fn(),
    };

    await controller.getShare(
      res as any,
      { raw: { headers: {} } } as any,
      undefined,
      'public-page-page-1',
    );

    expect(shareService.getShareForPage).toHaveBeenCalledWith(
      '1',
      'workspace-1',
      undefined,
    );
    expect(res.type).toHaveBeenCalledWith('text/html');
    expect(res.send.mock.calls[0][0]).toContain('<title>Public page</title>');
    expect(res.send.mock.calls[0][0]).toContain(
      'property="og:title" content="Public page"',
    );
  });

  it('does not inject share metadata when sharing is disabled', async () => {
    const resolveClientDistPathMock =
      resolveClientDistPath as jest.MockedFunction<typeof resolveClientDistPath>;
    resolveClientDistPathMock.mockReturnValue('D:/tmp/client-dist');

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'createReadStream').mockReturnValue('index-stream' as any);

    shareService.getShareForPage.mockResolvedValue({
      spaceId: 'space-1',
      searchIndexing: true,
      sharedPage: {
        title: 'Hidden title',
      },
    });
    shareService.isSharingAllowed.mockResolvedValue(false);

    const res = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
      header: jest.fn(),
    };

    await controller.getShare(
      res as any,
      { raw: { headers: {} } } as any,
      'share-1',
      'some-page-slug-id',
    );

    expect(res.send).toHaveBeenCalledWith('index-stream');
    expect(fs.createReadStream).toHaveBeenCalledWith(
      expect.stringMatching(/index\.html$/),
    );
  });

  it('resolves cloud workspace only from the configured subdomain host', async () => {
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

    environmentService.isSelfHosted.mockReturnValue(false);
    workspaceRepo.findByHostname.mockResolvedValue({ id: 'workspace-2' });
    shareService.getShareForPage.mockResolvedValue({
      spaceId: 'space-1',
      searchIndexing: true,
      sharedPage: {
        title: 'Cloud page',
      },
    });

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(indexHtml);

    const res = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
      header: jest.fn(),
    };

    await controller.getShare(
      res as any,
      { raw: { headers: { host: 'team.docmost.test:3000' } } } as any,
      'share-1',
      'cloud-page-page-1',
    );

    expect(workspaceRepo.findByHostname).toHaveBeenCalledWith('team');
    expect(shareService.getShareForPage).toHaveBeenCalledWith(
      '1',
      'workspace-2',
      'share-1',
    );
    expect(res.send.mock.calls[0][0]).toContain('<title>Cloud page</title>');
  });

  it('does not resolve cloud workspace from an untrusted host suffix', async () => {
    const resolveClientDistPathMock =
      resolveClientDistPath as jest.MockedFunction<typeof resolveClientDistPath>;
    resolveClientDistPathMock.mockReturnValue('D:/tmp/client-dist');

    environmentService.isSelfHosted.mockReturnValue(false);
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'createReadStream').mockReturnValue('index-stream' as any);

    const res = {
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
      header: jest.fn(),
    };

    await controller.getShare(
      res as any,
      { raw: { headers: { host: 'team.attacker.test' } } } as any,
      'share-1',
      'cloud-page-page-1',
    );

    expect(workspaceRepo.findByHostname).not.toHaveBeenCalled();
    expect(shareService.getShareForPage).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith('index-stream');
  });

  it('marks share HTML as non-cacheable', async () => {
    const resolveClientDistPathMock =
      resolveClientDistPath as jest.MockedFunction<typeof resolveClientDistPath>;
    resolveClientDistPathMock.mockReturnValue(undefined);
    const res = {
      header: jest.fn(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    await controller.getShare(
      res as any,
      { raw: { headers: {} } } as any,
      'share-1',
      'page-1',
    );

    expect(res.header).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
  });
});
