import { Badge, Checkbox, Group, Select, SelectProps, Text, TextInput, Textarea } from '@mantine/core';
import { DatabasePropertyType } from '@docmost/api-contract';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  SpaceMemberSelectOption,
  useSpaceMemberSelectOptions,
} from '@/features/page/components/document-fields/space-member-select-utils.ts';
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
  getSelectOption: (property: IDatabaseProperty, value: string) => { label: string; color?: string } | null;
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
  getSelectOption,
  getSelectOptionLabel,
  onStartEdit,
  onChange,
  onSave,
}: DatabaseCellRendererProps) {
  const { t } = useTranslation();

  const renderMemberOption: SelectProps['renderOption'] = ({ option }) => {
    const member = option as SpaceMemberSelectOption;

    return (
      <Group gap="sm" wrap="nowrap">
        <CustomAvatar avatarUrl={member.avatarUrl} size={20} name={member.label} />
        <div>
          <Text size="sm" lineClamp={1}>{member.label}</Text>
          {member.email && <Text size="xs" c="dimmed" lineClamp={1}>{member.email}</Text>}
        </div>
      </Group>
    );
  };

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
   * Returns the page URL for page_reference only if the node has a slugId.
   * If slugId is missing, the link is not built - this protects against incorrect navigation.
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
      const selectValue = typeof value === 'string' ? value : '';
      if (!selectValue) {
        return <Text c="dimmed">{t('Empty value')}</Text>;
      }

      const selectedOption = getSelectOption(property, selectValue);
      const label = selectedOption?.label || getSelectOptionLabel(property, selectValue);

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
            <CustomAvatar avatarUrl={selectedMember.avatarUrl} size={18} name={selectedMember.label} />
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

      // Fallback: if the page is not found (or there is no slugId), show the ID without the link.
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
          renderOption={renderMemberOption}
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
