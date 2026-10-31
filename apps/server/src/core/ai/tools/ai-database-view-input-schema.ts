import type { DatabaseFilterOperator } from '@docmost/api-contract';

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
    'Optional complete view override, not a patch. Omit it to preserve the frozen current view. To answer a different requested selection, set filter with conjunction and conditions using exact property IDs. Preserve current conditions that the user did not override. An empty conditions array removes all filters. Date criteria are supported. Use at most ten rules in total and one nested group level. Existing selected rows remain the authorization scope.',
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
