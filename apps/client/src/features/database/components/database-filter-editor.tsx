import { Button, Group, Select, Stack, TextInput } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { IDatabaseFilterCondition } from '@/features/database/types/database-table.types';
import { IDatabaseProperty } from '@/features/database/types/database.types';
import { shouldShowDatabaseFilterRemove } from './database-table-view.helpers';

interface DatabaseFilterEditorProps {
  filters: IDatabaseFilterCondition[];
  properties: IDatabaseProperty[];
  checkboxOptions: Array<{ value: string; label: string }>;
  maxFilters: number;
  layout: 'stacked' | 'inline';
  createFilter: () => IDatabaseFilterCondition;
  onChange: (filters: IDatabaseFilterCondition[]) => void;
  onClear: () => void;
  onReset: () => void;
}

export function DatabaseFilterEditor({
  filters,
  properties,
  checkboxOptions,
  maxFilters,
  layout,
  createFilter,
  onChange,
  onClear,
  onReset,
}: DatabaseFilterEditorProps) {
  const { t } = useTranslation();
  const isStacked = layout === 'stacked';

  const updateCondition = (
    index: number,
    update: Partial<IDatabaseFilterCondition>,
  ) => {
    onChange(
      filters.map((condition, conditionIndex) =>
        conditionIndex === index ? { ...condition, ...update } : condition,
      ),
    );
  };

  const conditionEditors = filters.map((condition, index) => {
    const selectedProperty = properties.find(
      (property) => property.id === condition.propertyId,
    );
    const isCheckboxProperty = selectedProperty?.type === 'checkbox';
    const fields = (
      <>
        <Select
          aria-label={t('Filter field')}
          placeholder={t('Field')}
          data={properties.map((property) => ({
            value: property.id,
            label: property.name,
          }))}
          value={condition.propertyId}
          onChange={(value) => {
            const nextProperty = properties.find(
              (property) => property.id === value,
            );
            const shouldResetValue =
              nextProperty?.type === 'checkbox' &&
              condition.value !== 'true' &&
              condition.value !== 'false';

            updateCondition(index, {
              propertyId: value || '',
              value: shouldResetValue ? '' : condition.value,
            });
          }}
        />
        <Select
          aria-label={t('Filter operator')}
          w={isStacked ? undefined : 140}
          data={[
            { value: 'contains', label: t('contains') },
            { value: 'equals', label: t('equals') },
            { value: 'not_equals', label: t('not equals') },
          ]}
          value={condition.operator}
          onChange={(value) => {
            if (value) {
              updateCondition(index, {
                operator: value as IDatabaseFilterCondition['operator'],
              });
            }
          }}
        />
        {isCheckboxProperty ? (
          <Select
            aria-label={t('Filter value')}
            placeholder={t('Value')}
            data={checkboxOptions}
            value={condition.value || null}
            onChange={(value) =>
              updateCondition(index, { value: value || '' })
            }
            allowDeselect
          />
        ) : (
          <TextInput
            aria-label={t('Filter value')}
            placeholder={t('Value')}
            value={condition.value}
            onChange={(event) =>
              updateCondition(index, { value: event.currentTarget.value })
            }
          />
        )}
        {shouldShowDatabaseFilterRemove(filters.length) && (
          <Button
            variant="subtle"
            color="red"
            onClick={() =>
              onChange(
                filters.filter(
                  (_, conditionIndex) => conditionIndex !== index,
                ),
              )
            }
          >
            {t('Remove')}
          </Button>
        )}
      </>
    );

    return isStacked ? (
      <Stack key={`filter-${index}`} gap="xs">
        {fields}
      </Stack>
    ) : (
      <Group key={`filter-${index}`} align="end" wrap="nowrap">
        {fields}
      </Group>
    );
  });

  return (
    <Stack gap="xs" mb={isStacked ? undefined : 'md'}>
      {conditionEditors}
      <Group gap="xs">
        <Button
          w={isStacked ? undefined : 'fit-content'}
          variant="subtle"
          leftSection={<IconPlus size={14} />}
          disabled={filters.length >= maxFilters}
          onClick={() => onChange([...filters, createFilter()])}
        >
          {t('Filter')}
        </Button>
        <Button variant="subtle" onClick={onClear}>
          {t('Clear filters')}
        </Button>
        {!isStacked && (
          <Button variant="subtle" onClick={onReset}>
            {t('Reset')}
          </Button>
        )}
      </Group>
      {isStacked && (
        <Button variant="subtle" onClick={onReset}>
          {t('Reset')}
        </Button>
      )}
    </Stack>
  );
}
