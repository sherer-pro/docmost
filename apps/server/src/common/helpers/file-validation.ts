import { BadRequestException } from '@nestjs/common';
import * as path from 'path';

/**
 * Unified safe file validation message.
 * It intentionally avoids extra technical details about rejected formats/signatures.
 */
export const SAFE_FILE_VALIDATION_ERROR_MESSAGE = 'Invalid file upload.';

const SIGNATURE_RULES: Record<string, string[]> = {
  '.zip': ['zip'],
  '.docx': ['zip'],
  '.jpg': ['jpg'],
  '.jpeg': ['jpg'],
  '.png': ['png'],
  '.pdf': ['pdf'],
};

/**
 * Validates a file with 2 factors:
 * 1) extension allow-list validation;
 * 2) magic-bytes signature validation.
 *
 * @param fileName Multipart file name.
 * @param fileBuffer Full file buffer or prefetched signature bytes.
 * @param allowedExtensions Explicit extension allow-list for endpoint-specific checks.
 * @param safeErrorMessage Unified safe validation message.
 */
export async function validateFileExtensionAndSignature(opts: {
  fileName: string;
  fileBuffer: Buffer;
  allowedExtensions?: string[];
  safeErrorMessage?: string;
}): Promise<void> {
  const {
    fileName,
    fileBuffer,
    allowedExtensions,
    safeErrorMessage = SAFE_FILE_VALIDATION_ERROR_MESSAGE,
  } = opts;

  const fileExtension = path.extname(fileName).toLowerCase();

  if (allowedExtensions && !allowedExtensions.includes(fileExtension)) {
    throw new BadRequestException(safeErrorMessage);
  }

  if (!fileBuffer?.length) {
    throw new BadRequestException(safeErrorMessage);
  }

  const detected = detectFileTypeFromBuffer(fileBuffer);
  const expectedSignatures = SIGNATURE_RULES[fileExtension];

  // For extensions without a signature map in this helper, validation
  // intentionally stays extension-only (e.g. .md/.html) for compatibility.
  if (!expectedSignatures) {
    return;
  }

  if (!detected || !expectedSignatures.includes(detected.ext)) {
    throw new BadRequestException(safeErrorMessage);
  }
}

/**
 * Reads magic bytes from a Node.js readable stream without losing data.
 * The consumed chunk is pushed back via `unshift` for downstream readers.
 */
export async function readMagicBytesFromStream(
  stream: NodeJS.ReadableStream,
  maxBytes = 4100,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      cleanup();
      stream.pause?.();
      stream.unshift?.(chunk);
      resolve(chunk.subarray(0, maxBytes));
    };

    const onEnd = () => {
      cleanup();
      resolve(Buffer.alloc(0));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
    };

    stream.once('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
  });
}

function detectFileTypeFromBuffer(
  fileBuffer: Buffer,
): { ext: string; mime: string } | undefined {
  if (fileBuffer.length >= 4) {
    // ZIP (PK\x03\x04 / PK\x05\x06 / PK\x07\x08)
    if (
      fileBuffer[0] === 0x50 &&
      fileBuffer[1] === 0x4b &&
      [0x03, 0x05, 0x07].includes(fileBuffer[2]) &&
      [0x04, 0x06, 0x08].includes(fileBuffer[3])
    ) {
      return { ext: 'zip', mime: 'application/zip' };
    }

    // PDF (%PDF)
    if (
      fileBuffer[0] === 0x25 &&
      fileBuffer[1] === 0x50 &&
      fileBuffer[2] === 0x44 &&
      fileBuffer[3] === 0x46
    ) {
      return { ext: 'pdf', mime: 'application/pdf' };
    }
  }

  if (fileBuffer.length >= 8) {
    // PNG signature
    if (
      fileBuffer[0] === 0x89 &&
      fileBuffer[1] === 0x50 &&
      fileBuffer[2] === 0x4e &&
      fileBuffer[3] === 0x47 &&
      fileBuffer[4] === 0x0d &&
      fileBuffer[5] === 0x0a &&
      fileBuffer[6] === 0x1a &&
      fileBuffer[7] === 0x0a
    ) {
      return { ext: 'png', mime: 'image/png' };
    }
  }

  if (fileBuffer.length >= 3) {
    // JPEG starts with FF D8 FF
    if (
      fileBuffer[0] === 0xff &&
      fileBuffer[1] === 0xd8 &&
      fileBuffer[2] === 0xff
    ) {
      return { ext: 'jpg', mime: 'image/jpeg' };
    }
  }

  return undefined;
}
