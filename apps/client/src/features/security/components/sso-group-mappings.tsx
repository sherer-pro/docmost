import { useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  useCreateSsoGroupMappingMutation,
  useDeleteSsoGroupMappingMutation,
  useSsoGroupMappings,
} from "@/features/security/queries/security-query.ts";
import { useGetGroupsQuery } from "@/features/group/queries/group-query.ts";

interface SsoGroupMappingsProps {
  providerId: string;
}

export function SsoGroupMappings({ providerId }: SsoGroupMappingsProps) {
  const { t } = useTranslation();
  const { data: mappings, isLoading } = useSsoGroupMappings(providerId);
  const { data: groups } = useGetGroupsQuery({ limit: 100 });
  const createMapping = useCreateSsoGroupMappingMutation();
  const deleteMapping = useDeleteSsoGroupMappingMutation();
  const [externalGroupId, setExternalGroupId] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);

  const groupOptions = (groups?.items ?? [])
    .filter((group) => !group.isDefault)
    .map((group) => ({ value: group.id, label: group.name }));

  const handleAdd = async () => {
    if (!externalGroupId.trim() || !groupId) {
      return;
    }

    await createMapping.mutateAsync({
      providerId,
      externalGroupId: externalGroupId.trim(),
      groupId,
    });
    setExternalGroupId("");
    setGroupId(null);
  };

  return (
    <Stack gap="xs" mt="md">
      <div>
        <Text size="sm" fw={500}>
          {t("Group mappings")}
        </Text>
        <Text size="xs" c="dimmed">
          {t(
            "Only external groups listed here are synced. Memberships this provider did not create are never removed.",
          )}
        </Text>
      </div>

      {!isLoading && mappings?.items?.length > 0 && (
        <Table verticalSpacing="xs" fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("External group")}</Table.Th>
              <Table.Th>{t("Workspace group")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {mappings.items.map((mapping) => (
              <Table.Tr key={mapping.id}>
                <Table.Td style={{ wordBreak: "break-all" }}>
                  {mapping.externalGroupId}
                </Table.Td>
                <Table.Td>{mapping.groupName}</Table.Td>
                <Table.Td>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={t("Delete")}
                    onClick={() =>
                      deleteMapping.mutate({
                        mappingId: mapping.id,
                        providerId,
                      })
                    }
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Group align="flex-end" gap="xs" wrap="nowrap">
        <TextInput
          style={{ flex: 1 }}
          label={t("External group")}
          placeholder={t("Group name or ID from the provider")}
          value={externalGroupId}
          onChange={(event) => setExternalGroupId(event.currentTarget.value)}
        />
        <Select
          style={{ flex: 1 }}
          label={t("Workspace group")}
          placeholder={t("Select group")}
          data={groupOptions}
          value={groupId}
          onChange={setGroupId}
          searchable
        />
        <Button
          onClick={handleAdd}
          loading={createMapping.isPending}
          disabled={!externalGroupId.trim() || !groupId}
        >
          {t("Add")}
        </Button>
      </Group>
    </Stack>
  );
}
