import {
  HtmlPdfRendererService,
  isAllowedPdfResourceUrl,
} from './html-pdf-renderer.service';
import { MERMAID_SANITIZATION_POLICY } from '@docmost/api-contract';

describe('isAllowedPdfResourceUrl', () => {
  const appUrl = 'https://docs.example.com';

  it('allows same-origin public attachment resources', () => {
    expect(
      isAllowedPdfResourceUrl(
        'https://docs.example.com/api/files/public/file-id/image.png',
        appUrl,
      ),
    ).toBe(true);

    expect(
      isAllowedPdfResourceUrl(
        'https://docs.example.com/api/attachments/files/public/file-id/image.png',
        appUrl,
      ),
    ).toBe(true);
  });

  it('allows bitmap data resources and about:blank', () => {
    expect(isAllowedPdfResourceUrl('about:blank', appUrl)).toBe(true);
    expect(isAllowedPdfResourceUrl('data:image/png;base64,abc', appUrl)).toBe(
      true,
    );
    expect(isAllowedPdfResourceUrl('data:image/jpeg;base64,abc=', appUrl)).toBe(
      true,
    );
  });

  it('blocks active or markup data resources', () => {
    expect(
      isAllowedPdfResourceUrl(
        'data:image/svg+xml,<svg onload=alert(1)></svg>',
        appUrl,
      ),
    ).toBe(false);
    expect(
      isAllowedPdfResourceUrl('data:text/html,<script></script>', appUrl),
    ).toBe(false);
  });

  it('blocks external and private-network resources', () => {
    expect(
      isAllowedPdfResourceUrl('https://cdn.example.org/image.png', appUrl),
    ).toBe(false);
    expect(
      isAllowedPdfResourceUrl(
        'http://169.254.169.254/latest/meta-data/iam/security-credentials',
        appUrl,
      ),
    ).toBe(false);
  });

  it('blocks same-origin non-attachment resources', () => {
    expect(
      isAllowedPdfResourceUrl(
        'https://docs.example.com/window-config.js',
        appUrl,
      ),
    ).toBe(false);
  });
});

describe('HtmlPdfRendererService attachment request authorization', () => {
  it('injects an attachment-specific token and aborts unknown attachments', async () => {
    let requestHandler: ((request: any) => void) | undefined;
    const page = {
      setRequestInterception: jest.fn(async () => undefined),
      on: jest.fn((_event: string, handler: (request: any) => void) => {
        requestHandler = handler;
      }),
    };
    const service = new HtmlPdfRendererService({
      getAppUrl: () => 'https://docs.example.com',
    } as any);
    await (service as any).configureRequestInterception(page, {
      'known-id': 'known-token',
    });

    const known = {
      url: () => 'https://docs.example.com/api/files/public/known-id/image.png',
      headers: () => ({ accept: 'image/*' }),
      continue: jest.fn(async () => undefined),
      abort: jest.fn(async () => undefined),
    };
    requestHandler!(known);
    expect(known.continue).toHaveBeenCalledWith({
      headers: {
        accept: 'image/*',
        'x-attachment-token': 'known-token',
      },
    });

    const unknown = {
      url: () =>
        'https://docs.example.com/api/files/public/unknown-id/image.png',
      headers: () => ({}),
      continue: jest.fn(async () => undefined),
      abort: jest.fn(async () => undefined),
    };
    requestHandler!(unknown);
    expect(unknown.abort).toHaveBeenCalledTimes(1);
    expect(unknown.continue).not.toHaveBeenCalled();
  });

  it('fails closed when an allowed attachment image cannot be rendered', async () => {
    const service = new HtmlPdfRendererService({} as any);
    const page = {
      evaluate: jest.fn().mockResolvedValue(2),
    };

    await expect(
      (service as any).assertAttachmentImagesLoaded(page),
    ).rejects.toThrow('PDF export failed to load 2 attachment image resource(s)');
  });
});

describe('HtmlPdfRendererService Mermaid sanitization', () => {
  it('passes the shared sanitization policy into the isolated page context', async () => {
    const page = {
      evaluate: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(undefined),
      addScriptTag: jest.fn().mockResolvedValue(undefined),
    };
    const service = new HtmlPdfRendererService({} as any);
    jest
      .spyOn(service as any, 'resolveMermaidScriptPath')
      .mockReturnValue('mermaid.min.js');

    await (service as any).renderMermaidDiagrams(page);

    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(page.evaluate.mock.calls[1][1]).toEqual(
      MERMAID_SANITIZATION_POLICY,
    );
  });
});
