import type { DatabaseFilterOperator } from '@docmost/api-contract';

export const AI_DATABASE_SELECTION_GUIDANCE =
  'The server independently enforces live page ACL and AI content exclusions on every read. These visibility rules are not business-property filters. A request to use only permitted or AI-eligible records does not itself request a status filter. Never infer access from property names or select options. Preserve the current business filters unless the user requests different record criteria. When a focused group is active, retain the current groupBy property in every viewState override so that the group remains selected. For a total over one intended selection, obtain one successful summarizeDatabaseView covering that entire selection. Do not construct that total by adding separately filtered summaries: they may overlap, omit other or empty values, or describe different snapshots.';

const operators = [
  'contains',
  'not_contains',
  'equals',
  'not_equals',
  'is_empty',
  'is_not_empty',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
] satisfies DatabaseFilterOperator[];

const propertyId = {
  type: 'string',
  minLength: 1,
  maxLength: 100,
  description:
    'Exact property ID from getDatabaseContext, or title for the record title. Never use a field name as an ID.',
};

const rule = {
  type: 'object',
  additionalProperties: false,
  required: ['propertyId', 'operator'],
  properties: {
    propertyId,
    operator: { type: 'string', enum: operators },
    value: {
      description:
        'The requested typed value. For a date comparison use an ISO YYYY-MM-DD string; for between use a two-value array. Select values come from the property options. Omit value for is_empty and is_not_empty.',
    },
  },
};

const group = (items: unknown) => ({
  type: 'object',
  additionalProperties: false,
  required: ['conjunction', 'conditions'],
  properties: {
    conjunction: { type: 'string', enum: ['and', 'or'] },
    conditions: { type: 'array', maxItems: 10, items },
  },
});

// The database compiler still validates types, IDs and the total ten-rule budget.
export const AI_DATABASE_VIEW_INPUT_SCHEMA = {
  type: 'object',
  description:
    'Optional complete business-view override, not a patch. Omit it to preserve the frozen current view. To answer different requested record criteria, set filter with conjunction and conditions using exact property IDs. Preserve current conditions that the user did not override. A focused group requires retaining the current groupBy property in this override. An empty conditions array removes all business filters. Date criteria are supported. Use at most ten rules in total and one nested group level. Existing selected rows remain a frozen selection constraint; live ACL and AI content rules are enforced separately. Do not add property conditions to represent those visibility rules.',
  additionalProperties: true,
  properties: {
    version: { type: 'integer', enum: [2, 3] },
    filter: group({ anyOf: [rule, group(rule)] }),
    sorts: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['propertyId', 'direction'],
        properties: {
          propertyId,
          direction: { type: 'string', enum: ['asc', 'desc'] },
        },
      },
    },
    groupBy: {
      type: ['string', 'null'],
      description: 'Group by an existing supported property ID, or null.',
    },
    visibleColumns: {
      type: 'object',
      additionalProperties: { type: 'boolean' },
    },
  },
};
