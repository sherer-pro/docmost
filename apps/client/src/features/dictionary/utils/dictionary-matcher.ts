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
  pattern: RegExp;
  length: number;
}

const WORD_BOUNDARY_SOURCE = "\\p{L}\\p{N}_";

export function normalizeDictionaryAlias(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createAliasPattern(alias: string): RegExp {
  const escapedPhrase = normalizeDictionaryAlias(alias)
    .split(/\s+/)
    .map(escapeRegex)
    .join("\\s+");

  return new RegExp(
    `(?<![${WORD_BOUNDARY_SOURCE}])${escapedPhrase}(?![${WORD_BOUNDARY_SOURCE}])`,
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
        pattern: createAliasPattern(normalizedAlias),
        length: normalizedAlias.length,
      });
    });
  });

  return candidates.sort((a, b) => b.length - a.length);
}

function overlaps(left: DictionaryMatch, right: DictionaryMatch): boolean {
  return left.from < right.to && right.from < left.to;
}

export function findDictionaryMatches(
  text: string,
  terms: IDictionaryTerm[],
): DictionaryMatch[] {
  if (!text || terms.length === 0) {
    return [];
  }

  const matches: DictionaryMatch[] = [];

  buildAliasCandidates(terms).forEach((candidate) => {
    candidate.pattern.lastIndex = 0;
    Array.from(text.matchAll(candidate.pattern)).forEach((match) => {
      if (typeof match.index !== "number" || !match[0]?.trim()) {
        return;
      }

      matches.push({
        from: match.index,
        to: match.index + match[0].length,
        term: candidate.term,
        alias: candidate.alias,
        matchedText: match[0],
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
