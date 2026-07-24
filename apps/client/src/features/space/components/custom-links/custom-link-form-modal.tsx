import React, { useEffect, useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Popover,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import {
  CUSTOM_LINK_ICON_NAMES,
  DEFAULT_CUSTOM_LINK_ICON,
  getCustomLinkIcon,
} from "./custom-link-icons.ts";
import { isSafeCustomLinkUrl } from "./custom-link-utils.ts";

export interface CustomLinkFormValue {
  label: string;
  url: string;
  icon: string;
}

interface CustomLinkFormModalProps {
  opened: boolean;
  onClose: () => void;
  onSubmit: (value: CustomLinkFormValue) => void;
  isPending?: boolean;
}

export default function CustomLinkFormModal({
  opened,
  onClose,
  onSubmit,
  isPending,
}: CustomLinkFormModalProps) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [icon, setIcon] = useState(DEFAULT_CUSTOM_LINK_ICON);
  const [error, setError] = useState<string | null>(null);
  const [iconPickerOpened, setIconPickerOpened] = useState(false);
  const [iconQuery, setIconQuery] = useState("");

  useEffect(() => {
    if (opened) {
      setLabel("");
      setUrl("");
      setIcon(DEFAULT_CUSTOM_LINK_ICON);
      setError(null);
      setIconPickerOpened(false);
      setIconQuery("");
    }
  }, [opened]);

  const filteredIconNames = CUSTOM_LINK_ICON_NAMES.filter((name) =>
    name.includes(iconQuery.trim().toLowerCase()),
  );

  const handleSubmit = () => {
    const trimmedLabel = label.trim();
    const trimmedUrl = url.trim();

    if (!trimmedLabel) {
      setError(t("Link name is required."));
      return;
    }
    if (!isSafeCustomLinkUrl(trimmedUrl)) {
      setError(t("Enter a valid http(s) URL."));
      return;
    }

    onSubmit({ label: trimmedLabel, url: trimmedUrl, icon });
  };

  const SelectedIcon = getCustomLinkIcon(icon);

  return (
    <Modal opened={opened} onClose={onClose} title={t("Add link")} size="sm">
      <Stack gap="sm">
        <TextInput
          label={t("Link name")}
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
          maxLength={80}
          data-autofocus
        />
        <TextInput
          label={t("URL")}
          placeholder="https://example.com"
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          maxLength={2048}
        />

        <div>
          <Text size="sm" fw={500} mb={4}>
            {t("Icon")}
          </Text>
          <Popover
            opened={iconPickerOpened}
            onChange={setIconPickerOpened}
            position="bottom-start"
            withArrow
          >
            <Popover.Target>
              <ActionIcon
                variant="default"
                size="lg"
                aria-label={t("Select icon")}
                onClick={() => setIconPickerOpened((value) => !value)}
              >
                <SelectedIcon size={20} stroke={2} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown>
              <Stack gap="xs">
                <TextInput
                  size="xs"
                  placeholder={t("Search icons")}
                  value={iconQuery}
                  onChange={(event) =>
                    setIconQuery(event.currentTarget.value)
                  }
                  aria-label={t("Search icons")}
                />
                <ScrollArea.Autosize mah={220} type="auto">
                  <SimpleGrid cols={7} spacing="xs">
                    {filteredIconNames.map((name) => {
                      const OptionIcon = getCustomLinkIcon(name);
                      return (
                        <Tooltip key={name} label={name} withArrow>
                          <ActionIcon
                            variant={name === icon ? "filled" : "subtle"}
                            aria-label={name}
                            onClick={() => {
                              setIcon(name);
                              setIconPickerOpened(false);
                            }}
                          >
                            <OptionIcon size={18} stroke={2} />
                          </ActionIcon>
                        </Tooltip>
                      );
                    })}
                  </SimpleGrid>
                </ScrollArea.Autosize>
              </Stack>
            </Popover.Dropdown>
          </Popover>
        </div>

        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={handleSubmit} loading={isPending}>
            {t("Save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
