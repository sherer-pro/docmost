import { alpha, Badge, Checkbox, Group, Select, Text, TextInput, useMantineTheme } from '@mantine/core';
import { DatabasePropertyType } from '@docmost/api-contract';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  getSpaceMemberSearchProps,
  renderSpaceMemberOption,
  renderSpaceMemberValue,
  useSpaceMemberSelectOptions,
} from '@/features/page/components/document-fields/space-member-select-utils.tsx';
import { IDatabaseProperty } from '@/features/database/types/database.types.ts';
import { CustomAvatar } from '@/components/ui/custom-avatar.tsx';
import {
  getDatabaseSelectOption,
  normalizeDatabaseCheckboxValue,
  normalizeDatabasePageReferenceValue,
  normalizeDatabaseSelectValue,
  normalizeDatabaseStringValue,
  normalizeDatabaseUserId,
} from '@/features/database/utils/database-cell-value.ts';
import { DictionaryTextHighlighter } from '@/features/dictionary/components/dictionary-text-highlighter';
import { DictionaryTextarea } from '@/features/dictionary/components/dictionary-textarea';
import { IDictionaryTerm } from '@/features/dictionary/types/dictionary.types';
import { DictionaryMatcherIndex } from '@/features/dictionary/utils/dictionary-matcher';

interface DatabasePageReferenceOption {
  value: string;
  label: string;
}

interface DatabaseCellRendererProps {
  property: IDatabaseProperty;
  value: unknown;
  isEditable: boolean;
  isEditing: boolean;
  editingValue: unknown;
  spaceId: string;
  dictionaryTerms?: IDictionaryTerm[];
  dictionaryMatcherIndex?: DictionaryMatcherIndex;
  dictionaryEnabled?: boolean;
  canManageDictionary?: boolean;
  pageOptions?: DatabasePageReferenceOption[];
  pageReferenceUrlById?: Map<string, string | null>;
  isPageOptionsLoading?: boolean;
  cellLabel?: string;
  onStartEdit: () => void;
  onChange: (value: unknown) => void;
  onSave: (value?: unknown) => void;
}

function DatabaseUserViewValue({
  value,
  spaceId,
}: {
  value: unknown;
  spaceId: string;
}) {
  const { t } = useTranslation();
  const selectedUserId = useMemo(() => normalizeDatabaseUserId(value), [value]);

  if (!selectedUserId) {
    return <Text c="dimmed">{t('Empty value')}</Text>;
  }

  return (
    <ResolvedDatabaseUserViewValue
      selectedUserId={selectedUserId}
      spaceId={spaceId}
    />
  );
}

function ResolvedDatabaseUserViewValue({
  selectedUserId,
  spaceId,
}: {
  selectedUserId: string;
  spaceId: string;
}) {
  const { t } = useTranslation();
  const { options: memberOptions, knownUsersById } = useSpaceMemberSelectOptions(
    spaceId,
    [selectedUserId],
  );
  const selectedMember = useMemo(
    () =>
      knownUsersById[selectedUserId] ??
      memberOptions.find((option) => option.value === selectedUserId),
    [knownUsersById, memberOptions, selectedUserId],
  );

  if (selectedMember) {
    return (
      <Group gap="xs" wrap="nowrap">
        {renderSpaceMemberValue(selectedMember)}
        <Text lineClamp={1}>{selectedMember.label}</Text>
      </Group>
    );
  }

  return (
    <Group gap="xs" wrap="nowrap">
      <CustomAvatar avatarUrl="" size={18} name={t('Unknown')} />
      <Text c="dimmed" lineClamp={1}>
        {t('Unknown')}
      </Text>
    </Group>
  );
}

function DatabaseUserEditor({
  value,
  spaceId,
  autoFocus,
  onChange,
  onSave,
  onBlur,
}: {
  value: unknown;
  spaceId: string;
  autoFocus: boolean;
  onChange: (value: unknown) => void;
  onSave: (value?: unknown) => void;
  onBlur: () => void;
}) {
  const { t } = useTranslation();
  const selectedUserId = useMemo(() => normalizeDatabaseUserId(value), [value]);
  const {
    options: memberOptions,
    searchValue,
    setSearchValue,
    isLoading: isMembersLoading,
    knownUsersById,
  } = useSpaceMemberSelectOptions(spaceId, selectedUserId ? [selectedUserId] : []);
  const selectedMember = useMemo(
    () =>
      selectedUserId
        ? knownUsersById[selectedUserId] ??
          memberOptions.find((option) => option.value === selectedUserId)
        : null,
    [knownUsersById, memberOptions, selectedUserId],
  );

  return (
    <Select
      autoFocus={autoFocus}
      data={memberOptions}
      value={selectedUserId}
      onChange={(nextValue) => {
        const normalizedValue = nextValue ? { id: nextValue } : null;
        onChange(normalizedValue);
        onSave(normalizedValue);
      }}
      {...getSpaceMemberSearchProps(
        {
          placeholder: t('Select member'),
          loadingMessage: t('Loading...'),
          nothingFoundMessage: t('No members found'),
        },
        searchValue,
        setSearchValue,
        isMembersLoading,
      )}
      leftSection={renderSpaceMemberValue(selectedMember)}
      renderOption={renderSpaceMemberOption}
      onBlur={onBlur}
    />
  );
}

/**
 * Unified database cell renderer.
 *
 * Encapsulates both view and edit modes for all supported
 * property types so value rendering and editing behavior stay
 * centralized and predictable.
 */
export function DatabaseCellRenderer({
  property,
  value,
  isEditable,
  isEditing,
  editingValue,
  spaceId,
  dictionaryTerms = [],
  dictionaryMatcherIndex,
  dictionaryEnabled = false,
  canManageDictionary = false,
  pageOptions = [],
  pageReferenceUrlById,
  isPageOptionsLoading = false,
  cellLabel,
  onStartEdit,
  onChange,
  onSave,
}: DatabaseCellRendererProps) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const editorValue = isEditing ? editingValue : value;
  const activeDictionaryTerms = dictionaryEnabled ? dictionaryTerms : [];
  const activeDictionaryMatcherIndex = dictionaryEnabled
    ? dictionaryMatcherIndex
    : undefined;

  const isDropdownPropertyType = (type: DatabasePropertyType) => {
    return type === 'select' || type === 'user' || type === 'page_reference';
  };

  const shouldRenderDropdownEditor = isEditable && isDropdownPropertyType(property.type);
  const shouldRenderEditor = isEditable && (isEditing || shouldRenderDropdownEditor);

  const handleBlurSave = () => {
    if (isEditing) {
      onSave();
    }
  };

  const renderViewValue = () => {
    if (property.type === 'checkbox') {
      const checked = normalizeDatabaseCheckboxValue(value);
      const checkboxLabel = cellLabel
        ? `${cellLabel}: ${checked ? t('Checked') : t('Unchecked')}`
        : undefined;

      if (!isEditable) {
        return (
          <Checkbox
            aria-label={checkboxLabel}
            checked={checked}
            disabled
            readOnly
          />
        );
      }

      return (
        <div
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {/*
            In view mode for editable tables, the checkbox persists the value immediately,
            without switching to a separate edit state.
          */}
          <Checkbox
            aria-label={checkboxLabel}
            checked={checked}
            onChange={(event) => {
              const nextChecked = event.currentTarget.checked;
              onChange(nextChecked);
              onSave(nextChecked);
            }}
            my="8"
          />
        </div>
      );
    }

    if (property.type === 'code') {
      const codeValue = normalizeDatabaseStringValue(value);

      return codeValue ? (
        <Text component="div" ff="monospace" style={{ whiteSpace: 'pre-wrap' }}>
          <DictionaryTextHighlighter
            text={codeValue}
            terms={activeDictionaryTerms}
            matcherIndex={activeDictionaryMatcherIndex}
            withLayer={false}
          />
        </Text>
      ) : (
        <Text c="dimmed">{t('Empty value')}</Text>
      );
    }

    if (property.type === 'select') {
      const selectValue = normalizeDatabaseSelectValue(value);
      if (!selectValue) {
        return <Text c="dimmed">{t('Empty value')}</Text>;
      }

      const selectedOption = getDatabaseSelectOption(property, selectValue);
      const label = selectedOption?.label || selectValue;

      return (
        <Badge color={selectedOption?.color || 'gray'} variant="light">
          {label}
        </Badge>
      );
    }

    if (property.type === 'user') {
      return <DatabaseUserViewValue value={value} spaceId={spaceId} />;
    }

    if (property.type === 'page_reference') {
      const refId = normalizeDatabasePageReferenceValue(value);
      if (!refId) {
        return <Text c="dimmed">{t('Empty value')}</Text>;
      }

      const targetPage = pageOptions.find((option) => option.value === refId);
      const targetPageUrl = pageReferenceUrlById?.get(refId);

      if (targetPageUrl && !isEditable) {
        return (
          <Text component={Link} to={targetPageUrl}>
            {targetPage?.label || refId}
          </Text>
        );
      }

      return <Text>{targetPage?.label || refId}</Text>;
    }

    const textValue = normalizeDatabaseStringValue(value);

    return textValue ? (
      <Text component="div" style={{ whiteSpace: 'pre-wrap' }}>
        <DictionaryTextHighlighter
          text={textValue}
          terms={activeDictionaryTerms}
          matcherIndex={activeDictionaryMatcherIndex}
          withLayer={false}
        />
      </Text>
    ) : (
      <Text c="dimmed">{t('Empty value')}</Text>
    );
  };

  const renderEditorByType = (type: DatabasePropertyType) => {
    if (type === 'checkbox') {
      const checked = normalizeDatabaseCheckboxValue(editorValue);
      const checkboxLabel = cellLabel
        ? `${cellLabel}: ${checked ? t('Checked') : t('Unchecked')}`
        : undefined;

      return (
        <div
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            aria-label={checkboxLabel}
            autoFocus={isEditing}
            checked={checked}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              onChange(checked);
              onSave(checked);
            }}
          />
        </div>
      );
    }

    if (type === 'multiline_text') {
      return (
        <DictionaryTextarea
          autoFocus={isEditing}
          autosize
          minRows={2}
          spaceId={spaceId}
          canCreate={dictionaryEnabled && canManageDictionary}
          value={normalizeDatabaseStringValue(editorValue)}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={handleBlurSave}
        />
      );
    }

    if (type === 'code') {
      return (
        <DictionaryTextarea
          autoFocus={isEditing}
          autosize
          minRows={3}
          ff="monospace"
          spaceId={spaceId}
          canCreate={dictionaryEnabled && canManageDictionary}
          value={normalizeDatabaseStringValue(editorValue)}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={handleBlurSave}
        />
      );
    }

    if (type === 'select') {
      const settings =
        property.settings && 'options' in property.settings ? property.settings.options : [];
      const selectValue = normalizeDatabaseSelectValue(editorValue);
      const selectOptionByValue = new Map(
        settings.map((option) => [option.value, option]),
      );
      const selectedOption = selectOptionByValue.get(selectValue);
      const selectedColorScale = selectedOption?.color
        ? theme.colors[selectedOption.color] ?? theme.colors.gray
        : null;
      const selectInputStyles = selectedColorScale
        ? {
            input: {
              backgroundColor: alpha(selectedColorScale[1], 0.35),
              borderColor: selectedColorScale[4],
            },
          }
        : undefined;

      return (
        <Select
          autoFocus={isEditing}
          aria-label={cellLabel ?? property.name}
          data={settings.map((option) => ({ value: option.value, label: option.label }))}
          value={selectValue || null}
          onChange={(nextValue) => {
            const normalizedValue = nextValue || '';
            onChange(normalizedValue);
            onSave(normalizedValue);
          }}
          onBlur={handleBlurSave}
          clearable
          styles={selectInputStyles}
          renderOption={({ option }) => {
            const selectOption = selectOptionByValue.get(option.value);

            return (
              <Badge color={selectOption?.color || 'gray'} variant="light">
                {option.label}
              </Badge>
            );
          }}
        />
      );
    }

    if (type === 'user') {
      return (
        <DatabaseUserEditor
          value={editorValue}
          spaceId={spaceId}
          autoFocus={isEditing}
          onChange={onChange}
          onSave={onSave}
          onBlur={handleBlurSave}
        />
      );
    }

    if (type === 'page_reference') {
      const pageReferenceValue = normalizeDatabasePageReferenceValue(editorValue);

      return (
        <Select
          autoFocus={isEditing}
          aria-label={cellLabel ?? property.name}
          searchable
          clearable
          data={pageOptions}
          value={pageReferenceValue || null}
          onChange={(nextValue) => {
            const normalizedValue = nextValue || '';
            onChange(normalizedValue);
            onSave(normalizedValue);
          }}
          nothingFoundMessage={isPageOptionsLoading ? t('Loading...') : t('No pages found')}
          onBlur={handleBlurSave}
        />
      );
    }

    return (
      <TextInput
        autoFocus={isEditing}
        aria-label={cellLabel ?? property.name}
        value={normalizeDatabaseStringValue(editorValue)}
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={handleBlurSave}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onSave();
          }
        }}
      />
    );
  };

  return (
    <div
      onClick={() => {
        if (
          !isEditing &&
          isEditable &&
          property.type !== 'checkbox' &&
          !isDropdownPropertyType(property.type)
        ) {
          onStartEdit();
        }
      }}
      style={{
        cursor: isEditable
          ? property.type === 'checkbox'
            ? 'pointer'
            : shouldRenderDropdownEditor
              ? 'default'
              : 'text'
          : 'default',
      }}
    >
      {shouldRenderEditor ? renderEditorByType(property.type) : renderViewValue()}
    </div>
  );
}
