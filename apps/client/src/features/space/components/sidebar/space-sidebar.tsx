import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Menu,
  TextInput,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowDown,
  IconDots,
  IconFileDatabase,
  IconFileExport,
  IconHome,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react";
import classes from "./space-sidebar.module.css";
import React from "react";
import { useAtom } from "jotai";
import { treeApiAtom } from "@/features/page/tree/atoms/tree-api-atom.ts";
import { Link, useLocation, useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useDisclosure } from "@mantine/hooks";
import SpaceSettingsModal from "@/features/space/components/settings-modal.tsx";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query.ts";
import { getSpaceUrl } from "@/lib/config.ts";
import SpaceTree from "@/features/page/tree/components/space-tree.tsx";
import { useSpaceAbility } from "@/features/space/permissions/use-space-ability.ts";
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from "@/features/space/permissions/permissions.type.ts";
import PageImportModal from "@/features/page/components/page-import-modal.tsx";
import { useTranslation } from "react-i18next";
import { SwitchSpace } from "./switch-space";
import ExportModal from "@/components/common/export-modal";
import { mobileSidebarAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import { searchSpotlight } from "@/features/search/constants";
import { useGetDatabasesBySpaceQuery } from "@/features/database/queries/database-query.ts";
import { useCreateDatabaseMutation } from "@/features/database/queries/database-query.ts";
import {
  useCreateDatabaseRowMutation,
  useDatabaseRowsQuery,
  useDeleteDatabaseRowMutation,
} from "@/features/database/queries/database-table-query.ts";
import { IDatabase } from "@/features/database/types/database.types";
import { IDatabaseRowWithCells } from "@/features/database/types/database-table.types";
import { notifications } from "@mantine/notifications";

export function SpaceSidebar() {
  const { t } = useTranslation();
  const [tree] = useAtom(treeApiAtom);
  const location = useLocation();
  const [opened, { open: openSettings, close: closeSettings }] =
    useDisclosure(false);
  const [createDatabaseOpened, { open: openCreateDatabase, close: closeCreateDatabase }] =
    useDisclosure(false);
  const [databaseName, setDatabaseName] = React.useState("");
  const [databaseDescription, setDatabaseDescription] = React.useState("");
  const [mobileSidebarOpened] = useAtom(mobileSidebarAtom);
  const toggleMobileSidebar = useToggleSidebar(mobileSidebarAtom);
  const navigate = useNavigate();

  const { spaceSlug } = useParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);
  const { data: databases = [] } = useGetDatabasesBySpaceQuery(space?.id);
  const createDatabaseMutation = useCreateDatabaseMutation(space?.id);

  if (!space) {
    return <></>;
  }

  function handleCreatePage() {
    tree?.create({ parentId: null, type: "internal", index: 0 });
  }

  async function handleCreateDatabase() {
    if (!space?.id || !databaseName.trim()) {
      return;
    }

    try {
      const createdDatabase = await createDatabaseMutation.mutateAsync({
        spaceId: space.id,
        name: databaseName.trim(),
        description: databaseDescription.trim() || undefined,
      });

      setDatabaseName("");
      setDatabaseDescription("");
      closeCreateDatabase();
      notifications.show({ message: t("Database created") });
      navigate(`/s/${spaceSlug}/databases/${createdDatabase.id}`);
    } catch {
      notifications.show({ message: t("Failed to create database"), color: "red" });
    }
  }

  return (
    <>
      <div className={classes.navbar}>
        <div
          className={classes.section}
          style={{
            border: "none",
            marginTop: 2,
            marginBottom: 3,
          }}
        >
          <SwitchSpace
            spaceName={space?.name}
            spaceSlug={space?.slug}
            spaceIcon={space?.logo}
          />
        </div>

        <div className={classes.section}>
          <div className={classes.menuItems}>
            <UnstyledButton
              component={Link}
              to={getSpaceUrl(spaceSlug)}
              className={clsx(
                classes.menu,
                location.pathname.toLowerCase() === getSpaceUrl(spaceSlug)
                  ? classes.activeButton
                  : "",
              )}
            >
              <div className={classes.menuItemInner}>
                <IconHome
                  size={18}
                  className={classes.menuItemIcon}
                  stroke={2}
                />
                <span>{t("Overview")}</span>
              </div>
            </UnstyledButton>

            <UnstyledButton
              className={classes.menu}
              onClick={searchSpotlight.open}
            >
              <div className={classes.menuItemInner}>
                <IconSearch
                  size={18}
                  className={classes.menuItemIcon}
                  stroke={2}
                />
                <span>{t("Search")}</span>
              </div>
            </UnstyledButton>

            <UnstyledButton className={classes.menu} onClick={openSettings}>
              <div className={classes.menuItemInner}>
                <IconSettings
                  size={18}
                  className={classes.menuItemIcon}
                  stroke={2}
                />
                <span>{t("Space settings")}</span>
              </div>
            </UnstyledButton>

            {spaceAbility.can(
              SpaceCaslAction.Manage,
              SpaceCaslSubject.Page,
            ) && (
              <UnstyledButton
                className={classes.menu}
                onClick={() => {
                  handleCreatePage();
                  if (mobileSidebarOpened) {
                    toggleMobileSidebar();
                  }
                }}
              >
                <div className={classes.menuItemInner}>
                  <IconPlus
                    size={18}
                    className={classes.menuItemIcon}
                    stroke={2}
                  />
                  <span>{t("New page")}</span>
                </div>
              </UnstyledButton>
            )}
          </div>
        </div>

        <div className={clsx(classes.section, classes.sectionPages)}>
          <Group className={classes.pagesHeader} justify="space-between">
            <Text size="xs" fw={500} c="dimmed">
              {t("Pages")}
            </Text>

            {spaceAbility.can(
              SpaceCaslAction.Manage,
              SpaceCaslSubject.Page,
            ) && (
              <Group gap="xs">
                <SpaceMenu spaceId={space.id} onSpaceSettings={openSettings} />

                <Tooltip label={t("Create page")} withArrow position="right">
                  <ActionIcon
                    variant="default"
                    size={18}
                    onClick={handleCreatePage}
                    aria-label={t("Create page")}
                  >
                    <IconPlus />
                  </ActionIcon>
                </Tooltip>
              </Group>
            )}
          </Group>

          <div className={classes.pages}>
            <SpaceTree
              spaceId={space.id}
              readOnly={spaceAbility.cannot(
                SpaceCaslAction.Manage,
                SpaceCaslSubject.Page,
              )}
            />
          </div>

          <Group className={classes.pagesHeader} justify="space-between">
            <Text size="xs" fw={500} c="dimmed">
              {t("Databases")}
            </Text>

            {spaceAbility.can(
              SpaceCaslAction.Manage,
              SpaceCaslSubject.Page,
            ) && (
              <Tooltip label={t("Create database")} withArrow position="right">
                <ActionIcon
                  variant="default"
                  size={18}
                  onClick={openCreateDatabase}
                  aria-label={t("Create database")}
                >
                  <IconPlus />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>

          <div className={clsx(classes.pages, classes.databaseList)}>
            {databases.map((database) => (
              <div key={database.id}>
                <UnstyledButton
                  component={Link}
                  to={`/s/${spaceSlug}/databases/${database.id}`}
                  className={clsx(
                    classes.menu,
                    location.pathname.toLowerCase() ===
                      `/s/${spaceSlug}/databases/${database.id}`.toLowerCase()
                      ? classes.activeButton
                      : "",
                  )}
                >
                  <div className={classes.menuItemInner}>
                    <IconFileDatabase
                      size={18}
                      className={classes.menuItemIcon}
                      stroke={2}
                    />
                    <span>{database.name}</span>
                  </div>
                </UnstyledButton>
                <DatabaseRowsTree database={database} spaceSlug={spaceSlug || ''} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <SpaceSettingsModal
        opened={opened}
        onClose={closeSettings}
        spaceId={space?.slug}
      />

      <Modal
        opened={createDatabaseOpened}
        onClose={closeCreateDatabase}
        title={t("Create database")}
        centered
      >
        <TextInput
          label={t("Name")}
          value={databaseName}
          onChange={(event) => setDatabaseName(event.currentTarget.value)}
          placeholder={t("Untitled database")}
          mb="sm"
          autoFocus
        />

        <Textarea
          label={t("Description")}
          value={databaseDescription}
          onChange={(event) => setDatabaseDescription(event.currentTarget.value)}
          placeholder={t("Optional")}
          minRows={2}
        />

        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={closeCreateDatabase}>
            {t("Cancel")}
          </Button>

          <Button
            onClick={handleCreateDatabase}
            loading={createDatabaseMutation.isPending}
            disabled={!databaseName.trim()}
          >
            {t("Create")}
          </Button>
        </Group>
      </Modal>
    </>
  );
}


interface DatabaseRowsTreeProps {
  database: IDatabase;
  spaceSlug: string;
}

function DatabaseRowsTree({ database, spaceSlug }: DatabaseRowsTreeProps) {
  const { t } = useTranslation();
  const { data: rows = [] } = useDatabaseRowsQuery(database.id);
  const createRowMutation = useCreateDatabaseRowMutation(database.id);
  const deleteRowMutation = useDeleteDatabaseRowMutation(database.id);

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const rowsByParentId = React.useMemo(() => {
    const map: Record<string, IDatabaseRowWithCells[]> = {};

    rows.forEach((row) => {
      const parentId = row.page?.parentPageId ?? 'root';
      if (!map[parentId]) {
        map[parentId] = [];
      }
      map[parentId].push(row);
    });

    return map;
  }, [rows]);

  const renderRows = (parentId: string, depth = 0): React.ReactNode => {
    const children = rowsByParentId[parentId] ?? [];

    return children.map((row) => {
      const hasChildren = (rowsByParentId[row.pageId] ?? []).length > 0;
      const isOpen = expanded[row.pageId] ?? true;
      const title = row.page?.title || row.pageTitle || 'untitled';

      return (
        <React.Fragment key={row.pageId}>
          <Group gap={4} wrap="nowrap" style={{ paddingLeft: depth * 12 }}>
            {hasChildren ? (
              <ActionIcon
                variant="subtle"
                size="xs"
                onClick={() =>
                  setExpanded((prev) => ({
                    ...prev,
                    [row.pageId]: !isOpen,
                  }))
                }
                aria-label={t('Toggle row children')}
              >
                {isOpen ? '▾' : '▸'}
              </ActionIcon>
            ) : (
              <div style={{ width: 18 }} />
            )}

            <UnstyledButton component={Link} to={`/s/${spaceSlug}/p/${row.page?.slugId || row.pageId}`} className={classes.menu}>
              <div className={classes.menuItemInner}>
                <span>{title}</span>
              </div>
            </UnstyledButton>

            <ActionIcon
              variant="subtle"
              size="xs"
              onClick={() => createRowMutation.mutate({ parentPageId: row.pageId })}
              aria-label={t('Create row')}
            >
              <IconPlus size={14} />
            </ActionIcon>

            <ActionIcon
              variant="subtle"
              color="red"
              size="xs"
              onClick={() => deleteRowMutation.mutate(row.pageId)}
              aria-label={t('Delete row')}
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Group>

          {hasChildren && isOpen ? renderRows(row.pageId, depth + 1) : null}
        </React.Fragment>
      );
    });
  };

  return (
    <div>
      <Group gap={4} wrap="nowrap">
        <Button
          variant="subtle"
          size="compact-xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => createRowMutation.mutate({})}
        >
          {t('New row')}
        </Button>
      </Group>
      {renderRows('root')}
    </div>
  );
}


interface SpaceMenuProps {
  spaceId: string;
  onSpaceSettings: () => void;
}
function SpaceMenu({ spaceId, onSpaceSettings }: SpaceMenuProps) {
  const { t } = useTranslation();
  const { spaceSlug } = useParams();
  const [importOpened, { open: openImportModal, close: closeImportModal }] =
    useDisclosure(false);
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);

  return (
    <>
      <Menu width={200} shadow="md" withArrow>
        <Menu.Target>
          <Tooltip
            label={t("Import pages & space settings")}
            withArrow
            position="top"
          >
            <ActionIcon
              variant="default"
              size={18}
              aria-label={t("Space menu")}
            >
              <IconDots />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item
            onClick={openImportModal}
            leftSection={<IconArrowDown size={16} />}
          >
            {t("Import pages")}
          </Menu.Item>

          <Menu.Item
            onClick={openExportModal}
            leftSection={<IconFileExport size={16} />}
          >
            {t("Export space")}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            onClick={onSpaceSettings}
            leftSection={<IconSettings size={16} />}
          >
            {t("Space settings")}
          </Menu.Item>

          <Menu.Item
            component={Link}
            to={`/s/${spaceSlug}/trash`}
            leftSection={<IconTrash size={16} />}
          >
            {t("Trash")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <PageImportModal
        spaceId={spaceId}
        open={importOpened}
        onClose={closeImportModal}
      />

      <ExportModal
        type="space"
        id={spaceId}
        open={exportOpened}
        onClose={closeExportModal}
      />
    </>
  );
}
