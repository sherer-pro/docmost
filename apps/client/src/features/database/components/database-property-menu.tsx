import { useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Group,
  Menu,
  Modal,
  Stack,
  TextInput,
} from "@mantine/core";
import { IconDotsVertical, IconPencil } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon";
import { useMenuModalHandoff } from "@/components/common/use-menu-modal-handoff";
import type { IDatabaseProperty } from "../types/database.types";

export function DatabasePropertyMenu({
  property,
  disabled,
  onRename,
  children,
}: {
  property: IDatabaseProperty;
  disabled: boolean;
  onRename: (name: string) => Promise<void>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const handoff = useMenuModalHandoff<"rename">(
    `${property.databaseId}:${property.id}`,
  );
  const modal = handoff.getModalProps("rename");
  const [name, setName] = useState(property.name);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Menu
        position="bottom-end"
        shadow="md"
        withinPortal
        {...handoff.menuProps}
      >
        <Menu.Target>
          <AccessibleActionIcon
            ref={handoff.triggerRef}
            variant="subtle"
            label={t("Property actions")}
            tooltip={false}
          >
            <IconDotsVertical size={14} />
          </AccessibleActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconPencil size={14} />}
            disabled={disabled}
            onClick={() => {
              setName(property.name);
              setFailed(false);
              handoff.openModal("rename");
            }}
          >
            {t("Rename")}
          </Menu.Item>
          {children}
        </Menu.Dropdown>
      </Menu>
      <Modal
        opened={modal.open}
        onClose={() => {
          if (!pending) modal.onClose();
        }}
        title={t("Rename")}
        returnFocus={modal.returnFocus}
        onExitTransitionEnd={modal.onExitTransitionEnd}
        closeButtonProps={{ disabled: pending, "aria-label": t("Close") }}
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending || disabled || !name.trim()) return;
            setPending(true);
            setFailed(false);
            try {
              await onRename(name);
              modal.onClose();
            } catch {
              setFailed(true);
            } finally {
              setPending(false);
            }
          }}
        >
          <Stack>
            <TextInput
              data-autofocus
              label={t("Property name")}
              value={name}
              disabled={pending}
              error={failed ? t("dbTable.renameFailed") : undefined}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            {failed && (
              <Alert color="red" role="alert">
                {t("dbTable.renameFailed")}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={pending}
                onClick={modal.onClose}
              >
                {t("Cancel")}
              </Button>
              <Button
                type="submit"
                loading={pending}
                disabled={disabled || !name.trim()}
              >
                {t("Save")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
