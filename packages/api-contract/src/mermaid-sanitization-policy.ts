export const MERMAID_SANITIZATION_POLICY = {
  forbiddenTags: ['script', 'iframe', 'object', 'embed'],
  uriAttributes: ['href', 'xlink:href', 'src'],
  allowedProtocols: ['http:', 'https:'],
  allowedDataImageMimeTypes: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  rejectProtocolRelative: true,
  stripControlWhitespaceBeforeProtocolCheck: true,
} as const;

export type MermaidSanitizationPolicy = typeof MERMAID_SANITIZATION_POLICY;
