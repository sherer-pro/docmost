import { BadRequestException } from '@nestjs/common';
import {
  resolveTrustedMimeType,
  validateFileExtensionAndSignature,
} from './file-validation';

describe('inline gallery media signatures', () => {
  const formats = [
    ['gif', Buffer.from('GIF89a\x01\0\x01\0', 'binary'), 'image/gif'],
    ['webp', Buffer.from('RIFF\0\0\0\0WEBP', 'binary'), 'image/webp'],
    ['wav', Buffer.from('RIFF\0\0\0\0WAVE', 'binary'), 'audio/wav'],
    ['avif', Buffer.from('\0\0\0\x18ftypavif', 'binary'), 'image/avif'],
    ['m4a', Buffer.from('\0\0\0\x18ftypM4A ', 'binary'), 'audio/mp4'],
    ['ogg', Buffer.from('OggS\0\x02', 'binary'), 'audio/ogg'],
    ['mp3', Buffer.from('ID3\x04\0', 'binary'), 'audio/mpeg'],
    [
      'webm',
      Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.from('webm')]),
      'video/webm',
    ],
  ] as const;
  it.each(formats)(
    'validates %s and derives MIME instead of trusting multipart metadata',
    async (ext, bytes, mime) => {
      await expect(
        validateFileExtensionAndSignature({
          fileName: `file.${ext}`,
          fileBuffer: bytes,
        }),
      ).resolves.toBeUndefined();
      expect(
        resolveTrustedMimeType({
          fileExtension: `.${ext}`,
          fileBuffer: bytes,
          fallbackMimeType: 'text/html',
        }),
      ).toBe(mime);
    },
  );
  it.each(formats)('rejects HTML disguised as %s', async (ext) => {
    await expect(
      validateFileExtensionAndSignature({
        fileName: `file.${ext}`,
        fileBuffer: Buffer.from('<html><script>bad</script>'),
      }),
    ).rejects.toThrow(BadRequestException);
  });
  it('does not classify a JPEG sync marker as an MPEG frame', () => {
    expect(
      resolveTrustedMimeType({
        fileExtension: '.jpg',
        fileBuffer: Buffer.from('ffd8ffe00000', 'hex'),
      }),
    ).toBe('image/jpeg');
  });
});
