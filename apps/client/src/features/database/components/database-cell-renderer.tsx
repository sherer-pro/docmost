import { Checkbox, Group, Select, Text, TextInput, Textarea } from '@mantine/core';
import { DatabasePropertyType } from '@docmost/api-contract';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSpaceMemberSelectOptions } from '@/features/page/components/document-fields/space-member-select-utils.ts';
import { useGetRootSidebarPagesQuery } from '@/features/page/queries/page-query.ts';
import { IDatabaseProperty } from '@/features/database/types/database.types.ts';
import { CustomAvatar } from '@/components/ui/custom-avatar.tsx';        
import { buildPageUrl } from '@/features/page/page.utils.ts';


interface DatabaseCellRendererProps {
  property: IDatabaseProperty;
  value: unknown;
  isEditable: boolean;
  isEditing: boolean;
  editingValue: unknown;
  spaceId: string;
  spaceSlug: string;
  getSelectOptionLabel: (property: IDatabaseProperty, value: string) => string;
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
  getSelectOptionLabel,
  onStartEdit,
  onChange,
  onSave,
}: DatabaseCellRendererProps) {
  const { t } = useTranslation();

  /**
   * The user type stores references in the `{ id }` format.
   * String values are still accepted for backward compatibility.
   */
  const selectedUserId = useMemo(() => {
    const sourceValue = isEditing ? editingValue : value;

    if (typeof sourceValue === 'string') {
      return sourceValue;
    }

    if (sourceValue && typeof sourceValue === 'object' && 'id' in sourceValue) {
      const candidate = (sourceValue as { id?: unknown }).id;
      return typeof candidate === 'string' ? candidate : null;
    }

    return null;
  }, [editingValue, isEditing, value]);

  const {
    options: memberOptions,
    searchValue,
    setSearchValue,
    isLoading: isMembersLoading,
    knownUsersById,
  } =
    useSpaceMemberSelectOptions(spaceId, selectedUserId ? [selectedUserId] : []);

  const pageQuery = useGetRootSidebarPagesQuery({
    spaceId,
    includeNodeTypes: ['page', 'database'],
  });

  const pageOptions = useMemo(
    () =>
      (pageQuery.data?.pages ?? [])
        .flatMap((page) => page.items)
        .map((node) => ({
          value: node.id,
          label: node.title || t('untitled'),
        })),
    [pageQuery.data?.pages, t],
  );

  /**
   * Возвращает URL страницы для page_reference только если у узла есть slugId.
   * Если slugId отсутствует, ссылка не строится — это защищает от некорректной навигации.
   */
  const pageReferenceUrlById = useMemo(
    () =>
      new Map(
        (pageQuery.data?.pages ?? [])
          .flatMap((page) => page.items)
          .map((node) => [
            node.id,
            node.slugId ? buildPageUrl(spaceSlug, node.slugId, node.title || t('untitled')) : null,
          ]),
      ),
    [pageQuery.data?.pages, spaceSlug, t],
  );

  const renderViewValue = () => {
    if (property.type === 'checkbox') {
      return <Checkbox checked={Boolean(value)} disabled readOnly />;
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
      const selectValue = typeof value === 'string' ? value : '';
      const label = selectValue ? getSelectOptionLabel(property, selectValue) : '';
      return label || <Text c="dimmed">{t('Empty value')}</Text>;
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
            <CustomAvatar avatarUrl={selectedMember.avatarUrl} size={18} name={selectedMember.label} />
            <Text lineClamp={1}>{selectedMember.label}</Text>
          </Group>
        );
      }

      return <Text c="dimmed">{t('Unknown')}</Text>;
    }

    if (property.type === 'page_reference') {
      const refId = typeof value === 'string' ? value : '';
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

      // Fallback: если страница не найдена (или нет slugId), показываем ID без ссылки.
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

      return (
        <Select
          autoFocus
          data={settings.map((option) => ({ value: option.value, label: option.label }))}
          value={typeof editingValue === 'string' ? editingValue : null}
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
          searchable
          clearable
          data={memberOptions}
          value={selectedUserId}
          onChange={(nextValue) => {
            const normalizedValue = nextValue ? { id: nextValue } : null;
            onChange(normalizedValue);
            onSave(normalizedValue);
          }}
          filter={({ options }) => options}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          nothingFoundMessage={isMembersLoading ? t('Loading...') : t('No members found')}
          onBlur={() => onSave()}
        />
      );
    }

    if (type === 'page_reference') {
      return (
        <Select
          autoFocus
          searchable
          clearable
          data={pageOptions}
          value={typeof editingValue === 'string' ? editingValue : null}
          onChange={(nextValue) => {
            const normalizedValue = nextValue || '';
            onChange(normalizedValue);
            onSave(normalizedValue);
          }}
          nothingFoundMessage={pageQuery.isLoading ? t('Loading...') : t('No pages found')}
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
        if (!isEditing && isEditable) {
          onStartEdit();
        }
      }}
      style={{ cursor: isEditable ? 'text' : 'default' }}
    >
      {isEditing && isEditable ? renderEditorByType(property.type) : renderViewValue()}
    </div>
  );
}
