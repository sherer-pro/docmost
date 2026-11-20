import { BadRequestException } from '@nestjs/common';
import { DOMParser } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import {
  MCP_IMAGE_MAX_BYTES,
  MCP_MODEL_MAX_BYTES,
} from '../../common/config/mcp-body-limit';

export const DRAWIO_FILE_NAME = 'diagram.drawio.svg';

function invalid(message: string): never {
  throw new BadRequestException(message);
}

function decode(value: string, limit: number) {
  const data = Buffer.from(value, 'base64');
  if (!data.length || data.length > limit || data.toString('base64') !== value)
    invalid('Invalid diagram size or base64 encoding');
  return data;
}

function pngDimensions(data: Buffer) {
  if (
    data.length < 45 ||
    data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    data.readUInt32BE(8) !== 13 ||
    data.toString('ascii', 12, 16) !== 'IHDR'
  )
    invalid('Expected a PNG preview');
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (!width || !height || width * height > 32_000_000)
    invalid('Invalid PNG dimensions');
  let hasPixels = false;
  for (let offset = 8; offset + 12 <= data.length; ) {
    const length = data.readUInt32BE(offset);
    const end = offset + 8 + length;
    if (
      end + 4 > data.length ||
      crc32(data.subarray(offset + 4, end)) !== data.readUInt32BE(end)
    )
      invalid('Invalid PNG chunk');
    const kind = data.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT' && length) hasPixels = true;
    if (kind === 'IEND' && !length && hasPixels && end + 4 === data.length)
      return { width, height };
    offset = end + 4;
  }
  return invalid('Incomplete PNG preview');
}

export function makeDrawioSvg(input: {
  modelBase64: string;
  modelSha256: string;
  pngBase64: string;
}) {
  const model = decode(input.modelBase64, MCP_MODEL_MAX_BYTES);
  if (createHash('sha256').update(model).digest('hex') !== input.modelSha256)
    invalid('The Draw.io model checksum differs');
  const xml = model.toString('utf8');
  if (!Buffer.from(xml).equals(model) || /<!DOCTYPE|<!ENTITY/i.test(xml))
    invalid('Expected UTF-8 diagram XML without a DTD');
  const failXml = () => invalid('Invalid Draw.io XML');
  const root = new DOMParser({
    errorHandler: { warning: failXml, error: failXml, fatalError: failXml },
  }).parseFromString(xml, 'application/xml').documentElement;
  if (!root || root.tagName !== 'mxfile') invalid('Expected a Draw.io mxfile');
  const children = (el: Element) =>
    Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);
  const sheets = children(root);
  if (
    !sheets.length ||
    !sheets.every((sheet) => {
      const models = children(sheet);
      return (
        sheet.tagName === 'diagram' &&
        models.length === 1 &&
        models[0].tagName === 'mxGraphModel' &&
        children(models[0]).some((child) => child.tagName === 'root')
      );
    })
  )
    invalid('Expected an uncompressed mxfile with a graph on every sheet');
  const png = decode(input.pngBase64, MCP_IMAGE_MAX_BYTES);
  const { width, height } = pngDimensions(png);
  // Draw.io detects raw XML by its first character. Its alternative percent
  // encoding preserves a leading BOM or whitespace in the reviewed bytes.
  const embedded = xml.startsWith('<') ? xml : encodeURIComponent(xml);
  const content = embedded
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;')
    .replace(/\t/g, '&#9;');
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" content="${content}"><image width="${width}" height="${height}" xlink:href="data:image/png;base64,${input.pngBase64}"/></svg>`,
  );
  return {
    svg,
    modelBytes: model.length,
    sheets: sheets.length,
    svgSha256: createHash('sha256').update(svg).digest('hex'),
  };
}
