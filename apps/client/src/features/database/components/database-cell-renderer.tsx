import { Badge, Checkbox, Group, Select, Text, TextInput, Textarea } from '@mantine/core';
import { DatabasePropertyType } from '@docmost/api-contract';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getSpaceMemberSearchProps,
  renderSpaceMemberOption,
  renderSpaceMemberValue,
  useSpaceMemberSelectOptions,
} from '@/features/page/components/document-fields/space-member-select-utils.tsx';
import { IDatabaseProperty } from '@/features/database/types/database.types.ts';
import { CustomAvatar } from '@/components/ui/custom-avatar.tsx';
import { buildPageUrl } from '@/features/page/page.utils.ts';
import {
  getDatabaseSelectOption,
  normalizeDatabaseCheckboxValue,
  normalizeDatabasePageReferenceValue,
  normalizeDatabaseSelectValue,
  normalizeDatabaseStringValue,
  normalizeDatabaseUserId,
} from '@/features/database/utils/database-cell-value.ts';
import { getAllSidebarPages } from '@/features/page/services/page-service.ts';
import { PAGE_QUERY_KEYS } from '@/features/page/queries/query-keys.ts';

interface DatabaseCellRendererProps {
  property: IDatabaseProperty;
  value: unknown;
  isEditable: boolean;
  isEditing: boolean;
  editingValue: unknown;
  spaceId: string;
  spaceSlug: string;
  onStartEdit: () => void;
  onChange: (value: unknown) => void;
  onSave: (value?: unknown) => void;
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
  spaceSlug,
  onStartEdit,
  onChange,
  onSave,
}: DatabaseCellRendererProps) {
  const { t } = useTranslation();
  const editorValue = isEditing ? editingValue : value;

  const selectedUserId = useMemo(() => {
    return normalizeDatabaseUserId(editorValue);
  }, [editorValue]);

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

  const allPagesQuery = useQuery({
    queryKey: [...PAGE_QUERY_KEYS.rootSidebar(spaceId, ['page', 'database']), 'all-pages'],
    queryFn: () =>
      getAllSidebarPages({
        spaceId,
        includeNodeTypes: ['page', 'database'],
      }),
    enabled: !!spaceId,
  });

  const allPageNodes = useMemo(
    () => allPagesQuery.data?.pages.flatMap((queryPage) => queryPage.items) ?? [],
    [allPagesQuery.data?.pages],
  );

  const pageOptions = useMemo(
    () =>
      allPageNodes.map((node) => ({
        value: node.id,
        label: node.title || t('untitled'),
      })),
    [allPageNodes, t],
  );

  /**
   * Returns the page URL for page_reference only if the node has a slugId.
   * If slugId is missing, the link is not built - this protects against incorrect navigation.
   */
  const pageReferenceUrlById = useMemo(
    () =>
      new Map(
        allPageNodes.map((node) => [
          node.id,
          node.slugId
            ? buildPageUrl(spaceSlug, node.slugId, node.title || t('untitled'))
            : null,
        ]),
      ),
    [allPageNodes, spaceSlug, t],
  );

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

      if (!isEditable) {
        return <Checkbox checked={checked} disabled readOnly />;
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
            checked={checked}
            onChange={(event) => {
              const nextChecked = event.currentTarget.checked;
              onChange(nextChecked);
              onSave(nextChecked);
            }}
          />
        </div>
      );
    }

    if (property.type === 'code') {
      const codeValue = normalizeDatabaseStringValue(value);

      return codeValue ? (
        <Text ff="monospace" style={{ whiteSpace: 'pre-wrap' }}>
          {codeValue}
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
      if (!selectedUserId) {
        return <Text c="dimmed">{t('Empty value')}</Text>;
      }

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

    if (property.type === 'page_reference') {
      const refId = normalizeDatabasePageReferenceValue(value);
      if (!refId) {
        return <Text c="dimmed">{t('Empty value')}</Text>;
      }

      const targetPage = pageOptions.find((option) => option.value === refId);
      const targetPageUrl = pageReferenceUrlById.get(refId);

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
      <Text style={{ whiteSpace: 'pre-wrap' }}>{textValue}</Text>
    ) : (
      <Text c="dimmed">{t('Empty value')}</Text>
    );
  };

  const renderEditorByType = (type: DatabasePropertyType) => {
    if (type === 'checkbox') {
      return (
        <div
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            autoFocus={isEditing}
            checked={normalizeDatabaseCheckboxValue(editorValue)}
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
        <Textarea
          autoFocus={isEditing}
          autosize
          minRows={2}
          value={normalizeDatabaseStringValue(editorValue)}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={handleBlurSave}
        />
      );
    }

    if (type === 'code') {
      return (
        <Textarea
          autoFocus={isEditing}
          autosize
          minRows={3}
          ff="monospace"
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

      return (
        <Select
          autoFocus={isEditing}
          data={settings.map((option) => ({ value: option.value, label: option.label }))}
          value={selectValue || null}
          onChange={(nextValue) => {
            const normalizedValue = nextValue || '';
            onChange(normalizedValue);
            onSave(normalizedValue);
          }}
          onBlur={handleBlurSave}
          clearable
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
        <Select
          autoFocus={isEditing}
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
          onBlur={handleBlurSave}
        />
      );
    }

    if (type === 'page_reference') {
      const pageReferenceValue = normalizeDatabasePageReferenceValue(editorValue);

      return (
        <Select
          autoFocus={isEditing}
          searchable
          clearable
          data={pageOptions}
          value={pageReferenceValue || null}
          onChange={(nextValue) => {
            const normalizedValue = nextValue || '';
            onChange(normalizedValue);
            onSave(normalizedValue);
          }}
          nothingFoundMessage={allPagesQuery.isLoading ? t('Loading...') : t('No pages found')}
          onBlur={handleBlurSave}
        />
      );
    }

    return (
      <TextInput
        autoFocus={isEditing}
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

