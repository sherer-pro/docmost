import { BadRequestException } from '@nestjs/common';
import { LinkPreviewService } from './link-preview.service';

describe('LinkPreviewService', () => {
  const service = new LinkPreviewService();

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
});
