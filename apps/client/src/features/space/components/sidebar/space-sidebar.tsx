import {
  ActionIcon,
  Group,
  Menu,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowDown,
  IconBook2,
  IconChevronsDown,
  IconChevronsUp,
  IconDots,
  IconExternalLink,
  IconHexagonPlus,
  IconFileExport,
  IconHome,
  IconPlus,
  IconSquareRoundedPlus,
  IconSettings,
  IconTemplate,
  IconTrash,
} from "@tabler/icons-react";
import classes from "./space-sidebar.module.css";
import React, { useRef, useState } from "react";
import { useAtom } from "jotai";
import { treeApiAtom } from "@/features/page/tree/atoms/tree-api-atom.ts";
import { Link, useLocation, useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useDisclosure } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import SpaceSettingsModal from "@/features/space/components/settings-modal.tsx";
import {
  useGetSpaceBySlugQuery,
  useUpdateSpaceMutation,
} from "@/features/space/queries/space-query.ts";
import { getSpaceUrl } from "@/lib/config.ts";
import SpaceTree, {
  type SpaceTreeBulkState,
  type SpaceTreeHandle,
} from "@/features/page/tree/components/space-tree.tsx";
import { useSpaceAbility } from "@/features/space/permissions/use-space-ability.ts";
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from "@/features/space/permissions/permissions.type.ts";
import PageImportModal from "@/features/page/components/page-import-modal.tsx";
import { useTranslation } from "react-i18next";
import { SwitchSpace } from "./switch-space";
import ExportModal from "@/components/common/export-modal";
import { useCreateDatabaseMutation } from "@/features/database/queries/database-query.ts";
import { notifications } from "@mantine/notifications";
import { queryClient } from "@/lib/query-client.ts";
import { getPageById } from "@/features/page/services/page-service.ts";
import { buildDatabaseUrl } from "@/features/page/page.utils.ts";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { buildPageEditModeByPageId } from "@/features/user/utils/page-edit-mode.ts";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import {
  insertOrUpdateTreeNode,
  mapDatabaseToTreeNode,
} from "@/features/page/tree/utils";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import { PAGE_QUERY_KEYS } from "@/features/page/queries/query-keys.ts";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import { hasFullSpaceAccess } from "@/features/space/permissions/export-access.ts";
import { getCustomLinkIcon } from "@/features/space/components/custom-links/custom-link-icons.ts";
import { isSafeCustomLinkUrl } from "@/features/space/components/custom-links/custom-link-utils.ts";
import CustomLinkFormModal, {
  type CustomLinkFormValue,
} from "@/features/space/components/custom-links/custom-link-form-modal.tsx";
import type { ISpaceCustomLink } from "@/features/space/types/space.types.ts";
import { usePageTemplateCapabilitiesQuery } from "@/features/page-template/queries/page-template-query";

const PAGE_TREE_ACTION_SIZE = 24;
const PAGE_TREE_ACTION_ICON_SIZE = 16;

const INITIAL_TREE_BULK_STATE: SpaceTreeBulkState = {
  ready: false,
  busy: false,
  canToggle: false,
  allExpanded: false,
};

export function SpaceSidebar() {
  const { t } = useTranslation();
  const [tree] = useAtom(treeApiAtom);
  const spaceTreeRef = useRef<SpaceTreeHandle>(null);
  const [treeBulkState, setTreeBulkState] = useState<SpaceTreeBulkState>(
    INITIAL_TREE_BULK_STATE,
  );
  const location = useLocation();
  const [opened, { open: openSettings, close: closeSettings }] =
    useDisclosure(false);
  const [
    customLinkModalOpened,
    { open: openCustomLinkModal, close: closeCustomLinkModal },
  ] = useDisclosure(false);
  const [user, setUser] = useAtom(userAtom);
  const [treeData, setTreeData] = useAtom(treeDataAtom);
  const emit = useQueryEmit();
  const navigate = useNavigate();
  const { mutate: updateSpace, isPending: isUpdatingCustomLinks } =
    useUpdateSpaceMutation();

  const { spaceSlug } = useParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const templateCapabilitiesQuery = usePageTemplateCapabilitiesQuery(space?.id);
  const templateCapabilities = templateCapabilitiesQuery.data;

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);
  const canManageSpacePages = spaceAbility.can(
    SpaceCaslAction.Manage,
    SpaceCaslSubject.Page,
  );
  const canManageSpaceSettings = hasFullSpaceAccess({
    workspaceRole: user?.role,
    spaceRole: space?.membership?.role,
  });
  const canExportSpace = canManageSpaceSettings;
  const createDatabaseMutation = useCreateDatabaseMutation(space?.id);
  const showTemplateCatalog =
    templateCapabilitiesQuery.isSuccess &&
    !templateCapabilitiesQuery.isError &&
    templateCapabilities?.enabled === true &&
    (templateCapabilities.createTemplate ||
      templateCapabilities.manageTemplate ||
      templateCapabilities.useRegular ||
      templateCapabilities.useSynced);

  if (!space) {
    return <></>;
  }

  const customLinks = space.settings?.customLinks?.links ?? [];

  function persistCustomLinks(nextLinks: ISpaceCustomLink[]) {
    updateSpace(
      { spaceId: space.id, customLinks: { links: nextLinks } },
      {
        onSuccess: (updatedSpace) => {
          // Keep the slug-keyed sidebar cache in sync with the server response.
          queryClient.setQueryData(
            ["space", spaceSlug],
            (cached: typeof updatedSpace) =>
              cached ? { ...cached, ...updatedSpace } : updatedSpace,
          );
        },
      },
    );
  }

  function handleAddCustomLink(value: CustomLinkFormValue) {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    persistCustomLinks([...customLinks, { id, ...value }]);
    closeCustomLinkModal();
  }

  function handleDeleteCustomLink(link: ISpaceCustomLink) {
    modals.openConfirmModal({
      title: t("Delete link"),
      children: (
        <Text size="sm">
          {t("Delete the link {{name}}?", { name: link.label })}
        </Text>
      ),
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () =>
        persistCustomLinks(customLinks.filter((item) => item.id !== link.id)),
    });
  }

  function handleCreatePage() {
    tree?.create({ parentId: null, type: "internal", index: 0 });
  }

  async function handleCreateDatabase() {
    if (!space?.id || createDatabaseMutation.isPending) {
      return;
    }

    try {
      const createdDatabase = await createDatabaseMutation.mutateAsync({
        spaceId: space.id,
      });

      notifications.show({ message: t("Database created") });

      // After creating the database, open only the canonical URL of the /s/:space/db/:slug format.
      if (!createdDatabase.pageId) {
        notifications.show({
          message: t("Failed to create database"),
          color: "red",
        });
        return;
      }

      if (user) {
        setUser({
          ...user,
          settings: {
            ...user.settings,
            preferences: {
              ...user.settings?.preferences,
              pageEditModeByPageId: buildPageEditModeByPageId(
                user.settings?.preferences?.pageEditModeByPageId,
                createdDatabase.pageId,
                PageEditMode.Edit,
              ),
            },
          },
        });
      }

      const databasePage = await getPageById({
        pageId: createdDatabase.pageId,
      });
      queryClient.setQueryData(
        PAGE_QUERY_KEYS.page(databasePage.id),
        databasePage,
      );
      queryClient.setQueryData(
        PAGE_QUERY_KEYS.page(databasePage.slugId),
        databasePage,
      );

      const treeNodeData = mapDatabaseToTreeNode(createdDatabase, databasePage);
      const {
        tree: nextTreeData,
        index: insertionIndex,
        inserted,
      } = insertOrUpdateTreeNode(treeData, treeNodeData);
      setTreeData(nextTreeData);

      if (treeNodeData.parentPageId) {
        tree?.open(treeNodeData.parentPageId);
      }

      if (inserted) {
        setTimeout(() => {
          emit({
            operation: "addTreeNode",
            spaceId: treeNodeData.spaceId,
            payload: {
              parentId: treeNodeData.parentPageId,
              index: insertionIndex,
              node: treeNodeData,
            },
          });
        }, 50);
      }

      navigate(
        buildDatabaseUrl(spaceSlug, databasePage.slugId, databasePage.title),
      );
    } catch {
      notifications.show({
        message: t("Failed to create database"),
        color: "red",
      });
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

            {space.settings?.dictionary?.enabled === true && (
              <UnstyledButton
                component={Link}
                to={`/s/${spaceSlug}/dictionary`}
                className={clsx(
                  classes.menu,
                  location.pathname.toLowerCase() ===
                    `/s/${spaceSlug}/dictionary`.toLowerCase()
                    ? classes.activeButton
                    : "",
                )}
              >
                <div className={classes.menuItemInner}>
                  <IconBook2
                    size={18}
                    className={classes.menuItemIcon}
                    stroke={2}
                  />
                  <span>{t("Dictionary")}</span>
                </div>
              </UnstyledButton>
            )}

            {showTemplateCatalog && (
              <UnstyledButton
                component={Link}
                to={`/s/${spaceSlug}/templates`}
                className={clsx(
                  classes.menu,
                  location.pathname.toLowerCase() ===
                    `/s/${spaceSlug}/templates`.toLowerCase()
                    ? classes.activeButton
                    : "",
                )}
              >
                <div className={classes.menuItemInner}>
                  <IconTemplate
                    size={18}
                    className={classes.menuItemIcon}
                    stroke={2}
                  />
                  <span>{t("Templates")}</span>
                </div>
              </UnstyledButton>
            )}

            {customLinks
              .filter((link) => isSafeCustomLinkUrl(link.url))
              .map((link) => {
                const LinkIcon = getCustomLinkIcon(link.icon);
                return (
                  <div key={link.id} className={classes.customLinkRow}>
                    <UnstyledButton
                      component="a"
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={classes.menu}
                    >
                      <div className={classes.menuItemInner}>
                        <LinkIcon
                          size={18}
                          className={classes.menuItemIcon}
                          stroke={2}
                        />
                        <span className={classes.menuItemLabel}>
                          {link.label}
                        </span>
                        <IconExternalLink
                          className={classes.externalLinkIcon}
                          size={14}
                          stroke={2}
                          aria-hidden="true"
                        />
                      </div>
                    </UnstyledButton>

                    {canManageSpaceSettings && (
                      <AccessibleActionIcon
                        className={classes.customLinkDelete}
                        variant="subtle"
                        color="red"
                        size={22}
                        label={t("Delete link")}
                        tooltipProps={{ withArrow: true, position: "right" }}
                        disabled={isUpdatingCustomLinks}
                        onClick={() => handleDeleteCustomLink(link)}
                      >
                        <IconTrash size={16} />
                      </AccessibleActionIcon>
                    )}
                  </div>
                );
              })}

            {canManageSpaceSettings && (
              <UnstyledButton
                className={clsx(classes.menu, classes.customLinkAdd)}
                onClick={openCustomLinkModal}
              >
                <div className={classes.menuItemInner}>
                  <IconPlus
                    size={18}
                    className={classes.menuItemIcon}
                    stroke={2}
                  />
                  <span>{t("Add link")}</span>
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

            <Group gap="xs">
              <AccessibleActionIcon
                className={classes.pagesHeaderAction}
                variant="default"
                size={PAGE_TREE_ACTION_SIZE}
                minTargetSize={PAGE_TREE_ACTION_SIZE}
                label={
                  treeBulkState.busy
                    ? t("Loading...")
                    : treeBulkState.allExpanded
                      ? t("Collapse all")
                      : t("Expand all")
                }
                tooltipProps={{ withArrow: true, position: "right" }}
                loading={treeBulkState.busy}
                disabled={!treeBulkState.ready || !treeBulkState.canToggle}
                onClick={() => spaceTreeRef.current?.toggleAll()}
              >
                {treeBulkState.allExpanded ? (
                  <IconChevronsUp size={PAGE_TREE_ACTION_ICON_SIZE} />
                ) : (
                  <IconChevronsDown size={PAGE_TREE_ACTION_ICON_SIZE} />
                )}
              </AccessibleActionIcon>

              {(canManageSpacePages ||
                canManageSpaceSettings ||
                canExportSpace) && (
                <SpaceMenu
                  spaceId={space.id}
                  onSpaceSettings={openSettings}
                  canManagePages={canManageSpacePages}
                  canManageSpaceSettings={canManageSpaceSettings}
                  canExportSpace={canExportSpace}
                />
              )}

              {canManageSpacePages && (
                <>
                  <Tooltip
                    label={t("Create database")}
                    withArrow
                    position="right"
                  >
                    <ActionIcon
                      variant="default"
                      size={PAGE_TREE_ACTION_SIZE}
                      onClick={handleCreateDatabase}
                      disabled={createDatabaseMutation.isPending}
                      aria-label={t("Create database")}
                    >
                      <IconHexagonPlus size={PAGE_TREE_ACTION_ICON_SIZE} />
                    </ActionIcon>
                  </Tooltip>

                  <Tooltip label={t("Create page")} withArrow position="right">
                    <ActionIcon
                      variant="default"
                      size={PAGE_TREE_ACTION_SIZE}
                      onClick={handleCreatePage}
                      aria-label={t("Create page")}
                    >
                      <IconSquareRoundedPlus
                        size={PAGE_TREE_ACTION_ICON_SIZE}
                      />
                    </ActionIcon>
                  </Tooltip>
                </>
              )}
            </Group>
          </Group>

          <div className={classes.pages}>
            <SpaceTree
              ref={spaceTreeRef}
              spaceId={space.id}
              onBulkStateChange={setTreeBulkState}
              readOnly={!canManageSpacePages}
            />
          </div>
        </div>
      </div>

      <SpaceSettingsModal
        opened={opened}
        onClose={closeSettings}
        spaceId={space?.slug}
      />

      <CustomLinkFormModal
        opened={customLinkModalOpened}
        onClose={closeCustomLinkModal}
        onSubmit={handleAddCustomLink}
        isPending={isUpdatingCustomLinks}
      />
    </>
  );
}

interface SpaceMenuProps {
  spaceId: string;
  onSpaceSettings: () => void;
  canManagePages: boolean;
  canManageSpaceSettings: boolean;
  canExportSpace: boolean;
}
function SpaceMenu({
  spaceId,
  onSpaceSettings,
  canManagePages,
  canManageSpaceSettings,
  canExportSpace,
}: SpaceMenuProps) {
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
          <Tooltip label={t("Space menu")} withArrow position="top">
            <ActionIcon
              variant="default"
              size={PAGE_TREE_ACTION_SIZE}
              aria-label={t("Space menu")}
            >
              <IconDots size={PAGE_TREE_ACTION_ICON_SIZE} />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>

        <Menu.Dropdown>
          {canManagePages && (
            <Menu.Item
              onClick={openImportModal}
              leftSection={<IconArrowDown size={16} />}
            >
              {t("Import pages")}
            </Menu.Item>
          )}

          {canExportSpace && (
            <Menu.Item
              onClick={openExportModal}
              leftSection={<IconFileExport size={16} />}
            >
              {t("Export space")}
            </Menu.Item>
          )}

          {(canManageSpaceSettings || canManagePages) && <Menu.Divider />}

          {canManageSpaceSettings && (
            <Menu.Item
              onClick={onSpaceSettings}
              leftSection={<IconSettings size={16} />}
            >
              {t("Space settings")}
            </Menu.Item>
          )}

          {canManagePages && (
            <Menu.Item
              component={Link}
              to={`/s/${spaceSlug}/trash`}
              leftSection={<IconTrash size={16} />}
            >
              {t("Trash")}
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>

      {canManagePages && (
        <PageImportModal
          spaceId={spaceId}
          open={importOpened}
          onClose={closeImportModal}
        />
      )}

      {canExportSpace && (
        <ExportModal
          type="space"
          id={spaceId}
          open={exportOpened}
          onClose={closeExportModal}
        />
      )}
    </>
  );
}
