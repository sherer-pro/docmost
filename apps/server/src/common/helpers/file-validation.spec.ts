import {
  SAFE_FILE_VALIDATION_ERROR_MESSAGE,
  validateFileExtensionAndSignature,
} from './file-validation';

describe('validateFileExtensionAndSignature', () => {
  const pngBuffer = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de',
    'hex',
  );

  const zipBuffer = Buffer.from('504b0304140000000800', 'hex');

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
});
