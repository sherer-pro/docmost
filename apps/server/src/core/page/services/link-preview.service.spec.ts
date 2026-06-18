import { BadRequestException } from '@nestjs/common';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { LinkPreviewService } from './link-preview.service';

describe('LinkPreviewService', () => {
  let service: LinkPreviewService;

  beforeEach(() => {
    service = new LinkPreviewService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createHtmlResponse(
    html: string,
    headers: IncomingHttpHeaders = { 'content-type': 'text/html' },
  ) {
    const body = Readable.from([html]) as unknown as IncomingMessage;
    body.headers = headers;

    return {
      statusCode: 200,
      headers,
      body,
    };
  }

  it('rejects non-http URLs before making a request', async () => {
    await expect(service.getPreview('file:///etc/passwd')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects localhost targets before making a request', async () => {
    await expect(
      service.getPreview('http://localhost/private'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects private IP targets before making a request', async () => {
    await expect(
      service.getPreview('http://127.0.0.1/private'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns a fallback preview when public metadata fetch fails', async () => {
    jest
      .spyOn(service as any, 'resolvePublicUrlAddresses')
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    jest
      .spyOn(service as any, 'requestLinkPreview')
      .mockRejectedValue(new Error('timeout'));

    await expect(
      service.getPreview('https://gitlab.sherer.pro/admin'),
    ).resolves.toEqual({
      url: 'https://gitlab.sherer.pro/admin',
      title: 'gitlab.sherer.pro',
      description: '',
      image: null,
      siteName: 'gitlab.sherer.pro',
    });
  });

  it('tries remaining public addresses before using fallback metadata', async () => {
    jest.spyOn(service as any, 'resolvePublicUrlAddresses').mockResolvedValue([
      { address: '2001:4860:4860::8888', family: 6 },
      { address: '93.184.216.34', family: 4 },
    ]);
    const requestSpy = jest
      .spyOn(service as any, 'requestLinkPreview')
      .mockRejectedValueOnce(new Error('first address failed'))
      .mockResolvedValueOnce(
        createHtmlResponse(
          '<html><head><title>Example page</title><meta name="description" content="Example description"></head></html>',
        ),
      );

    await expect(service.getPreview('https://example.com/page')).resolves.toEqual(
      {
        url: 'https://example.com/page',
        title: 'Example page',
        description: 'Example description',
        image: null,
        siteName: 'example.com',
      },
    );
    expect(requestSpy).toHaveBeenCalledTimes(2);
    expect(requestSpy).toHaveBeenNthCalledWith(
      1,
      expect.any(URL),
      { address: '2001:4860:4860::8888', family: 6 },
    );
    expect(requestSpy).toHaveBeenNthCalledWith(
      2,
      expect.any(URL),
      { address: '93.184.216.34', family: 4 },
    );
  });

  it('supports Node lookups that request all resolved addresses', () => {
    const lookup = (service as any).createPinnedAddressLookup({
      address: '140.82.121.3',
      family: 4,
    });
    const callback = jest.fn();

    lookup('github.com', { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [
      { address: '140.82.121.3', family: 4 },
    ]);
  });
});
