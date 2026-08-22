import { NoSuchKey, NotFound } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { S3Driver } from './s3.driver';

function createDriver(): S3Driver {
  return new S3Driver({
    endpoint: 'http://127.0.0.1:9000',
    bucket: 'bucket',
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test',
    },
  });
}

describe('S3Driver', () => {
  it('passes the abort signal to S3 while acquiring a read stream', async () => {
    const driver = createDriver();
    const controller = new AbortController();
    const send = jest.fn().mockImplementation(
      (_command, options: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener(
            'abort',
            () => reject(options.abortSignal.reason),
            { once: true },
          );
        }),
    );
    (driver.getDriver() as any).send = send;

    const reading = driver.readStream('attachment.bin', controller.signal);
    controller.abort(new DOMException('Stopped', 'AbortError'));

    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(send).toHaveBeenCalledWith(expect.any(Object), {
      abortSignal: controller.signal,
    });
    driver.getDriver().destroy();
  });

  it.each([
    new NoSuchKey({
      message: 'missing',
      $metadata: { httpStatusCode: 404 },
    }),
    new NotFound({
      message: 'missing',
      $metadata: { httpStatusCode: 404 },
    }),
    { name: 'NotFound' },
    { $metadata: { httpStatusCode: 404 } },
  ])('treats an S3 missing-object response as absent', async (error) => {
    const driver = createDriver();
    (driver.getDriver() as any).send = jest.fn().mockRejectedValue(error);

    await expect(driver.exists('missing.bin')).resolves.toBe(false);
    driver.getDriver().destroy();
  });

  it.each([
    { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } },
    new Error('network unavailable'),
  ])('keeps non-404 S3 failures fail-closed', async (error) => {
    const driver = createDriver();
    (driver.getDriver() as any).send = jest.fn().mockRejectedValue(error);

    await expect(driver.exists('unknown.bin')).rejects.toBe(error);
    driver.getDriver().destroy();
  });

  it('serializes a Unicode CopySource without changing the destination key', async () => {
    const requests: any[] = [];
    const requestHandler = {
      handle: jest.fn(async (request: any) => {
        requests.push(request);
        const isCopy = request.method === 'PUT';
        return {
          response: {
            statusCode: 200,
            headers: isCopy ? { 'content-type': 'application/xml' } : {},
            body: isCopy
              ? Readable.from([
                  '<CopyObjectResult><ETag>"etag"</ETag><LastModified>2026-08-22T00:00:00.000Z</LastModified></CopyObjectResult>',
                ])
              : undefined,
          },
        };
      }),
    };
    const driver = new S3Driver({
      endpoint: 'http://127.0.0.1:9000',
      bucket: 'source-bucket',
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
      requestHandler,
    });
    const sourceKey = 'workspace/files/source id/Заметка 100%/../report #1.pdf';
    const destinationKey = 'workspace/files/destination id/Копия отчёта #1.pdf';

    await driver.copy(sourceKey, destinationKey);

    const copyRequest = requests.find((request) => request.method === 'PUT');
    expect(copyRequest.headers['x-amz-copy-source']).toBe(
      'source-bucket/workspace/files/source%20id/%D0%97%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B0%20100%25/%2E%2E/report%20%231.pdf',
    );
    expect(copyRequest.path).toBe(
      '/source-bucket/workspace/files/destination%20id/%D0%9A%D0%BE%D0%BF%D0%B8%D1%8F%20%D0%BE%D1%82%D1%87%D1%91%D1%82%D0%B0%20%231.pdf',
    );
    driver.getDriver().destroy();
  });
});
