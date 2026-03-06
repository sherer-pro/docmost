import { Badge, Checkbox, Group, Select, Text, TextInput, Textarea } from '@mantine/core';
import { DatabasePropertyType } from '@docmost/api-contract';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getSpaceMemberSearchProps,
  normalizeSpaceMemberValue,
  renderSpaceMemberOption,
  renderSpaceMemberValue,
  useSpaceMemberSelectOptions,
} from '@/features/page/components/document-fields/space-member-select-utils.tsx';
import { IDatabaseProperty } from '@/features/database/types/database.types.ts';
import { CustomAvatar } from '@/components/ui/custom-avatar.tsx';
import { buildPageUrl } from '@/features/page/page.utils.ts';
import {
  getDatabaseSelectOption,
  normalizeDatabasePageReferenceValue,
  normalizeDatabaseSelectValue,
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

  const selectedUserId = useMemo(() => {
    return normalizeSpaceMemberValue(isEditing ? editingValue : value);
  }, [editingValue, isEditing, value]);

  const {
    options: memberOptions,
    searchValue,
    setSearchValue,
    isLoading: isMembersLoading,
    knownUsersById,
  } =
    useSpaceMemberSelectOptions(spaceId, selectedUserId ? [selectedUserId] : []);

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
            node.slugId ? buildPageUrl(spaceSlug, node.slugId, node.title || t('untitled')) : null,
          ]),
      ),
    [allPageNodes, spaceSlug, t],
  );

  const renderViewValue = () => {
    if (property.type === 'checkbox') {
      const checked = Boolean(value);

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
      const codeValue = typeof value === 'string' ? value : '';
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

      const selectedMember = knownUsersById[selectedUserId] ??
        memberOptions.find((option) => option.value === selectedUserId);

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
          <Text c="dimmed" lineClamp={1}>{t('Unknown')}</Text>
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

      if (targetPageUrl) {
        return (
          <Text component={Link} to={targetPageUrl}>
            {targetPage?.label || refId}
          </Text>
        );
      }

      return targetPage?.label || refId;
    }

    const textValue = typeof value === 'string' ? value : '';
    return textValue || <Text c="dimmed">{t('Empty value')}</Text>;
  };

  const renderEditorByType = (type: DatabasePropertyType) => {
    if (type === 'checkbox') {
      return (
        <div
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            autoFocus
            checked={Boolean(editingValue)}
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
          autoFocus
          autosize
          minRows={2}
          value={typeof editingValue === 'string' ? editingValue : ''}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={() => onSave()}
        />
      );
    }

    if (type === 'code') {
      return (
        <Textarea
          autoFocus
          autosize
          minRows={3}
          ff="monospace"
          value={typeof editingValue === 'string' ? editingValue : ''}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={() => onSave()}
        />
      );
    }

    if (type === 'select') {
      const settings = property.settings && 'options' in property.settings ? property.settings.options : [];
      const selectValue = normalizeDatabaseSelectValue(editingValue);

      return (
        <Select
          autoFocus
          data={settings.map((option) => ({ value: option.value, label: option.label }))}
          value={selectValue || null}
          onChange={(nextValue) => {
            const normalizedValue = nextValue || '';
            onChange(normalizedValue);
            onSave(normalizedValue);
          }}
          onBlur={() => onSave()}
          clearable
        />
      );
    }

    if (type === 'user') {
      return (
        <Select
          autoFocus
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
          renderOption={renderSpaceMemberOption}
          onBlur={() => onSave()}
        />
      );
    }

    if (type === 'page_reference') {
      const pageReferenceValue = normalizeDatabasePageReferenceValue(editingValue);

      return (
        <Select
          autoFocus
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
          onBlur={() => onSave()}
        />
      );
    }

    return (
      <TextInput
        autoFocus
        value={typeof editingValue === 'string' ? editingValue : ''}
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={() => onSave()}
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
        if (!isEditing && isEditable && property.type !== 'checkbox') {
          onStartEdit();
        }
      }}
      style={{ cursor: isEditable ? (property.type === 'checkbox' ? 'pointer' : 'text') : 'default' }}
    >
      {isEditing && isEditable ? renderEditorByType(property.type) : renderViewValue()}
    </div>
  );
}
