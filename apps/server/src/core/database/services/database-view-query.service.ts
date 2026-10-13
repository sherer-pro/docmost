import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { RawBuilder, sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { DatabaseRowRepo } from '@docmost/db/repos/database/database-row.repo';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import {
  getDatabaseViewPropertyIds,
  normalizeDatabaseViewState,
  normalizeDatabaseValue,
  type DatabaseCalculation,
  type DatabaseFilterGroup,
  type DatabaseFilterRule,
  type DatabaseSummary,
  type DatabaseViewState,
} from '@docmost/api-contract';

interface Property {
  id: string;
  type: string | null;
  settings?: any;
}
export interface DatabaseViewQueryInput {
  databaseId: string;
  workspaceId: string;
  spaceId: string;
  readablePageIds: string[];
  properties: Property[];
  state: DatabaseViewState;
  groupKey?: string;
}

@Injectable()
export class DatabaseViewQueryService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly rows: DatabaseRowRepo,
  ) {}

  validateState(input: unknown, properties: Property[]): DatabaseViewState {
    let state: DatabaseViewState;
    try {
      state = normalizeDatabaseViewState(input);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid database input',
      );
    }
    const byId = new Map(properties.map((property) => [property.id, property]));
    if (getDatabaseViewPropertyIds(state).some((id) => !byId.has(id)))
      throw new BadRequestException('Unknown database property');
    if (
      state.groupBy &&
      !['select', 'multi_select', 'checkbox', 'user'].includes(
        byId.get(state.groupBy)?.type,
      )
    )
      throw new BadRequestException('Invalid grouping property');
    for (const [id, calculation] of Object.entries(state.calculations)) {
      const type = byId.get(id)?.type;
      if (
        (['sum', 'average', 'min', 'max'].includes(calculation) &&
          type !== 'number') ||
        (['earliest', 'latest'].includes(calculation) && type !== 'date')
      )
        throw new BadRequestException('Invalid calculation');
    }
    return state;
  }

  private rawValue(propertyId: string): RawBuilder<any> {
    return sql.ref(`${this.cellAlias(propertyId)}.currentValue`);
  }

  private cellAlias(propertyId: string): string {
    return `view_cell_${propertyId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  private value(id: string, input: DatabaseViewQueryInput): RawBuilder<any> {
    if (id === 'title')
      return sql`lower(coalesce(${sql.ref('pages.title')}, '')) collate "C"`;
    const property = input.properties.find((property) => property.id === id);
    const raw = this.rawValue(id);
    const text = sql`case when jsonb_typeof(${raw}) = 'string' then ${raw} #>> '{}' when jsonb_typeof(${raw}) = 'object' then coalesce(${raw}->>'id', ${raw}->>'value', ${raw}->>'name') else ${raw}::text end`;
    if (property?.type === 'number')
      return sql`case when jsonb_typeof(${raw}) = 'number' then (${raw} #>> '{}')::numeric else null end`;
    if (property?.type === 'date')
      return sql`coalesce(${raw}->>'start', case when jsonb_typeof(${raw}) = 'string' then ${raw} #>> '{}' end)`;
    if (property?.type === 'user')
      return sql`coalesce((select lower(u.name) from users u where u.id::text = (${text}) and u.workspace_id = ${input.workspaceId}), lower(${text})) collate "C"`;
    if (property?.type === 'page_reference')
      return sql`coalesce((select lower(p.title) from pages p where p.id::text = (${text}) and p.id = any(${input.readablePageIds}::uuid[]) and p.workspace_id = ${input.workspaceId} and p.deleted_at is null), lower(${text})) collate "C"`;
    if (property?.type === 'select') {
      const options = property.settings?.options ?? [];
      let label: RawBuilder<any> = text;
      for (const option of [...options].reverse())
        label = sql`case when (${text}) = ${option.value} then ${option.label} else ${label} end`;
      return sql`lower(${label}) collate "C"`;
    }
    return sql`lower(${text}) collate "C"`;
  }

  private empty(id: string): RawBuilder<boolean> {
    const raw = this.rawValue(id);
    return sql`(${raw} is null or ${raw} = 'null'::jsonb or ${raw} = '""'::jsonb or ${raw} = '[]'::jsonb)`;
  }

  private condition(
    rule: DatabaseFilterRule,
    input: DatabaseViewQueryInput,
  ): RawBuilder<boolean> {
    const property = input.properties.find(
      (property) => property.id === rule.propertyId,
    );
    const raw = this.rawValue(rule.propertyId);
    let value = this.value(rule.propertyId, input);
    if (property?.type === 'date') {
      const candidates = Array.isArray(rule.value) ? rule.value : [rule.value];
      if (
        candidates.every(
          (candidate) =>
            typeof candidate === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(candidate),
        )
      ) {
        const zone = sql`case when exists(select 1 from pg_timezone_names where name = ${raw}->>'timeZone') then ${raw}->>'timeZone' else 'UTC' end`;
        value = sql`case when position('T' in ${value}) > 0 and pg_input_is_valid(${value}, 'timestamptz') then ((${value})::timestamptz at time zone (${zone}))::date::text else ${value} end`;
      }
    }
    if (rule.operator === 'is_empty')
      return rule.propertyId === 'title'
        ? sql`${value} = ''`
        : this.empty(rule.propertyId);
    if (rule.operator === 'is_not_empty')
      return rule.propertyId === 'title'
        ? sql`${value} != ''`
        : sql`not ${this.empty(rule.propertyId)}`;
    if (property?.type === 'multi_select') {
      if (
        !['contains', 'not_contains', 'equals', 'not_equals'].includes(
          rule.operator,
        )
      )
        throw new BadRequestException('Invalid multi-select filter');
      const values = Array.isArray(rule.value) ? rule.value : [rule.value];
      if (values.some((v) => typeof v !== 'string'))
        throw new BadRequestException('Invalid filter value');
      const match = rule.operator.includes('contains')
        ? sql`${raw} @> ${JSON.stringify(values)}::text::jsonb`
        : sql`${raw} = ${JSON.stringify([...values].sort())}::text::jsonb`;
      return rule.operator.startsWith('not')
        ? sql`not coalesce(${match}, false)`
        : sql`coalesce(${match}, false)`;
    }
    const comparable = (candidate: unknown): string | number => {
      if (property?.type === 'number') {
        if (typeof candidate !== 'number' || !Number.isFinite(candidate))
          throw new BadRequestException('Invalid numeric filter');
        return candidate;
      }
      if (property?.type === 'date') {
        try {
          return (
            normalizeDatabaseValue(
              'date',
              typeof candidate === 'string' && !candidate.includes('T')
                ? candidate
                : { start: candidate, timeZone: 'UTC' },
            ) as { start: string }
          ).start;
        } catch {
          throw new BadRequestException('Invalid date filter');
        }
      }
      if (typeof candidate !== 'string' && typeof candidate !== 'boolean')
        throw new BadRequestException('Invalid filter value');
      return String(candidate).toLowerCase();
    };
    if (rule.operator === 'between') {
      if (
        !['number', 'date'].includes(property?.type) ||
        !Array.isArray(rule.value) ||
        rule.value.length !== 2
      )
        throw new BadRequestException('Invalid range filter');
      return sql`${value} between ${comparable(rule.value[0])} and ${comparable(rule.value[1])}`;
    }
    const candidate = comparable(rule.value);
    if (rule.operator === 'contains' || rule.operator === 'not_contains') {
      if (property?.type === 'number' || property?.type === 'date')
        throw new BadRequestException('Invalid filter operator');
      const pattern = `%${String(candidate).replace(/[\\%_]/g, '\\$&')}%`;
      const match = sql<boolean>`coalesce(${value}, '') like ${pattern} escape '\\'`;
      return rule.operator === 'not_contains' ? sql`not (${match})` : match;
    }
    const operators = {
      equals: '=',
      not_equals: '<>',
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<=',
    };
    if (
      !(rule.operator in operators) ||
      (['gt', 'gte', 'lt', 'lte'].includes(rule.operator) &&
        !['number', 'date'].includes(property?.type))
    )
      throw new BadRequestException('Invalid filter operator');
    const expression = ['select', 'user', 'page_reference'].includes(
      property?.type,
    )
      ? sql`lower(coalesce(${raw}->>'id', ${raw}->>'value', ${raw} #>> '{}'))`
      : value;
    return sql`coalesce(${expression} ${sql.raw(operators[rule.operator])} ${candidate}, ${rule.operator === 'not_equals'})`;
  }

  private filter(
    group: DatabaseFilterGroup,
    input: DatabaseViewQueryInput,
  ): RawBuilder<boolean> {
    if (group.conditions.length === 0) return sql`true`;
    return sql`(${sql.join(
      group.conditions.map((condition) =>
        'conjunction' in condition
          ? this.filter(condition, input)
          : this.condition(condition, input),
      ),
      sql.raw(group.conjunction === 'and' ? ' and ' : ' or '),
    )})`;
  }

  private query(input: DatabaseViewQueryInput, restrictGroup = true) {
    let query: any = this.rows.createViewQuery(
      input.databaseId,
      input.workspaceId,
      input.spaceId,
      input.readablePageIds,
    );
    for (const id of getDatabaseViewPropertyIds(input.state)) {
      const property = input.properties.find((property) => property.id === id);
      const cell = sql<any>`(select normalize_database_cell_value(c.value, ${property?.type ?? 'multiline_text'}) as current_value from database_cells c where c.database_id = ${sql.ref('databaseRows.databaseId')} and c.page_id = ${sql.ref('databaseRows.pageId')} and c.property_id = ${id} and c.deleted_at is null limit 1)`;
      query = query.leftJoinLateral(cell.as(this.cellAlias(id)), (join) =>
        join.onTrue(),
      );
    }
    if (input.state.filter)
      query = query.where(this.filter(input.state.filter, input));
    if (restrictGroup && input.state.groupBy && input.groupKey !== undefined) {
      let key: unknown;
      try {
        key = JSON.parse(input.groupKey);
      } catch {
        throw new BadRequestException('Invalid group key');
      }
      if (key !== null && typeof key !== 'string' && typeof key !== 'boolean')
        throw new BadRequestException('Invalid group key');
      const property = input.properties.find(
        (property) => property.id === input.state.groupBy,
      );
      const raw = this.rawValue(input.state.groupBy);
      if (key === null) query = query.where(this.empty(input.state.groupBy));
      else if (property.type === 'multi_select')
        query = query.where(
          sql<boolean>`${raw} @> ${JSON.stringify([key])}::text::jsonb`,
        );
      else
        query = query.where(
          sql<boolean>`coalesce(${raw}->>'id', ${raw}->>'value', ${raw} #>> '{}') = ${String(key)}`,
        );
    }
    return query;
  }

  async list(
    input: DatabaseViewQueryInput,
    options: { limit?: number; cursor?: string },
  ) {
    let query: any = this.query(input);
    const fields: any[] = [];
    for (const [index, sort] of input.state.sorts.entries()) {
      const value = this.value(sort.propertyId, input);
      const isNumber =
        input.properties.find((p) => p.id === sort.propertyId)?.type ===
        'number';
      const empty = sql`case when ${value} is null then 1 else 0 end`;
      const comparable = isNumber
        ? sql`coalesce(${value}, 0)`
        : sql`coalesce(${value}, '') collate "C"`;
      query = query.select([
        empty.as(`empty${index}`),
        comparable.as(`sort${index}`),
      ]);
      fields.push(
        { expression: empty, direction: 'asc', key: `empty${index}` },
        {
          expression: comparable,
          direction: sort.direction,
          key: `sort${index}`,
        },
      );
    }
    fields.push(
      {
        expression: sql`coalesce(${sql.ref('pages.position')}, '') collate "C"`,
        direction: 'asc',
        key: 'pagePosition',
      },
      {
        expression: sql`${sql.ref('databaseRows.pageId')}::text collate "C"`,
        direction: 'asc',
        key: 'pageId',
      },
    );
    if (!options.limit)
      return {
        items: await fields
          .reduce(
            (q, field) => q.orderBy(field.expression, field.direction),
            query,
          )
          .execute(),
        nextCursor: null,
        hasMore: false,
      };
    const page = await (executeWithCursorPagination as any)(query, {
      perPage: options.limit,
      cursor: options.cursor,
      fields,
      parseCursor: (cursor) =>
        Object.fromEntries(
          fields.map((field) => [field.key, cursor[field.key]]),
        ),
    });
    return {
      items: page.items,
      nextCursor: page.meta.nextCursor,
      hasMore: page.meta.hasNextPage,
    };
  }

  private aggregate(
    id: string,
    operation: DatabaseCalculation,
    input: DatabaseViewQueryInput,
  ): RawBuilder<any> {
    const value = this.value(id, input);
    const empty = id === 'title' ? sql<boolean>`${value} = ''` : this.empty(id);
    if (operation === 'count') return sql`count(*)::int`;
    if (operation === 'filled')
      return sql`count(*) filter (where not ${empty})::int`;
    if (operation === 'empty')
      return sql`count(*) filter (where ${empty})::int`;
    const fn = {
      sum: 'sum',
      average: 'avg',
      min: 'min',
      max: 'max',
      earliest: 'min',
      latest: 'max',
    }[operation];
    const aggregation = sql`${sql.raw(fn)}(${value})`;
    return ['sum', 'average', 'min', 'max'].includes(operation)
      ? sql`(${aggregation})::float8`
      : aggregation;
  }

  async summary(input: DatabaseViewQueryInput): Promise<DatabaseSummary> {
    const calculations = Object.entries(input.state.calculations);
    const base = this.query(input, false).clearSelect();
    const select = [
      sql`count(*)::int`.as('count'),
      ...calculations.map(([id, operation], index) =>
        this.aggregate(id, operation, input).as(`value${index}`),
      ),
    ];
    const result: any = await base.select(select).executeTakeFirst();
    const values = (row: any) =>
      Object.fromEntries(
        calculations.map(([id], index) => [id, row[`value${index}`] ?? null]),
      );
    const groups: DatabaseSummary['groups'] = [];
    if (input.state.groupBy) {
      const property = input.properties.find(
        (property) => property.id === input.state.groupBy,
      );
      const raw = this.rawValue(property.id);
      const groupValue =
        property.type === 'multi_select'
          ? sql`coalesce((select jsonb_agg(distinct item) from jsonb_array_elements(case when jsonb_typeof(${raw}) = 'array' then case when jsonb_array_length(${raw}) > 0 then ${raw} else '[null]'::jsonb end else '[null]'::jsonb end) item), '[null]'::jsonb)`
          : sql`jsonb_build_array(case when ${this.empty(property.id)} then null else coalesce(${raw}->'id', ${raw}->'value', ${raw}) end)`;
      const grouped: any = await base
        .crossJoinLateral(
          sql<any>`jsonb_array_elements(${groupValue})`.as('groupItem'),
        )
        .select([sql`group_item.value`.as('groupValue'), ...select])
        .groupBy(sql`group_item.value`)
        .orderBy(sql`group_item.value`)
        .execute();
      const userNames =
        property.type === 'user'
          ? new Map(
              (
                await this.db
                  .selectFrom('users')
                  .select(['id', 'name'])
                  .where('workspaceId', '=', input.workspaceId)
                  .where(
                    sql<boolean>`id::text = any(${grouped.map((row) => String(row.groupValue))}::text[])`,
                  )
                  .execute()
              ).map((user) => [user.id, user.name]),
            )
          : new Map<string, string>();
      for (const row of grouped) {
        const key = row.groupValue;
        let label = key === null ? '' : String(key);
        if (property.type === 'select' || property.type === 'multi_select')
          label =
            property.settings?.options?.find((option) => option.value === key)
              ?.label ?? label;
        if (property.type === 'user' && key)
          label = userNames.get(String(key)) ?? label;
        groups.push({
          key: JSON.stringify(key),
          label,
          count: row.count,
          values: values(row),
        });
      }
    }
    return { count: result?.count ?? 0, values: values(result ?? {}), groups };
  }
}
