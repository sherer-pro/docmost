// Decode only the actual captured request structure, including JSON reference frames.
export function providerTextSegments(requests) {
  const result = [];
  const visit = (value, depth = 0) => {
    if (depth > 16 || result.length > 8192)
      throw new Error('Quality transmission observation exceeds its bounds');
    if (typeof value === 'string') {
      let trimmed = value.trim();
      const envelope =
        /^UNTRUSTED_REFERENCE_DATA_JSON\r?\n([\s\S]*?)\r?\nEND_UNTRUSTED_REFERENCE_DATA_JSON(?:\r?\n|$)/.exec(
          trimmed,
        );
      if (envelope) trimmed = envelope[1];
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        let decoded;
        try {
          decoded = JSON.parse(trimmed);
        } catch {
          /* Keep ordinary text as text. */
        }
        if (decoded && typeof decoded === 'object') {
          visit(decoded, depth + 1);
          return;
        }
      }
      result.push(value);
    } else if (Array.isArray(value))
      for (const item of value) visit(item, depth + 1);
    else if (value && typeof value === 'object')
      for (const item of Object.values(value)) visit(item, depth + 1);
  };
  for (const request of requests) {
    const confirmedStatus =
      Number.isInteger(request.status) &&
      request.status >= 200 &&
      request.status < 300;
    // A response-stream failure does not undo confirmed input delivery.
    if (request.transmitted !== true || !confirmedStatus) continue;
    for (const message of request.messages ?? []) visit(message.content);
  }
  return result;
}

export function sourceWasTransmitted(segments, marker, text) {
  return (
    typeof text === 'string' &&
    text.length > 0 &&
    segments.some(
      (segment) => segment.includes(`[${marker}]`) && segment.includes(text),
    )
  );
}
