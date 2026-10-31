function quotedRetrievalNames(value: string): string[] {
  return [
    ...value
      .slice(0, 2000)
      .matchAll(/«([^»]{2,128})»|“([^”]{2,128})”|"([^"\n]{2,128})"/gu),
  ]
    .map((match) =>
      (match[1] ?? match[2] ?? match[3])
        .replace(/[^\p{L}\p{M}\p{N}_ .-]/gu, ' ')
        .trim(),
    )
    .filter((anchor) => anchor.length >= 2)
    .slice(0, 2);
}

/** Reuse one literal topic only for an otherwise unqualified short follow-up. */
export function followUpQuotedName(
  query: string,
  previous: string | undefined,
): string | undefined {
  if (
    !previous ||
    query.length > 512 ||
    quotedRetrievalNames(query).length ||
    !/^(?:а\s|и\s|ещ[её]\s|and\b|also\b|what about\b|how much\b|how about\b)/iu.test(
      query.trim(),
    )
  )
    return undefined;
  if (
    /(?<!\p{L})\p{Lu}[\p{L}\p{N}_-]{2,}/u.test(
      query.trim().replace(/^\S+\s*/u, ''),
    )
  )
    return undefined;
  const names = quotedRetrievalNames(previous);
  return names.length === 1 ? names[0] : undefined;
}

/** Bound local query fan-out while retaining literal names in user questions. */
export function localRetrievalQueries(
  query: string,
  additional: string[] = [],
): string[] {
  const bases = [query, ...additional.slice(0, 2)]
    .map((value) => value.trim().slice(0, 512))
    .filter(Boolean);
  const anchors = bases.flatMap(quotedRetrievalNames).slice(0, 2);
  return [
    ...new Set(
      [bases[0], ...bases.slice(1, 2), ...anchors, ...bases.slice(2)].filter(
        Boolean,
      ),
    ),
  ].slice(0, 3);
}
