import { S3Driver } from './s3.driver';

describe('S3Driver', () => {
  it('passes the abort signal to S3 while acquiring a read stream', async () => {
    const driver = new S3Driver({
      endpoint: 'http://127.0.0.1:9000',
      bucket: 'bucket',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });
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
});
