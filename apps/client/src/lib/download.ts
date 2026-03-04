import { AxiosResponse } from 'axios';
import { saveAs } from 'file-saver';

const DEFAULT_DOWNLOAD_FILE_NAME = 'download';

/**
 * Safely decodes URI component and falls back to the original value on decode errors.
 */
export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Extracts filename from Content-Disposition header value.
 * Supports both `filename=` and RFC 5987 `filename*=` forms.
 */
export function getFileNameFromContentDisposition(
  contentDisposition?: string,
): string | undefined {
  if (!contentDisposition) {
    return undefined;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return safeDecodeURIComponent(utf8Match[1].replace(/"/g, ''));
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) {
    return safeDecodeURIComponent(plainMatch[1].trim().replace(/"/g, ''));
  }

  return undefined;
}

/**
 * Saves a blob response to file using filename from Content-Disposition.
 */
export function downloadBlobFromAxiosResponse(
  response: AxiosResponse<Blob>,
  fallbackFileName: string = DEFAULT_DOWNLOAD_FILE_NAME,
): void {
  const fileName =
    getFileNameFromContentDisposition(response.headers['content-disposition']) ??
    fallbackFileName;

  saveAs(response.data, fileName);
}
