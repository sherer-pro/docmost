const FORBIDDEN_TAGS = new Set(['script', 'iframe', 'object', 'embed']);
const URI_ATTRS = new Set(['href', 'xlink:href', 'src']);

function parseSvgRoot(svg: string): Element | null {
  const parser = new DOMParser();

  const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
  const hasSvgParserError = Boolean(svgDoc.querySelector('parsererror'));
  const svgRoot = svgDoc.documentElement;

  if (!hasSvgParserError && svgRoot?.tagName.toLowerCase() === 'svg') {
    return svgRoot;
  }

  // Fallback to HTML parsing for lenient recovery of older Mermaid output.
  const htmlDoc = parser.parseFromString(svg, 'text/html');
  return htmlDoc.querySelector('svg');
}

function isSafeUrl(value: string): boolean {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return true;
  }

  const lowerValue = normalizedValue.toLowerCase();
  if (
    lowerValue.startsWith('#') ||
    lowerValue.startsWith('/') ||
    lowerValue.startsWith('./') ||
    lowerValue.startsWith('../')
  ) {
    return true;
  }

  if (lowerValue.startsWith('data:image/')) {
    return true;
  }

  try {
    const parsedUrl = new URL(normalizedValue, 'https://docmost.local');
    return ['http:', 'https:', 'blob:'].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

/**
 * Sanitizes Mermaid SVG while keeping `foreignObject` labels intact.
 *
 * The sanitizer removes executable tags and handlers, and strips unsafe URLs.
 * It does not strip safe HTML text nodes inside `foreignObject`.
 */
export function sanitizeMermaidSvg(svg: string): string {
  if (!svg) {
    return '';
  }

  const root = parseSvgRoot(svg);

  if (!root) {
    return '';
  }

  const allElements = [root, ...Array.from(root.querySelectorAll('*'))];

  for (const element of allElements) {
    const tagName = element.tagName.toLowerCase();
    if (FORBIDDEN_TAGS.has(tagName)) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const attrName = attribute.name.toLowerCase();
      const attrValue = attribute.value;

      if (attrName.startsWith('on')) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (attrName === 'style') {
        const hasUnsafeCss =
          /expression\s*\(/i.test(attrValue) || /javascript\s*:/i.test(attrValue);
        if (hasUnsafeCss) {
          element.removeAttribute(attribute.name);
        }
        continue;
      }

      if (URI_ATTRS.has(attrName) && !isSafeUrl(attrValue)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return new XMLSerializer().serializeToString(root);
}
