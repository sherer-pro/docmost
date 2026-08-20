import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import {
  RAG_KNOWLEDGE_PROJECTION_VERSION,
  type RagDocumentCustomFields,
} from '@docmost/api-contract';
import { Space } from '@docmost/db/types/entity.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { getPageAiRole } from '../page/utils/page-settings.utils';

export interface KnowledgeDocumentFieldsConfig {
  status: boolean;
  assignee: boolean;
  stakeholders: boolean;
  aiRole: boolean;
}

export interface KnowledgeDatabaseProperty {
  id: string;
  name: string;
  type: string;
  settings?: unknown;
}

export interface KnowledgeDatabaseCell {
  propertyId: string;
  value: unknown;
}

export interface KnowledgeMemberProjection {
  name: string;
  updatedAt: Date;
}

@Injectable()
export class KnowledgeProjectionService {
  readonly version = RAG_KNOWLEDGE_PROJECTION_VERSION;

  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  getDocumentFieldsConfig(space: Space): KnowledgeDocumentFieldsConfig {
    const settings = this.asRecord(space.settings);
    const documentFields = this.asRecord(settings['documentFields']);
    return {
      status: Boolean(documentFields['status']),
      assignee: Boolean(documentFields['assignee']),
      stakeholders: Boolean(documentFields['stakeholders']),
      aiRole: Boolean(documentFields['aiRole']),
    };
  }

  isDictionaryEnabled(space: Space): boolean {
    const settings = this.asRecord(space.settings);
    return Boolean(this.asRecord(settings['dictionary'])['enabled']);
  }

  fingerprintInput(space: Space) {
    return {
      projectionVersion: this.version,
      documentFields: this.getDocumentFieldsConfig(space),
      dictionaryEnabled: this.isDictionaryEnabled(space),
    };
  }

  buildCustomFields(
    settings: unknown,
    config: KnowledgeDocumentFieldsConfig,
  ): RagDocumentCustomFields | undefined {
    const normalized = this.asRecord(settings);
    const fields: RagDocumentCustomFields = {};

    if (config.status) {
      fields.status =
        typeof normalized['status'] === 'string' ? normalized['status'] : null;
    }
    if (config.assignee) {
      fields.assigneeId =
        typeof normalized['assigneeId'] === 'string'
          ? normalized['assigneeId']
          : null;
    }
    if (config.stakeholders) {
      fields.stakeholderIds = Array.isArray(normalized['stakeholderIds'])
        ? normalized['stakeholderIds'].filter(
            (value): value is string =>
              typeof value === 'string' && Boolean(value),
          )
        : [];
    }
    if (config.aiRole) {
      fields.aiRole = getPageAiRole(normalized);
    }

    return Object.keys(fields).length > 0 ? fields : undefined;
  }

  async resolveMemberNames(
    workspaceId: string,
    fieldSets: Array<RagDocumentCustomFields | undefined>,
  ): Promise<Map<string, string>> {
    const members = await this.resolveMembers(workspaceId, fieldSets);
    return new Map([...members].map(([id, member]) => [id, member.name]));
  }

  async resolveMembers(
    workspaceId: string,
    fieldSets: Array<RagDocumentCustomFields | undefined>,
  ): Promise<Map<string, KnowledgeMemberProjection>> {
    const ids = [
      ...new Set(fieldSets.flatMap((fields) => this.memberIds(fields))),
    ];
    if (ids.length === 0) return new Map();

    const users = await this.db
      .selectFrom('users')
      .select(['id', 'name', 'updatedAt'])
      .where('workspaceId', '=', workspaceId)
      .where('id', 'in', ids)
      .execute();
    return new Map(
      users.map((user) => [
        user.id,
        { name: user.name, updatedAt: new Date(user.updatedAt) },
      ]),
    );
  }

  memberNames(
    members: ReadonlyMap<string, KnowledgeMemberProjection>,
  ): Map<string, string> {
    return new Map([...members].map(([id, member]) => [id, member.name]));
  }

  projectionUpdatedAtFromMembers(
    entityUpdatedAt: Date | string,
    fields: RagDocumentCustomFields | undefined,
    members: ReadonlyMap<string, KnowledgeMemberProjection>,
  ): Date {
    return this.memberIds(fields).reduce((latest, id) => {
      const updatedAt = members.get(id)?.updatedAt;
      return updatedAt && updatedAt > latest ? updatedAt : latest;
    }, new Date(entityUpdatedAt));
  }

  async projectionUpdatedAt(
    workspaceId: string,
    entityUpdatedAt: Date | string,
    fields: RagDocumentCustomFields | undefined,
  ): Promise<Date> {
    const ids = this.memberIds(fields);
    if (ids.length === 0) return new Date(entityUpdatedAt);

    const member = await this.db
      .selectFrom('users')
      .select((eb) => eb.fn.max('updatedAt').as('updatedAt'))
      .where('workspaceId', '=', workspaceId)
      .where('id', 'in', ids)
      .executeTakeFirst();
    const memberUpdatedAt = member?.updatedAt
      ? new Date(member.updatedAt)
      : new Date(0);
    const sourceUpdatedAt = new Date(entityUpdatedAt);
    return memberUpdatedAt > sourceUpdatedAt
      ? memberUpdatedAt
      : sourceUpdatedAt;
  }

  renderDocumentFields(
    fields: RagDocumentCustomFields | undefined,
    names: ReadonlyMap<string, string>,
  ): string {
    if (!fields) return '';

    const lines: string[] = [];
    if ('status' in fields)
      lines.push(`- Status: ${fields.status || 'Not set'}`);
    if ('assigneeId' in fields) {
      lines.push(
        `- Assignee: ${this.memberName(fields.assigneeId, names, 'Not set')}`,
      );
    }
    if ('stakeholderIds' in fields) {
      const stakeholders = (fields.stakeholderIds ?? []).map((id) =>
        this.memberName(id, names, 'Not set'),
      );
      lines.push(
        `- Stakeholders: ${stakeholders.length > 0 ? stakeholders.join(', ') : 'None'}`,
      );
    }
    if ('aiRole' in fields) lines.push(`- AI role: ${fields.aiRole ?? 'NONE'}`);
    return lines.length > 0 ? `## Document fields\n\n${lines.join('\n')}` : '';
  }

  renderPageKnowledgeMarkdown(input: {
    title: string | null | undefined;
    contentMarkdown?: string | null;
    customFields?: RagDocumentCustomFields;
    memberNames?: ReadonlyMap<string, string>;
  }): string {
    return [
      `# ${input.title?.trim() || 'Untitled'}`,
      this.renderDocumentFields(
        input.customFields,
        input.memberNames ?? new Map(),
      ),
      input.contentMarkdown?.trim() ?? '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  renderDatabaseSchema(properties: KnowledgeDatabaseProperty[]): string {
    const lines = properties.map((property) => {
      const options = this.propertyOptions(property.settings);
      const suffix =
        options.length > 0 ? `; options: ${options.join(', ')}` : '';
      return `- ${property.name || 'Untitled property'} (${property.type}${suffix})`;
    });
    return lines.length > 0 ? `## Database schema\n\n${lines.join('\n')}` : '';
  }

  renderRowFields(
    properties: KnowledgeDatabaseProperty[],
    cells: KnowledgeDatabaseCell[],
  ): {
    markdown: string;
    cells: Array<
      KnowledgeDatabaseCell & { propertyName: string; propertyType: string }
    >;
  } {
    const values = new Map(cells.map((cell) => [cell.propertyId, cell.value]));
    const namedCells = properties.map((property) => ({
      propertyId: property.id,
      propertyName: property.name || 'Untitled property',
      propertyType: property.type,
      value: values.get(property.id) ?? null,
    }));
    return {
      cells: namedCells,
      markdown:
        namedCells.length > 0
          ? `## Database fields\n\n${namedCells
              .map(
                (cell) =>
                  `- ${cell.propertyName}: ${this.stringifyValue(cell.value) || 'Not set'}`,
              )
              .join('\n')}`
          : '',
    };
  }

  renderDictionaryKnowledgeMarkdown(input: {
    term: string;
    forms: string[];
    definitionMarkdown: string;
  }): string {
    return [
      `# ${input.term}`,
      input.forms.length > 0
        ? `## Word forms\n\n${input.forms.map((form) => `- ${form}`).join('\n')}`
        : '## Word forms\n\nNone',
      `## Definition\n\n${input.definitionMarkdown}`,
    ].join('\n\n');
  }

  async searchDictionaryTerms(input: {
    workspaceId: string;
    spaceId: string;
    query: string;
    limit: number;
  }) {
    const query = input.query
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase();
    if (!query) return [];

    const normalizedQuery = sql<string>`LOWER(f_unaccent(${query}))`;
    const normalizedAlias = sql<string>`LOWER(f_unaccent(alias.normalized_alias))`;
    const normalizedDefinition = sql<string>`LOWER(f_unaccent(term.definition_markdown))`;
    const prefix = `${query}%`;
    const contains = `%${query}%`;
    const result = await sql<{
      id: string;
      term: string;
      definitionMarkdown: string;
      forms: string[];
      aliasScore: number | string;
      score: number | string;
    }>`
      WITH alias_candidates AS (
        SELECT
          term.id,
          term.term,
          term.definition_markdown,
          alias.alias,
          alias.is_primary,
          CASE
            WHEN ${normalizedAlias} = ${normalizedQuery} AND alias.is_primary THEN 1000
            WHEN ${normalizedAlias} = ${normalizedQuery} THEN 900
            WHEN ${normalizedAlias} LIKE LOWER(f_unaccent(${prefix})) AND alias.is_primary THEN 800
            WHEN ${normalizedAlias} LIKE LOWER(f_unaccent(${prefix})) THEN 700
            WHEN ${normalizedAlias} LIKE LOWER(f_unaccent(${contains})) AND alias.is_primary THEN 600
            WHEN ${normalizedAlias} LIKE LOWER(f_unaccent(${contains})) THEN 500
            WHEN ${normalizedAlias} % ${normalizedQuery} AND alias.is_primary
              THEN 400 + similarity(${normalizedAlias}, ${normalizedQuery}) * 100
            WHEN ${normalizedAlias} % ${normalizedQuery}
              THEN 300 + similarity(${normalizedAlias}, ${normalizedQuery}) * 100
            ELSE 0
          END::float8 AS alias_score,
          (${normalizedDefinition} LIKE LOWER(f_unaccent(${contains}))) AS definition_matched
        FROM dictionary_terms AS term
        JOIN dictionary_term_aliases AS alias ON alias.term_id = term.id
        JOIN spaces AS space ON space.id = term.space_id
        WHERE term.workspace_id = ${input.workspaceId}
          AND term.space_id = ${input.spaceId}
          AND term.deleted_at IS NULL
          AND space.workspace_id = ${input.workspaceId}
          AND space.archived_at IS NULL
          AND space.deleted_at IS NULL
          AND COALESCE((space.settings -> 'dictionary' ->> 'enabled')::boolean, false)
          AND (
            ${normalizedAlias} LIKE LOWER(f_unaccent(${contains}))
            OR ${normalizedAlias} % ${normalizedQuery}
            OR ${normalizedDefinition} LIKE LOWER(f_unaccent(${contains}))
          )
      ), ranked_terms AS (
        SELECT DISTINCT ON (candidate.id)
          candidate.*,
          candidate.alias_score +
            CASE WHEN candidate.definition_matched THEN 100 ELSE 0 END AS score
        FROM alias_candidates AS candidate
        ORDER BY
          candidate.id,
          candidate.alias_score DESC,
          candidate.is_primary DESC,
          LOWER(candidate.alias) ASC
      )
      SELECT
        ranked.id,
        ranked.term,
        ranked.definition_markdown AS "definitionMarkdown",
        COALESCE(
          (
            SELECT ARRAY_AGG(form.alias ORDER BY form.alias)
            FROM dictionary_term_aliases AS form
            WHERE form.term_id = ranked.id AND NOT form.is_primary
          ),
          ARRAY[]::text[]
        ) AS forms,
        ranked.alias_score AS "aliasScore",
        ranked.score
      FROM ranked_terms AS ranked
      ORDER BY ranked.score DESC, LOWER(ranked.term) ASC, ranked.id ASC
      LIMIT ${input.limit}
    `.execute(this.db);

    return result.rows.map((row) => ({
      id: row.id,
      term: row.term,
      definitionMarkdown: row.definitionMarkdown,
      forms: row.forms,
      score: Number(row.score),
      exact: Number(row.aliasScore) >= 900,
    }));
  }

  stringifyValue(value: unknown): string {
    if (value === null || typeof value === 'undefined') return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => this.stringifyValue(item))
        .filter(Boolean)
        .join(', ');
    }
    if (typeof value === 'object') {
      const object = this.asRecord(value);
      for (const key of ['name', 'label', 'title', 'value']) {
        if (typeof object[key] === 'string') return object[key];
      }
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private memberIds(fields: RagDocumentCustomFields | undefined): string[] {
    if (!fields) return [];
    return [
      ...(fields.assigneeId ? [fields.assigneeId] : []),
      ...(fields.stakeholderIds ?? []),
    ];
  }

  private memberName(
    id: string | null | undefined,
    names: ReadonlyMap<string, string>,
    empty: string,
  ): string {
    if (!id) return empty;
    return names.get(id) ?? `Unknown member (${id})`;
  }

  private propertyOptions(settings: unknown): string[] {
    const options = this.asRecord(settings)['options'];
    if (!Array.isArray(options)) return [];
    return options
      .map((option) => {
        if (typeof option === 'string') return option;
        const record = this.asRecord(option);
        for (const key of ['name', 'label', 'value']) {
          if (typeof record[key] === 'string') return record[key];
        }
        return '';
      })
      .filter(Boolean);
  }

  private asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object'
      ? (value as Record<string, any>)
      : {};
  }
}
