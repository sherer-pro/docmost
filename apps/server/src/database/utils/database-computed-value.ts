import { RawBuilder, sql } from 'kysely';
import {
  DatabaseFormulaNode,
  validateDatabaseFormulaSchema,
} from '@docmost/api-contract';

export interface ComputedDatabaseProperty {
  id: string;
  type: string | null;
  settings?: unknown;
}

// Every node is a bounded lateral expression. References never contain SQL text.
export function databasePropertyValue(
  propertyId: string,
  properties: ComputedDatabaseProperty[],
): RawBuilder<any> {
  const byId = new Map(properties.map((property) => [property.id, property]));
  const formulas = validateDatabaseFormulaSchema(properties);
  const cache = new Map<string, RawBuilder<any>>();
  const parts: RawBuilder<any>[] = [];
  const error = (code: string) =>
    sql`jsonb_build_object('error', ${code}::text)`;
  const text = (value: RawBuilder<any>) => sql`(${value} #>> '{}')`;
  const number = (value: RawBuilder<any>) =>
    sql`case when jsonb_typeof(${value}) = 'number' then (${text(value)})::numeric end`;
  const boolean = (value: RawBuilder<any>) =>
    sql`case when jsonb_typeof(${value}) = 'boolean' then (${text(value)})::boolean end`;
  const date = (value: RawBuilder<any>) => {
    const start = sql`${value}->>'start'`;
    const zone = sql`case when exists(select 1 from pg_timezone_names where name = ${value}->>'timeZone') then ${value}->>'timeZone' else 'UTC' end`;
    return sql`case when position('T' in ${start}) > 0 and pg_input_is_valid(${start}, 'timestamptz') then ((${start})::timestamptz at time zone (${zone}))::date when ${start} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and pg_input_is_valid(${start}, 'date') then (${start})::date end`;
  };
  const hasError = (value: RawBuilder<any>) =>
    sql`jsonb_typeof(${value}) = 'object' and ${value} ? 'error'`;
  const userId = (value: RawBuilder<any>) =>
    sql`lower(coalesce(${value}->>'id', ${value} #>> '{}'))`;
  const userValue = (value: RawBuilder<any>) =>
    sql`case when jsonb_typeof(${value}) = 'array' then coalesce((select jsonb_agg(jsonb_build_object('id', ${userId(sql`item.value`)}, 'name', coalesce(u.name, ${userId(sql`item.value`)})) order by item.ordinality) from jsonb_array_elements(${value}) with ordinality item(value, ordinality) left join users u on u.id::text = ${userId(sql`item.value`)} and u.workspace_id = ${sql.ref('databaseRows.workspaceId')} and u.deleted_at is null), '[]'::jsonb) when ${value} is null then null::jsonb else (select jsonb_build_object('id', ${userId(value)}, 'name', coalesce(u.name, ${userId(value)})) from (select 1) seed left join users u on u.id::text = ${userId(value)} and u.workspace_id = ${sql.ref('databaseRows.workspaceId')} and u.deleted_at is null) end`;
  const boundedNumber = (value: RawBuilder<any>) =>
    sql`case when abs(${value}) <= 1000000000000000 then to_jsonb(${value}) else ${error('numeric_range')} end`;
  const boundedText = (value: RawBuilder<any>) =>
    sql`case when octet_length(${value}) <= 16384 then to_jsonb(${value}) else ${error('text_limit')} end`;
  const save = (expression: RawBuilder<any>): RawBuilder<any> => {
    if (parts.length >= 512) throw new Error('Expanded formula is too complex');
    const alias = `formula_node_${parts.length}`;
    parts.push(
      sql`cross join lateral (select ${expression} as value offset 0) ${sql.id(alias)}`,
    );
    return sql.ref(`${alias}.value`);
  };
  const property = (id: string): RawBuilder<any> => {
    if (cache.has(id)) return cache.get(id)!;
    if (id === 'title')
      return save(sql`to_jsonb(coalesce(${sql.ref('pages.title')}, ''))`);
    const current = byId.get(id);
    if (!current) throw new Error('Formula references a missing property');
    let value: RawBuilder<any>;
    const formula = formulas.get(id);
    if (formula) value = node(formula);
    else if (current.type === 'created_at' || current.type === 'updated_at') {
      const timestamp =
        current.type === 'created_at'
          ? sql.ref('pages.createdAt')
          : sql`greatest(${sql.ref('pages.updatedAt')}, ${sql.ref('databaseRows.updatedAt')})`;
      value = save(
        sql`jsonb_build_object('start', to_char(${timestamp} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'timeZone', 'UTC')`,
      );
    } else if (current.type === 'updated_by') {
      const actor = sql`case when ${sql.ref('pages.updatedAt')} > ${sql.ref('databaseRows.updatedAt')} then ${sql.ref('pages.lastUpdatedById')} else ${sql.ref('databaseRows.updatedById')} end`;
      value = save(
        userValue(
          sql`case when ${actor} is not null then jsonb_build_object('id', ${actor}) end`,
        ),
      );
    } else {
      const rawStored = sql`(select nullif(normalize_database_cell_value(c.value, ${current.type ?? 'multiline_text'}), 'null'::jsonb) from database_cells c where c.database_id = ${sql.ref('databaseRows.databaseId')} and c.workspace_id = ${sql.ref('databaseRows.workspaceId')} and c.page_id = ${sql.ref('databaseRows.pageId')} and c.property_id = ${id}::uuid and c.deleted_at is null limit 1)`;
      const stored = ['user', 'file'].includes(current.type)
        ? save(rawStored)
        : rawStored;
      if (current.type === 'file') {
        value = save(
          sql`(select coalesce(jsonb_agg(jsonb_build_object('attachmentId', a.id, 'name', a.file_name, 'mimeType', a.mime_type, 'size', a.file_size) order by item.ordinality), '[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(${stored}) = 'array' then ${stored} else '[]'::jsonb end) with ordinality item(value, ordinality) inner join attachments a on a.id::text = lower(item.value->>'attachmentId') and a.workspace_id = ${sql.ref('databaseRows.workspaceId')} and a.page_id = ${sql.ref('databaseRows.pageId')} and a.deleted_at is null)`,
        );
      } else value = save(current.type === 'user' ? userValue(stored) : stored);
    }
    cache.set(id, value);
    return value;
  };
  const node = (item: DatabaseFormulaNode): RawBuilder<any> => {
    if (item.kind === 'property') return property(item.id);
    if (item.kind === 'literal')
      return save(
        item.value === null
          ? sql`null::jsonb`
          : sql`${JSON.stringify(item.value)}::text::jsonb`,
      );
    const args = item.args.map(node);
    const [a, b, c] = args;
    let result: RawBuilder<any>;
    const operation = { add: '+', subtract: '-', multiply: '*', divide: '/' }[
      item.name
    ];
    if (operation) {
      const calculation = sql`${number(a)} ${sql.raw(operation)} ${item.name === 'divide' ? sql`nullif(${number(b)}, 0)` : number(b)}`;
      result =
        item.name === 'divide'
          ? sql`case when ${number(b)} = 0 then ${error('division_by_zero')} else ${boundedNumber(calculation)} end`
          : boundedNumber(calculation);
    } else if (item.name === 'if') {
      return save(
        sql`case when ${hasError(a)} then ${a} when ${boolean(a)} then ${b} else ${c} end`,
      );
    } else if (item.name === 'eq')
      result = sql`to_jsonb(${a} is not distinct from ${b})`;
    else if (item.name === 'gt')
      result = sql`to_jsonb(${number(a)} > ${number(b)})`;
    else if (item.name === 'and' || item.name === 'or')
      result = sql`to_jsonb(${boolean(a)} ${sql.raw(item.name)} ${boolean(b)})`;
    else if (item.name === 'not') result = sql`to_jsonb(not ${boolean(a)})`;
    else if (item.name === 'concat')
      result = boundedText(sql`${text(a)} || ${text(b)}`);
    else if (item.name === 'length')
      result = sql`to_jsonb(char_length(${text(a)}))`;
    else if (item.name === 'trim')
      result = boundedText(sql`btrim(${text(a)}, E' \t\n\r')`);
    else if (item.name === 'slice') {
      const valid = sql`${number(b)} = trunc(${number(b)}) and ${number(c)} = trunc(${number(c)}) and ${number(b)} between 0 and 16384 and ${number(c)} between 0 and 16384`;
      result = sql`case when ${valid} then ${boundedText(sql`substring(${text(a)} from (${number(b)})::int + 1 for (${number(c)})::int)`)} else ${error('slice_range')} end`;
    } else if (item.name === 'text') {
      const value = sql`case when ${a} is null then '' when jsonb_typeof(${a}) = 'object' then ${a}->>'start' else ${text(a)} end`;
      result = boundedText(value);
    } else if (item.name === 'date') {
      result = sql`case when ${text(a)} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and pg_input_is_valid(${text(a)}, 'date') then jsonb_build_object('start', ${text(a)}) else ${error('invalid_date')} end`;
    } else if (item.name === 'dateAdd') {
      const days = sql`case when ${number(b)} = trunc(${number(b)}) and abs(${number(b)}) <= 366000 then (${number(b)})::int end`;
      const next = sql`${date(a)} + (${days})`;
      result = sql`case when ${days} is null or ${date(a)} is null then ${error('date_range')} when ${next} between date '0001-01-01' and date '9999-12-31' then jsonb_build_object('start', to_char(${next}, 'YYYY-MM-DD')) else ${error('date_range')} end`;
    } else if (item.name === 'dateDiff')
      result = sql`to_jsonb(${date(a)} - ${date(b)})`;
    else throw new Error('Unknown formula operation');
    const errorValue = sql`coalesce(${sql.join(args.map((arg) => sql`case when ${hasError(arg)} then ${arg} end`))})`;
    const nullValue = sql.join(
      args.map((arg) => sql`${arg} is null`),
      sql` or `,
    );
    return save(
      sql`case when ${errorValue} is not null then ${errorValue} ${['eq', 'text'].includes(item.name) ? sql`` : sql`when ${nullValue} then null::jsonb`} else ${result} end`,
    );
  };
  const result = property(propertyId);
  return sql`(select ${result} from (select 1) formula_seed ${sql.join(parts, sql` `)})`;
}
