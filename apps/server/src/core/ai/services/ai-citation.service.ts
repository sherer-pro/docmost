import { Injectable } from '@nestjs/common';
import { AiCitationCandidate } from '../ai.types';

export const AI_CITATION_CANDIDATE_LIMIT = 512;

type CitationState = 'cited' | 'context';

@Injectable()
export class AiCitationService {
  neutralizeUntrustedMarkers(value: string): string {
    return value.replace(
      /\[(S\d+|C\d+)\]/g,
      (_match, marker: string) => `〔${marker}〕`,
    );
  }

  neutralizeUntrustedValue(value: unknown): unknown {
    if (typeof value === 'string')
      return this.neutralizeUntrustedMarkers(value);
    if (Array.isArray(value)) {
      return value.map((item) => this.neutralizeUntrustedValue(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          this.neutralizeUntrustedMarkers(key),
          this.neutralizeUntrustedValue(item),
        ]),
      );
    }
    return value;
  }

  register(
    candidates: AiCitationCandidate[],
    source: Omit<AiCitationCandidate, 'marker'>,
    preferredMarker?: string,
  ): AiCitationCandidate | null {
    const existing = candidates.find(
      (candidate) => candidate.candidateKey === source.candidateKey,
    );
    if (existing) return existing;
    if (candidates.length >= AI_CITATION_CANDIDATE_LIMIT) return null;
    const usedMarkers = new Set(
      candidates.map((candidate) => candidate.marker),
    );
    let marker =
      preferredMarker &&
      /^S\d+$/.test(preferredMarker) &&
      !usedMarkers.has(preferredMarker)
        ? preferredMarker
        : '';
    for (let index = 1; !marker; index += 1) {
      const next = `S${index}`;
      if (!usedMarkers.has(next)) marker = next;
    }
    const candidate = { ...source, marker };
    candidates.push(candidate);
    return candidate;
  }

  finalize(
    content: string,
    candidates: AiCitationCandidate[],
  ): {
    content: string;
    sources: Array<
      AiCitationCandidate & {
        citationKey: string | null;
        citationState: CitationState;
        displayPosition: number;
      }
    >;
  } {
    const byMarker = new Map(
      candidates.map((candidate) => [candidate.marker, candidate] as const),
    );
    const cited = new Map<string, string>();
    let nextCitation = 1;
    const normalized = this.replaceOutsideCode(content, (marker) => {
      if (!byMarker.has(marker)) return '';
      let citationKey = cited.get(marker);
      if (!citationKey) {
        citationKey = `C${nextCitation++}`;
        cited.set(marker, citationKey);
      }
      return `[${citationKey}]`;
    });

    if (cited.size > 0) {
      const sources = [...cited.entries()].map(
        ([marker, citationKey], displayPosition) => ({
          ...byMarker.get(marker)!,
          citationKey,
          citationState: 'cited' as const,
          displayPosition,
        }),
      );
      return { content: normalized, sources };
    }

    const roots = new Map<string, AiCitationCandidate>();
    for (const candidate of candidates) {
      if (candidate.root && !roots.has(candidate.candidateKey)) {
        roots.set(candidate.candidateKey, candidate);
      }
    }
    return {
      content: normalized,
      sources: [...roots.values()].map((candidate, displayPosition) => ({
        ...candidate,
        citationKey: null,
        citationState: 'context' as const,
        displayPosition,
      })),
    };
  }

  stripHistoricalMarkers(content: string): string {
    return this.replaceOutsideCode(content, () => '');
  }

  private replaceOutsideCode(
    content: string,
    replace: (marker: string) => string,
  ): string {
    let result = '';
    let fence: { character: string; length: number } | null = null;
    for (const match of content.matchAll(/.*(?:\r?\n|$)/g)) {
      const line = match[0];
      if (!line) continue;
      const body = line.replace(/\r?\n$/, '');
      const fenceMatch = body.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        result += line;
        if (
          fenceMatch &&
          fenceMatch[1][0] === fence.character &&
          fenceMatch[1].length >= fence.length &&
          /^\s*$/.test(body.slice(fenceMatch[0].length))
        ) {
          fence = null;
        }
        continue;
      }
      if (fenceMatch) {
        fence = {
          character: fenceMatch[1][0],
          length: fenceMatch[1].length,
        };
        result += line;
        continue;
      }
      result += this.replaceOutsideInlineCode(line, replace);
    }
    return result;
  }

  private replaceOutsideInlineCode(
    value: string,
    replace: (marker: string) => string,
  ): string {
    let result = '';
    let cursor = 0;
    while (cursor < value.length) {
      if (value[cursor] === '`') {
        let end = cursor + 1;
        while (value[end] === '`') end += 1;
        const delimiter = '`'.repeat(end - cursor);
        const closing = value.indexOf(delimiter, end);
        if (closing >= 0) {
          result += value.slice(cursor, closing + delimiter.length);
          cursor = closing + delimiter.length;
          continue;
        }
      }
      const marker = value.slice(cursor).match(/^\[(S\d+|C\d+)\]/);
      if (marker) {
        result += replace(marker[1]);
        cursor += marker[0].length;
        continue;
      }
      result += value[cursor];
      cursor += 1;
    }
    return result;
  }
}
