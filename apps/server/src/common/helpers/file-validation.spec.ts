import {
  resolveTrustedMimeType,
  SAFE_FILE_VALIDATION_ERROR_MESSAGE,
  validateFileExtensionAndSignature,
} from './file-validation';

describe('validateFileExtensionAndSignature', () => {
  const pngBuffer = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de',
    'hex',
  );

  const zipBuffer = Buffer.from('504b0304140000000800', 'hex');
  const mp4Buffer = Buffer.from('000000186674797069736f6d00000200', 'hex');
  const movBuffer = Buffer.from('00000014667479707174202000000000', 'hex');

  it('rejects spoofed zip extension with png signature', async () => {
    await expect(
      validateFileExtensionAndSignature({
        fileName: 'archive.zip',
        fileBuffer: pngBuffer,
        allowedExtensions: ['.zip'],
      }),
    ).rejects.toThrow(SAFE_FILE_VALIDATION_ERROR_MESSAGE);
  });

  it('rejects spoofed docx extension with png signature', async () => {
    await expect(
      validateFileExtensionAndSignature({
        fileName: 'document.docx',
        fileBuffer: pngBuffer,
        allowedExtensions: ['.md', '.html', '.docx'],
      }),
    ).rejects.toThrow(SAFE_FILE_VALIDATION_ERROR_MESSAGE);
  });

  it('accepts real zip signature for zip extension', async () => {
    await expect(
      validateFileExtensionAndSignature({
        fileName: 'archive.zip',
        fileBuffer: zipBuffer,
        allowedExtensions: ['.zip'],
      }),
    ).resolves.toBeUndefined();
  });

  it('accepts real mp4 and mov signatures for inline video extensions', async () => {
    await expect(
      validateFileExtensionAndSignature({
        fileName: 'clip.mp4',
        fileBuffer: mp4Buffer,
        allowedExtensions: ['.mp4'],
      }),
    ).resolves.toBeUndefined();

    await expect(
      validateFileExtensionAndSignature({
        fileName: 'clip.mov',
        fileBuffer: movBuffer,
        allowedExtensions: ['.mov'],
      }),
    ).resolves.toBeUndefined();
  });

  it('normalizes trusted mime types from signatures instead of client input', () => {
    expect(
      resolveTrustedMimeType({
        fileExtension: '.mp4',
        fileBuffer: mp4Buffer,
        fallbackMimeType: 'text/html',
      }),
    ).toBe('video/mp4');
  });

  it('keeps the canonical DOCX mime type after validating its ZIP signature', () => {
    expect(
      resolveTrustedMimeType({
        fileExtension: '.docx',
        fileBuffer: zipBuffer,
        fallbackMimeType: 'application/zip',
      }),
    ).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });
});
