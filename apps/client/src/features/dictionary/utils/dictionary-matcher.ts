import { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";

export interface DictionaryMatch {
  from: number;
  to: number;
  term: IDictionaryTerm;
  alias: string;
  matchedText: string;
}

interface DictionaryAliasCandidate {
  term: IDictionaryTerm;
  alias: string;
  length: number;
}

export interface DictionaryMatcherIndex {
  patterns: RegExp[];
  aliasesByLookup: Map<string, DictionaryAliasCandidate>;
}

const WORD_BOUNDARY_SOURCE = "\\p{L}\\p{N}\\p{M}_";
const ALIAS_PATTERN_CHUNK_SIZE = 500;
const DICTIONARY_GRAPHEME_SEGMENTER = (Intl as any).Segmenter
  ? new (Intl as any).Segmenter(undefined, { granularity: "grapheme" })
  : null;

interface NormalizedDictionaryText {
  value: string;
  originalStarts: number[];
  originalEnds: number[];
}

function normalizeDictionaryAlias(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizeDictionaryText(value: string): NormalizedDictionaryText {
  const segments: Array<{ segment: string; index: number }> =
    DICTIONARY_GRAPHEME_SEGMENTER
      ? Array.from(DICTIONARY_GRAPHEME_SEGMENTER.segment(value))
      : Array.from(value.matchAll(/\P{M}\p{M}*|\p{M}+/gu), (match) => ({
          segment: match[0],
          index: match.index,
        }));
  const normalizedParts: string[] = [];
  const originalStarts: number[] = [];
  const originalEnds: number[] = [];

  segments.forEach(({ segment, index }) => {
    const normalizedSegment = segment.normalize("NFKC");
    const originalEnd = index + segment.length;

    normalizedParts.push(normalizedSegment);
    for (let offset = 0; offset < normalizedSegment.length; offset += 1) {
      originalStarts.push(index);
      originalEnds.push(originalEnd);
    }
  });

  return {
    value: normalizedParts.join(""),
    originalStarts,
    originalEnds,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createCombinedAliasPattern(aliases: string[]): RegExp {
  const source = aliases
    .map((alias) =>
      normalizeDictionaryAlias(alias)
        .split(/\s+/)
        .map(escapeRegex)
        .join("\\s+"),
    )
    .join("|");

  return new RegExp(
    `(?<![${WORD_BOUNDARY_SOURCE}])(?:${source})(?![${WORD_BOUNDARY_SOURCE}])`,
    "giu",
  );
}

function buildAliasCandidates(
  terms: IDictionaryTerm[],
): DictionaryAliasCandidate[] {
  const candidates: DictionaryAliasCandidate[] = [];

  terms.forEach((term) => {
    const aliases = [term.term, ...(term.forms ?? [])];
    const seen = new Set<string>();

    aliases.forEach((alias) => {
      const normalizedAlias = normalizeDictionaryAlias(alias);
      const lookupAlias = normalizedAlias.toLocaleLowerCase();

      if (!normalizedAlias || seen.has(lookupAlias)) {
        return;
      }

      seen.add(lookupAlias);
      candidates.push({
        term,
        alias: normalizedAlias,
        length: normalizedAlias.length,
      });
    });
  });

  return candidates.sort((a, b) => b.length - a.length);
}

export function createDictionaryMatcherIndex(
  terms: IDictionaryTerm[],
): DictionaryMatcherIndex {
  const aliasesByLookup = new Map<string, DictionaryAliasCandidate>();
  const candidates = buildAliasCandidates(terms);

  candidates.forEach((candidate) => {
    const lookupAlias = normalizeDictionaryAlias(
      candidate.alias,
    ).toLocaleLowerCase();

    if (!aliasesByLookup.has(lookupAlias)) {
      aliasesByLookup.set(lookupAlias, candidate);
    }
  });

  const patterns: RegExp[] = [];
  for (
    let index = 0;
    index < candidates.length;
    index += ALIAS_PATTERN_CHUNK_SIZE
  ) {
    patterns.push(
      createCombinedAliasPattern(
        candidates
          .slice(index, index + ALIAS_PATTERN_CHUNK_SIZE)
          .map((candidate) => candidate.alias),
      ),
    );
  }

  return {
    patterns,
    aliasesByLookup,
  };
}

function overlaps(left: DictionaryMatch, right: DictionaryMatch): boolean {
  return left.from < right.to && right.from < left.to;
}

export function findDictionaryMatches(
  text: string,
  indexOrTerms: DictionaryMatcherIndex | IDictionaryTerm[],
): DictionaryMatch[] {
  const matcherIndex = Array.isArray(indexOrTerms)
    ? createDictionaryMatcherIndex(indexOrTerms)
    : indexOrTerms;

  if (!text || matcherIndex.patterns.length === 0) {
    return [];
  }

  const matches: DictionaryMatch[] = [];
  const normalizedText = normalizeDictionaryText(text);

  matcherIndex.patterns.forEach((pattern) => {
    pattern.lastIndex = 0;
    Array.from(normalizedText.value.matchAll(pattern)).forEach((match) => {
      if (typeof match.index !== "number" || !match[0]?.trim()) {
        return;
      }

      const candidate = matcherIndex.aliasesByLookup.get(
        normalizeDictionaryAlias(match[0]).toLocaleLowerCase(),
      );

      if (!candidate) {
        return;
      }

      const normalizedFrom = match.index;
      const normalizedTo = match.index + match[0].length;
      const from = normalizedText.originalStarts[normalizedFrom];
      const to = normalizedText.originalEnds[normalizedTo - 1];

      if (typeof from !== "number" || typeof to !== "number") {
        return;
      }

      matches.push({
        from,
        to,
        term: candidate.term,
        alias: candidate.alias,
        matchedText: text.slice(from, to),
      });
    });
  });

  return matches
    .sort((a, b) => {
      if (a.from !== b.from) {
        return a.from - b.from;
      }

      return b.to - b.from - (a.to - a.from);
    })
    .reduce<DictionaryMatch[]>((acc, match) => {
      if (acc.some((acceptedMatch) => overlaps(acceptedMatch, match))) {
        return acc;
      }

      acc.push(match);
      return acc;
    }, []);
}
