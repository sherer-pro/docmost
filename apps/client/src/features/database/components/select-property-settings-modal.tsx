import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IDatabaseSelectOption,
  IDatabaseSelectPropertySettings,
} from '@/features/database/types/database.types';

interface SelectPropertySettingsModalProps {
  opened: boolean;
  propertyName: string;
  initialSettings: IDatabaseSelectPropertySettings;
  onClose: () => void;
  onSave: (settings: IDatabaseSelectPropertySettings) => Promise<void>;
}

const COLOR_OPTIONS = [
  'gray',
  'red',
  'pink',
  'grape',
  'violet',
  'indigo',
  'blue',
  'cyan',
  'teal',
  'green',
  'lime',
  'yellow',
  'orange',
];

function createEmptyOption(): IDatabaseSelectOption {
  return {
    label: '',
    value: '',
    color: 'gray',
  };
}

export function SelectPropertySettingsModal({
  opened,
  propertyName,
  initialSettings,
  onClose,
  onSave,
}: SelectPropertySettingsModalProps) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<IDatabaseSelectOption[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!opened) {
      return;
    }

    const normalizedOptions = initialSettings.options.length
      ? initialSettings.options
      : [createEmptyOption()];

    setOptions(normalizedOptions);
  }, [initialSettings.options, opened]);

  const hasInvalidOptions = useMemo(() => {
    const nonEmptyOptions = options.filter(
      (option) => option.label.trim() || option.value.trim(),
    );

    if (nonEmptyOptions.length === 0) {
      return true;
    }

    const values = new Set<string>();

    for (const option of nonEmptyOptions) {
      const label = option.label.trim();
      const value = option.value.trim();

      if (!label || !value) {
        return true;
      }

      if (values.has(value)) {
        return true;
      }

      values.add(value);
    }

    return false;
  }, [options]);

  const handleSave = async () => {
    const normalizedOptions = options
      .map((option) => ({
        label: option.label.trim(),
        value: option.value.trim(),
        color: option.color || 'gray',
      }))
      .filter((option) => option.label && option.value);

    if (normalizedOptions.length === 0) {
      return;
    }

    setIsSaving(true);

    try {
      await onSave({ options: normalizedOptions });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t('Select options for property', { name: propertyName })} size="lg">
      <Stack>
        {options.map((option, index) => (
          <Group key={`option-${index}`} align="end" wrap="nowrap">
            <TextInput
              flex={1}
              label={t('Label')}
              value={option.label}
              onChange={(event) => {
                const next = [...options];
                next[index] = {
                  ...next[index],
                  label: event.currentTarget.value,
                };
                setOptions(next);
              }}
            />
            <TextInput
              flex={1}
              label={t('Value')}
              value={option.value}
              onChange={(event) => {
                const next = [...options];
                next[index] = {
                  ...next[index],
                  value: event.currentTarget.value,
                };
                setOptions(next);
              }}
            />
            <Select
              w={140}
              label={t('Color')}
              data={COLOR_OPTIONS.map((color) => ({ value: color, label: color }))}
              value={option.color || 'gray'}
              onChange={(value) => {
                const next = [...options];
                next[index] = {
                  ...next[index],
                  color: value || 'gray',
                };
                setOptions(next);
              }}
              allowDeselect={false}
            />
            <ActionIcon
              color="red"
              variant="light"
              mb={2}
              onClick={() => setOptions((prev) => prev.filter((_, optionIndex) => optionIndex !== index))}
              disabled={options.length === 1}
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        ))}

        <Group justify="space-between">
          <Button
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={() => setOptions((prev) => [...prev, createEmptyOption()])}
          >
            {t('Option')}
          </Button>
          <Group>
            <Button variant="default" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button onClick={handleSave} loading={isSaving} disabled={hasInvalidOptions}>
              {t('Save')}
            </Button>
          </Group>
        </Group>

        {hasInvalidOptions && (
          <Text c="red" size="sm">
            {t('Each option must have unique value and non-empty label')}
          </Text>
        )}
      </Stack>
    </Modal>
  );
}
