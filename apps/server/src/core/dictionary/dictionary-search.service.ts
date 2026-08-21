import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PageAccessService } from '../page-access/page-access.service';
import type { DictionarySearchDTO } from '../search/dto/search.dto';
import type {
  DictionarySearchMatchedField,
  DictionarySearchResponseDto,
  SearchTagMatchDto,
} from '../search/dto/search-response.dto';

const DEFAULT_SEARCH_LIMIT = 25;
const MAX_FETCH_BATCH = 100;
const DICTIONARY_MATCH_RANK = {
  exactTerm: 1000,
  exactForm: 900,
  prefixTerm: 800,
  prefixForm: 700,
  fuzzyTerm: 400,
  fuzzyForm: 300,
  definition: 100,
} as const;

interface DictionarySearchRow {
  id: string;
  term: string;
  definitionMarkdown: string;
  forms: string[];
  matchedAlias: string;
  matchedAliasIsPrimary: boolean;
  aliasScore: number | string;
  definitionMatched: boolean;
  score: number | string;
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  spaceIcon: string | null;
}

@Injectable()
export class DictionarySearchService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly userRepo: UserRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pageAccessService: PageAccessService,
  ) {}

  async search(
    searchParams: DictionarySearchDTO,
    opts: {
      userId: string;
      workspaceId: string;
      candidateIds?: string[];
    },
  ): Promise<{ items: DictionarySearchResponseDto[] }> {
    const normalized = normalizeDictionarySearchText(searchParams.query);
    if (!normalized) return { items: [] };

    const user = await this.userRepo.findById(opts.userId, opts.workspaceId);
    if (!user) return { items: [] };
    const spaces = await this.db
      .selectFrom('spaces')
      .select('id')
      .where('workspaceId', '=', opts.workspaceId)
      .where('archivedAt', 'is', null)
      .where('deletedAt', 'is', null)
      .where(
        sql<boolean>`COALESCE((settings -> 'dictionary' ->> 'enabled')::boolean, false)`,
        '=',
        true,
      )
      .where('id', 'in', this.spaceMemberRepo.getUserSpaceIdsQuery(opts.userId))
      .$if(Boolean(searchParams.spaceId), (query) =>
        query.where('id', '=', searchParams.spaceId!),
      )
      .execute();
    const accessibleSpaceIds = spaces.map((space) => space.id);
    if (accessibleSpaceIds.length === 0) return { items: [] };

    const limit = searchParams.limit ?? DEFAULT_SEARCH_LIMIT;
    let readableRowsToSkip = searchParams.offset ?? 0;
    let rawOffset = 0;
    const items: DictionarySearchResponseDto[] = [];
    const readableSpaces = new Map<string, boolean>();

    while (items.length < limit) {
      const rows = await this.queryRows({
        query: normalized,
        workspaceId: opts.workspaceId,
        accessibleSpaceIds,
        candidateIds: opts.candidateIds,
        limit: Math.min(MAX_FETCH_BATCH, Math.max(limit * 3, limit)),
        offset: rawOffset,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        let canRead = readableSpaces.get(row.spaceId);
        if (typeof canRead === 'undefined') {
          canRead = await this.pageAccessService.hasAnyReadablePageInSpace(
            user,
            row.spaceId,
          );
          readableSpaces.set(row.spaceId, canRead);
        }
        if (!canRead) continue;
        if (readableRowsToSkip > 0) {
          readableRowsToSkip -= 1;
          continue;
        }
        items.push(this.toResponse(row, normalized));
        if (items.length >= limit) break;
      }

      rawOffset += rows.length;
      if (rows.length < Math.min(MAX_FETCH_BATCH, Math.max(limit * 3, limit))) {
        break;
      }
    }

    return { items };
  }

  async searchKnowledge(input: {
    workspaceId: string;
    spaceId: string;
    query: string;
    limit: number;
  }) {
    const normalized = normalizeDictionarySearchText(input.query);
    if (!normalized) return [];
    const rows = await this.queryRows({
      query: normalized,
      workspaceId: input.workspaceId,
      accessibleSpaceIds: [input.spaceId],
      limit: input.limit,
      offset: 0,
    });
    return rows.map((row) => ({
      id: row.id,
      term: row.term,
      definitionMarkdown: row.definitionMarkdown,
      forms: row.forms,
      score: Number(row.score),
      exact: Number(row.aliasScore) >= DICTIONARY_MATCH_RANK.exactForm,
    }));
  }

  private async queryRows(input: {
    query: string;
    workspaceId: string;
    accessibleSpaceIds: string[];
    candidateIds?: string[];
    limit: number;
    offset: number;
  }): Promise<DictionarySearchRow[]> {
    if (input.candidateIds && input.candidateIds.length === 0) return [];
    const normalizedSql = sql<string>`LOWER(f_unaccent(${input.query}))`;
    const aliasSql = sql<string>`LOWER(f_unaccent(alias.normalized_alias))`;
    const definitionSql = sql<string>`LOWER(f_unaccent(term.definition_markdown))`;
    const prefix = `${input.query}%`;
    const contains = `%${input.query}%`;
    const candidateFilter = input.candidateIds
      ? sql`AND term.id IN (${sql.join(input.candidateIds)})`
      : sql``;
    const spaceFilter = sql`AND term.space_id IN (${sql.join(
      input.accessibleSpaceIds,
    )})`;

    const result = await sql<DictionarySearchRow>`
      WITH alias_candidates AS (
        SELECT
          term.id,
          term.term,
          term.definition_markdown,
          term.space_id,
          alias.alias AS matched_alias,
          alias.is_primary AS matched_alias_is_primary,
          CASE
            WHEN ${aliasSql} = ${normalizedSql} AND alias.is_primary THEN ${DICTIONARY_MATCH_RANK.exactTerm}
            WHEN ${aliasSql} = ${normalizedSql} THEN ${DICTIONARY_MATCH_RANK.exactForm}
            WHEN ${aliasSql} LIKE LOWER(f_unaccent(${prefix})) AND alias.is_primary THEN ${DICTIONARY_MATCH_RANK.prefixTerm}
            WHEN ${aliasSql} LIKE LOWER(f_unaccent(${prefix})) THEN ${DICTIONARY_MATCH_RANK.prefixForm}
            WHEN ${aliasSql} % ${normalizedSql} AND alias.is_primary
              THEN ${DICTIONARY_MATCH_RANK.fuzzyTerm} + similarity(${aliasSql}, ${normalizedSql}) * 100
            WHEN ${aliasSql} % ${normalizedSql}
              THEN ${DICTIONARY_MATCH_RANK.fuzzyForm} + similarity(${aliasSql}, ${normalizedSql}) * 100
            ELSE 0
          END::float8 AS alias_score,
          (${definitionSql} LIKE LOWER(f_unaccent(${contains}))) AS definition_matched
        FROM dictionary_terms AS term
        JOIN dictionary_term_aliases AS alias ON alias.term_id = term.id
        JOIN spaces AS space ON space.id = term.space_id
        WHERE term.workspace_id = ${input.workspaceId}
          AND term.deleted_at IS NULL
          AND space.workspace_id = ${input.workspaceId}
          AND space.archived_at IS NULL
          AND space.deleted_at IS NULL
          AND COALESCE((space.settings -> 'dictionary' ->> 'enabled')::boolean, false)
          ${spaceFilter}
          ${candidateFilter}
          AND (
            ${aliasSql} LIKE LOWER(f_unaccent(${prefix}))
            OR ${aliasSql} % ${normalizedSql}
            OR ${definitionSql} LIKE LOWER(f_unaccent(${contains}))
          )
      ), ranked_terms AS (
        SELECT DISTINCT ON (candidate.id)
          candidate.*,
          candidate.alias_score +
            CASE WHEN candidate.definition_matched THEN ${DICTIONARY_MATCH_RANK.definition} ELSE 0 END AS score
        FROM alias_candidates AS candidate
        ORDER BY
          candidate.id,
          candidate.alias_score DESC,
          candidate.matched_alias_is_primary DESC,
          LOWER(candidate.matched_alias) ASC
      )
      SELECT
        ranked.id,
        ranked.term,
        ranked.definition_markdown AS "definitionMarkdown",
        COALESCE(
          (
            SELECT ARRAY_AGG(form_alias.alias ORDER BY form_alias.alias)
            FROM dictionary_term_aliases AS form_alias
            WHERE form_alias.term_id = ranked.id
              AND NOT form_alias.is_primary
          ),
          ARRAY[]::text[]
        ) AS forms,
        ranked.matched_alias AS "matchedAlias",
        ranked.matched_alias_is_primary AS "matchedAliasIsPrimary",
        ranked.alias_score AS "aliasScore",
        ranked.definition_matched AS "definitionMatched",
        ranked.score,
        space.id AS "spaceId",
        space.name AS "spaceName",
        space.slug AS "spaceSlug",
        space.logo AS "spaceIcon"
      FROM ranked_terms AS ranked
      JOIN spaces AS space ON space.id = ranked.space_id
      ORDER BY ranked.score DESC, LOWER(ranked.term) ASC, ranked.id ASC
      LIMIT ${input.limit}
      OFFSET ${input.offset}
    `.execute(this.db);
    return result.rows;
  }

  private toResponse(
    row: DictionarySearchRow,
    query: string,
  ): DictionarySearchResponseDto {
    const aliasScore = Number(row.aliasScore);
    const matchedField: DictionarySearchMatchedField =
      aliasScore <= 0 && row.definitionMatched
        ? 'definition'
        : row.matchedAliasIsPrimary
          ? 'term'
          : 'form';
    const snippetSource =
      matchedField === 'definition'
        ? stripMarkdown(row.definitionMarkdown)
        : row.matchedAlias;

    return {
      id: row.id,
      term: row.term,
      matchedField,
      ...(matchedField === 'form' ? { matchedForm: row.matchedAlias } : {}),
      snippet: buildDictionarySearchSnippet(snippetSource, query),
      definitionSnippet: buildDictionaryDefinitionSnippet(
        row.definitionMarkdown,
        query,
      ),
      rank: Number(row.score),
      space: {
        id: row.spaceId,
        name: row.spaceName,
        slug: row.spaceSlug,
        icon: row.spaceIcon,
      },
    };
  }
}

function normalizeDictionarySearchText(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

export function buildDictionarySearchSnippet(
  rawValue: string,
  rawQuery: string,
): { text: string; matches: SearchTagMatchDto[] } {
  const value = rawValue.replace(/\s+/g, ' ').trim();
  if (!value) return { text: '', matches: [] };
  const match = findNormalizedMatch(value, rawQuery);
  if (!match) return { text: value.slice(0, 180), matches: [] };
  const start = Math.max(0, match.start - 80);
  const end = Math.min(value.length, match.end + 80);
  const text = `${start > 0 ? '…' : ''}${value.slice(start, end)}${
    end < value.length ? '…' : ''
  }`;
  const prefixLength = start > 0 ? 1 : 0;
  return {
    text,
    matches: [
      {
        start: prefixLength + match.start - start,
        end: prefixLength + match.end - start,
        value: value.slice(match.start, match.end),
      },
    ],
  };
}

export function buildDictionaryDefinitionSnippet(
  definitionMarkdown: string,
  query: string,
): { text: string; matches: SearchTagMatchDto[] } {
  return buildDictionarySearchSnippet(stripMarkdown(definitionMarkdown), query);
}

function findNormalizedMatch(
  value: string,
  query: string,
): { start: number; end: number } | null {
  const normalizedQuery = unaccent(query).trim();
  if (!normalizedQuery) return null;
  const candidates = [
    normalizedQuery,
    ...normalizedQuery.split(/\s+/).filter(Boolean),
  ];
  const normalizedCharacters: string[] = [];
  const originalOffsets: number[] = [];
  let originalOffset = 0;
  for (const character of value) {
    const normalizedCharacter = unaccent(character);
    for (const part of normalizedCharacter) {
      normalizedCharacters.push(part);
      originalOffsets.push(originalOffset);
    }
    originalOffset += character.length;
  }
  const normalizedValue = normalizedCharacters.join('');

  let bestIndex = -1;
  let bestLength = 0;
  for (const candidate of candidates) {
    const index = normalizedValue.indexOf(candidate);
    if (index >= 0 && (bestIndex < 0 || index < bestIndex)) {
      bestIndex = index;
      bestLength = candidate.length;
    }
  }
  if (bestIndex < 0) return null;
  const start = originalOffsets[bestIndex] ?? 0;
  const lastOffset = originalOffsets[bestIndex + bestLength - 1] ?? start;
  const end = lastOffset + (value.codePointAt(lastOffset)! > 0xffff ? 2 : 1);
  return { start, end };
}

function unaccent(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[>*_~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function rankDictionaryCandidate(input: {
  query: string;
  term: string;
  forms?: string[];
  definition?: string;
}): {
  score: number;
  matchedField: DictionarySearchMatchedField;
  matchedForm?: string;
} | null {
  const query = unaccent(input.query).trim();
  if (!query) return null;
  const aliases = [
    { value: input.term, primary: true },
    ...(input.forms ?? []).map((value) => ({ value, primary: false })),
  ];
  let best: { value: string; primary: boolean; score: number } | null = null;
  for (const alias of aliases) {
    const value = unaccent(alias.value).trim();
    let score = 0;
    if (value === query) {
      score = alias.primary
        ? DICTIONARY_MATCH_RANK.exactTerm
        : DICTIONARY_MATCH_RANK.exactForm;
    } else if (value.startsWith(query)) {
      score = alias.primary
        ? DICTIONARY_MATCH_RANK.prefixTerm
        : DICTIONARY_MATCH_RANK.prefixForm;
    } else {
      const similarity = trigramSimilarity(value, query);
      if (similarity >= 0.3) {
        score =
          (alias.primary
            ? DICTIONARY_MATCH_RANK.fuzzyTerm
            : DICTIONARY_MATCH_RANK.fuzzyForm) +
          similarity * 100;
      }
    }
    if (!best || score > best.score) best = { ...alias, score };
  }
  const definitionMatched = unaccent(input.definition ?? '').includes(query);
  const aliasScore = best?.score ?? 0;
  if (aliasScore <= 0 && !definitionMatched) return null;
  if (aliasScore <= 0) {
    return {
      score: DICTIONARY_MATCH_RANK.definition,
      matchedField: 'definition',
    };
  }
  return {
    score:
      aliasScore + (definitionMatched ? DICTIONARY_MATCH_RANK.definition : 0),
    matchedField: best!.primary ? 'term' : 'form',
    ...(best!.primary ? {} : { matchedForm: best!.value }),
  };
}

function trigramSimilarity(left: string, right: string): number {
  const trigrams = (value: string) => {
    const padded = `  ${value} `;
    const result = new Set<string>();
    for (let index = 0; index <= padded.length - 3; index += 1) {
      result.add(padded.slice(index, index + 3));
    }
    return result;
  };
  const leftTrigrams = trigrams(left);
  const rightTrigrams = trigrams(right);
  let common = 0;
  leftTrigrams.forEach((value) => {
    if (rightTrigrams.has(value)) common += 1;
  });
  return (2 * common) / (leftTrigrams.size + rightTrigrams.size || 1);
}
