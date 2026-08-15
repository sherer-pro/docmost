import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Badge,
  Button,
  Center,
  Divider,
  Drawer,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconArchive,
  IconArchiveOff,
  IconChevronRight,
  IconDots,
  IconEdit,
  IconFile,
  IconFilePlus,
  IconFolder,
  IconHistory,
  IconLink,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTemplate,
  IconVersions,
} from "@tabler/icons-react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { PageFrame, SectionHeader } from "@/components/ui/page-frame";
import { TemplateUseModal } from "@/features/page-template/components/page-template-picker";
import {
  archivePageTemplate,
  createPageTemplate,
  discoverPageTemplates,
  getPageTemplateDestinations,
  getPageTemplateRevisions,
  getPageTemplateSyncRuns,
  getPageTemplateUsages,
  isCollaborationUnavailable,
  restorePageTemplate,
} from "@/features/page-template/services/page-template-api";
import { usePageTemplateCapabilitiesQuery } from "@/features/page-template/queries/page-template-query";
import type {
  PageTemplateArchiveState,
  PageTemplateDestination,
  PageTemplateDiscoveryItem,
  PageTemplateRevisionPage,
  PageTemplateUsage,
  PageTemplateUsagePage,
  TemplateKind,
  TemplateSyncRun,
} from "@/features/page-template/types/page-template.types";
import {
  getTemplateSyncErrorLabel,
  getTemplateSyncRunLabel,
} from "@/features/page/components/template-sync-status";
import { buildPageUrl } from "@/features/page/page.utils";
import { invalidateOnCreatePage } from "@/features/page/queries/page-query";
import { getPageById } from "@/features/page/services/page-service";
import type { IPage } from "@/features/page/types/page.types";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query";
import { getAppName } from "@/lib/config";
import classes from "@/features/page-template/components/page-template-catalog.module.css";

const PAGE_SIZE = 20;
type CatalogTab = "all" | TemplateKind;
type SourceMode = "blank" | "page";

function errorMessage(error: any, fallback: string): string {
  const message = error?.response?.data?.message;
  return typeof message === "string" ? message : fallback;
}

function mergeById<T extends { id: string }>(current: T[], next: T[]) {
  const byId = new Map(current.map((item) => [item.id, item]));
  next.forEach((item) => byId.set(item.id, item));
  return [...byId.values()];
}

function mergeUsagesByPageId(
  current: PageTemplateUsage[],
  next: PageTemplateUsage[],
) {
  const byPageId = new Map(current.map((item) => [item.childPageId, item]));
  next.forEach((item) => byPageId.set(item.childPageId, item));
  return [...byPageId.values()];
}

function parsePageContent(content: unknown): unknown {
  if (typeof content !== "string") return content;
  try {
    return JSON.parse(content);
  } catch {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
}

function TemplateContentPreview({
  content,
  label,
}: {
  content: unknown;
  label: string;
}) {
  const { t } = useTranslation();
  const lines = previewContentLines(content);

  return (
    <Paper
      withBorder
      role="region"
      aria-label={label}
      className={classes.contentPreview}
    >
      {lines.length > 0 ? (
        <Stack gap="xs">
          {lines.slice(0, 12).map((line) => (
            <Text key={line.key} size="sm" lineClamp={3}>
              {line.label && (
                <Text component="span" fw={600} inherit>
                  {line.label}:{" "}
                </Text>
              )}
              {line.text}
            </Text>
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          {t("page.access.state.empty")}
        </Text>
      )}
    </Paper>
  );
}

function previewContentLines(content: unknown): Array<{
  key: string;
  label?: string;
  text: string;
}> {
  const document = asPreviewNode(content);
  const nodes = Array.isArray(document?.content) ? document.content : [];
  return nodes.flatMap((value, index) => {
    const node = asPreviewNode(value);
    if (!node) return [];
    const text = previewNodeText(node).replace(/\s+/g, " ").trim();
    if (!text) return [];
    const attrs = asPreviewNode(node.attrs);
    const fieldId = typeof attrs?.fieldId === "string" ? attrs.fieldId : null;
    const blockId =
      typeof attrs?.templateBlockId === "string" ? attrs.templateBlockId : null;
    return [
      {
        key: fieldId ?? blockId ?? `${node.type ?? "block"}-${index}`,
        label:
          node.type === "templateField" && typeof attrs?.label === "string"
            ? attrs.label
            : undefined,
        text,
      },
    ];
  });
}

function previewNodeText(node: Record<string, unknown>): string {
  if (typeof node.text === "string") return node.text;
  if (node.type === "hardBreak") return " ";
  return Array.isArray(node.content)
    ? node.content
        .map(asPreviewNode)
        .filter((child): child is Record<string, unknown> => Boolean(child))
        .map(previewNodeText)
        .join(" ")
    : "";
}

function asPreviewNode(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export default function SpaceTemplates() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 48em)");
  const { spaceSlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const capabilitiesQuery = usePageTemplateCapabilitiesQuery(space?.id);
  const capabilities = capabilitiesQuery.data;
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 200);
  const [tab, setTab] = useState<CatalogTab>("all");
  const [archiveState, setArchiveState] =
    useState<PageTemplateArchiveState>("active");
  const [items, setItems] = useState<PageTemplateDiscoveryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [wizardOpened, setWizardOpened] = useState(
    Boolean(searchParams.get("sourcePageId")),
  );
  const [selectedTemplate, setSelectedTemplate] =
    useState<PageTemplateDiscoveryItem | null>(null);
  const [useTemplate, setUseTemplate] =
    useState<PageTemplateDiscoveryItem | null>(null);
  const [archiveCandidate, setArchiveCandidate] =
    useState<PageTemplateDiscoveryItem | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const requestIdRef = useRef(0);

  const loadTemplates = useCallback(
    async (cursor?: string) => {
      if (!space?.id) return;
      const append = Boolean(cursor);
      const requestId = ++requestIdRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setLoadingMore(false);
      }
      if (!append) setLoadError(false);
      try {
        const result = await discoverPageTemplates({
          spaceId: space.id,
          query: debouncedQuery || undefined,
          kind: tab === "all" ? undefined : tab,
          archiveState,
          cursor,
          limit: PAGE_SIZE,
        });
        if (requestId !== requestIdRef.current) return;
        setItems((current) =>
          append ? mergeById(current, result.items) : result.items,
        );
        setNextCursor(result.nextCursor);
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        if (append) {
          notifications.show({
            color: "red",
            message: errorMessage(error, t("Could not load more templates.")),
          });
        } else {
          setItems([]);
          setNextCursor(null);
          setLoadError(true);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          append ? setLoadingMore(false) : setLoading(false);
        }
      }
    },
    [archiveState, debouncedQuery, space?.id, t, tab],
  );

  useEffect(() => {
    setSelectedTemplate(null);
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (searchParams.get("sourcePageId")) setWizardOpened(true);
  }, [searchParams]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language],
  );

  const templateUrl = (template: PageTemplateDiscoveryItem) =>
    buildPageUrl(
      template.spaceSlug,
      template.slugId,
      template.title ?? undefined,
    );

  const refresh = () => {
    void capabilitiesQuery.refetch();
    void loadTemplates();
  };

  const restoreTemplate = async (template: PageTemplateDiscoveryItem) => {
    setArchivePending(true);
    try {
      await restorePageTemplate(template.id);
      setItems((current) => current.filter((item) => item.id !== template.id));
      setSelectedTemplate(null);
      notifications.show({ message: t("Updated successfully") });
    } catch (error) {
      notifications.show({
        color: "red",
        message: errorMessage(error, t("Could not update template.")),
      });
    } finally {
      setArchivePending(false);
    }
  };

  const archiveTemplate = async () => {
    if (!archiveCandidate) return;
    setArchivePending(true);
    try {
      await archivePageTemplate(archiveCandidate.id);
      setItems((current) =>
        current.filter((item) => item.id !== archiveCandidate.id),
      );
      if (selectedTemplate?.id === archiveCandidate.id) {
        setSelectedTemplate(null);
      }
      setArchiveCandidate(null);
      notifications.show({ message: t("Template archived") });
    } catch (error) {
      notifications.show({
        color: "red",
        message: errorMessage(error, t("Could not archive template.")),
      });
    } finally {
      setArchivePending(false);
    }
  };

  const catalogueUnavailable = loadError || capabilitiesQuery.isError;

  return (
    <>
      <Helmet>
        <title>
          {t("Templates")} - {getAppName()}
        </title>
      </Helmet>
      <PageFrame size="wide" className={classes.frame}>
        <SectionHeader
          title={t("Templates")}
          description={t("Create and reuse pages within this space.")}
          actions={
            capabilities?.createTemplate ? (
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={() => setWizardOpened(true)}
              >
                {t("Create template")}
              </Button>
            ) : undefined
          }
          divider
        />

        <Stack gap="md">
          <div className={classes.toolbar}>
            <SegmentedControl
              className={classes.desktopKindFilter}
              value={tab}
              onChange={(value) => setTab(value as CatalogTab)}
              data={[
                { value: "all", label: t("All") },
                { value: "regular", label: t("Independent copy") },
                {
                  value: "synced",
                  label: t("Linked page"),
                },
              ]}
            />
            <Select
              className={classes.mobileKindFilter}
              value={tab}
              onChange={(value) => setTab((value ?? "all") as CatalogTab)}
              aria-label={t("Templates")}
              allowDeselect={false}
              data={[
                { value: "all", label: t("All") },
                { value: "regular", label: t("Independent copy") },
                {
                  value: "synced",
                  label: t("Linked page"),
                },
              ]}
            />
            <SegmentedControl
              className={classes.desktopArchiveFilter}
              value={archiveState}
              onChange={(value) =>
                setArchiveState(value as PageTemplateArchiveState)
              }
              data={[
                { value: "active", label: t("Active") },
                { value: "archived", label: t("Archived") },
              ]}
            />
            <Select
              className={classes.mobileArchiveFilter}
              value={archiveState}
              onChange={(value) =>
                setArchiveState((value ?? "active") as PageTemplateArchiveState)
              }
              aria-label={t("Archived")}
              allowDeselect={false}
              data={[
                { value: "active", label: t("Active") },
                { value: "archived", label: t("Archived") },
              ]}
            />
          </div>

          <TextInput
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("Search templates")}
            leftSection={<IconSearch size={16} />}
            aria-label={t("Search templates")}
          />

          {loading || capabilitiesQuery.isLoading ? (
            <Center py={72} role="status">
              <Loader size="sm" />
            </Center>
          ) : catalogueUnavailable ? (
            <EmptyState
              icon={IconAlertCircle}
              title={t("Could not load templates")}
              description={t("Try loading the template list again.")}
              action={
                <Button
                  variant="light"
                  leftSection={<IconRefresh size={16} />}
                  onClick={refresh}
                >
                  {t("Retry")}
                </Button>
              }
            />
          ) : capabilities && !capabilities.enabled ? (
            <EmptyState
              icon={IconTemplate}
              title={t("Templates are disabled")}
              description={t("Templates are disabled for this space.")}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={archiveState === "archived" ? IconArchive : IconTemplate}
              title={
                debouncedQuery
                  ? t("No matching templates")
                  : t("No templates yet")
              }
              description={
                debouncedQuery
                  ? t("Try a different search term.")
                  : t("Create a template to reuse its content in this space.")
              }
              action={
                nextCursor ? (
                  <Button
                    variant="light"
                    loading={loadingMore}
                    onClick={() => void loadTemplates(nextCursor)}
                  >
                    {t("Load more")}
                  </Button>
                ) : !debouncedQuery &&
                  archiveState === "active" &&
                  capabilities?.createTemplate ? (
                  <Button
                    variant="light"
                    leftSection={<IconPlus size={16} />}
                    onClick={() => setWizardOpened(true)}
                  >
                    {t("Create template")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Stack gap="sm">
              <div className={classes.list}>
                {items.map((template) => (
                  <TemplateCatalogRow
                    key={template.id}
                    template={template}
                    date={dateFormatter.format(new Date(template.updatedAt))}
                    onOpen={() => setSelectedTemplate(template)}
                    onUse={() => setUseTemplate(template)}
                    onArchive={() => setArchiveCandidate(template)}
                    onRestore={() => void restoreTemplate(template)}
                  />
                ))}
              </div>
              {nextCursor && (
                <Button
                  variant="subtle"
                  loading={loadingMore}
                  onClick={() => void loadTemplates(nextCursor)}
                >
                  {t("Load more")}
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </PageFrame>

      {space?.id && (
        <CreateTemplateWizard
          opened={
            wizardOpened &&
            capabilitiesQuery.isSuccess &&
            !capabilitiesQuery.isError &&
            capabilities?.createTemplate === true
          }
          spaceId={space.id}
          initialSourcePageId={searchParams.get("sourcePageId") ?? undefined}
          onClose={() => {
            setWizardOpened(false);
            if (searchParams.has("sourcePageId")) {
              const next = new URLSearchParams(searchParams);
              next.delete("sourcePageId");
              setSearchParams(next, { replace: true });
            }
          }}
          onCreated={(page) => {
            invalidateOnCreatePage(page);
            setWizardOpened(false);
            navigate(
              buildPageUrl(space.slug, page.slugId, page.title ?? undefined),
            );
          }}
        />
      )}

      {space?.id && (
        <TemplateUseModal
          opened={Boolean(useTemplate)}
          spaceId={space.id}
          initialTemplate={useTemplate}
          onClose={() => setUseTemplate(null)}
          onCreated={(page) => {
            invalidateOnCreatePage(page);
            setUseTemplate(null);
            navigate(
              buildPageUrl(space.slug, page.slugId, page.title ?? undefined),
            );
          }}
        />
      )}

      <TemplateDetailsDrawer
        template={selectedTemplate}
        opened={Boolean(selectedTemplate)}
        mobile={Boolean(isMobile)}
        dateFormatter={dateFormatter}
        onClose={() => setSelectedTemplate(null)}
        onUse={(template) => {
          setSelectedTemplate(null);
          setUseTemplate(template);
        }}
        onArchive={(template) => {
          setSelectedTemplate(null);
          setArchiveCandidate(template);
        }}
        onRestore={(template) => void restoreTemplate(template)}
        templateUrl={selectedTemplate ? templateUrl(selectedTemplate) : "#"}
        actionPending={archivePending}
        returnFocus={!useTemplate && !archiveCandidate}
      />

      <Modal
        opened={Boolean(archiveCandidate)}
        onClose={() => !archivePending && setArchiveCandidate(null)}
        title={t("Archive template")}
        centered
        closeButtonProps={{ "aria-label": t("Close") }}
      >
        <Stack>
          <Alert color="orange" icon={<IconArchive size={18} />}>
            {t(
              "The template will disappear from the catalog. Existing linked pages will keep their last published content.",
            )}
          </Alert>
          <Text fw={600}>{archiveCandidate?.title || t("Untitled")}</Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={archivePending}
              onClick={() => setArchiveCandidate(null)}
            >
              {t("Cancel")}
            </Button>
            <Button
              color="red"
              loading={archivePending}
              onClick={() => void archiveTemplate()}
            >
              {t("Archive template")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export function TemplateCatalogRow({
  template,
  date,
  onOpen,
  onUse,
  onArchive,
  onRestore,
}: {
  template: PageTemplateDiscoveryItem;
  date: string;
  onOpen: () => void;
  onUse: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const { t } = useTranslation();
  const linked = template.kind === "synced";
  return (
    <div className={classes.row}>
      <UnstyledButton className={classes.rowMain} onClick={onOpen}>
        <Text className={classes.templateIcon} aria-hidden>
          {template.icon || <IconTemplate size={19} />}
        </Text>
        <div className={classes.rowContent}>
          <Group gap="xs" wrap="wrap">
            <Text fw={600} lineClamp={1} className={classes.rowTitle}>
              {template.title || t("Untitled")}
            </Text>
            <Badge
              className={classes.accessibleBadge}
              size="xs"
              variant="light"
              color={linked ? "teal" : "gray"}
            >
              {linked ? t("Linked page") : t("Independent copy")}
            </Badge>
            {template.archiveState === "archived" && (
              <Badge
                className={classes.accessibleBadge}
                size="xs"
                variant="light"
                color="orange"
              >
                {t("Archived")}
              </Badge>
            )}
          </Group>
          <Group gap={6} wrap="wrap" mt={3}>
            <Text size="xs" c="dimmed">
              {t("Updated {{date}}", { date })}
            </Text>
            <Text size="xs" c="dimmed" aria-hidden>
              ·
            </Text>
            <Text size="xs" c="dimmed">
              {t("Uses: {{count}}", { count: template.usageCount })}
            </Text>
            {linked && (
              <>
                <Text size="xs" c="dimmed" aria-hidden>
                  ·
                </Text>
                <Text size="xs" c="dimmed">
                  {template.publishedRevision
                    ? t("Published v{{version}}", {
                        version: template.publishedRevision,
                      })
                    : t("Not published")}
                </Text>
              </>
            )}
            {template.failedInstanceCount > 0 && (
              <Badge
                className={classes.accessibleBadge}
                size="xs"
                variant="light"
                color="red"
              >
                {t("Errors: {{count}}", {
                  count: template.failedInstanceCount,
                })}
              </Badge>
            )}
          </Group>
        </div>
        <IconChevronRight className={classes.rowChevron} size={18} />
      </UnstyledButton>
      <Group className={classes.rowActions} gap="xs" wrap="nowrap">
        {template.actions.use && (
          <Button
            size="compact-sm"
            variant="light"
            leftSection={<IconFilePlus size={15} />}
            aria-label={t("Use")}
            onClick={onUse}
          >
            {t("Use")}
          </Button>
        )}
        {(template.actions.archive || template.actions.restore) && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <AccessibleActionIcon
                label={t("Template actions")}
                variant="subtle"
                size={32}
              >
                <IconDots size={18} />
              </AccessibleActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {template.actions.archive && (
                <Menu.Item
                  color="red"
                  leftSection={<IconArchive size={16} />}
                  onClick={onArchive}
                >
                  {t("Archive template")}
                </Menu.Item>
              )}
              {template.actions.restore && (
                <Menu.Item
                  leftSection={<IconArchiveOff size={16} />}
                  onClick={onRestore}
                >
                  {t("Restore")}
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    </div>
  );
}

export function TemplateDetailsDrawer({
  template,
  opened,
  mobile,
  dateFormatter,
  onClose,
  onUse,
  onArchive,
  onRestore,
  templateUrl,
  actionPending,
  returnFocus = true,
}: {
  template: PageTemplateDiscoveryItem | null;
  opened: boolean;
  mobile: boolean;
  dateFormatter: Intl.DateTimeFormat;
  onClose: () => void;
  onUse: (template: PageTemplateDiscoveryItem) => void;
  onArchive: (template: PageTemplateDiscoveryItem) => void;
  onRestore: (template: PageTemplateDiscoveryItem) => void;
  templateUrl: string;
  actionPending: boolean;
  returnFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState<IPage | null>(null);
  const [usages, setUsages] = useState<PageTemplateUsagePage | null>(null);
  const [revisions, setRevisions] = useState<PageTemplateRevisionPage | null>(
    null,
  );
  const [runs, setRuns] = useState<TemplateSyncRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [usagesLoadingMore, setUsagesLoadingMore] = useState(false);
  const [revisionsLoadingMore, setRevisionsLoadingMore] = useState(false);
  const detailsRequestRef = useRef(0);
  const detailsGenerationRef = useRef(0);
  const usagesRequestRef = useRef(0);
  const revisionsRequestRef = useRef(0);
  const syncPollRequestRef = useRef(0);
  const activeTemplateIdRef = useRef<string | null>(null);

  const loadDetails = useCallback(async () => {
    if (!template) return;
    const templateId = template.id;
    const requestId = ++detailsRequestRef.current;
    setLoading(true);
    setLoadError(false);
    try {
      const canManage = template.actions.manage;
      const [nextPage, nextUsages, nextRevisions, nextRuns] = await Promise.all(
        [
          getPageById({ pageId: template.id }),
          canManage
            ? getPageTemplateUsages(template.id, undefined, 20)
            : Promise.resolve({
                items: [],
                nextCursor: null,
                totalCount: 0,
                hiddenCount: 0,
              }),
          canManage && template.kind === "synced"
            ? getPageTemplateRevisions(templateId, undefined, 20)
            : Promise.resolve({ items: [], nextCursor: null }),
          canManage && template.kind === "synced"
            ? getPageTemplateSyncRuns(templateId)
            : Promise.resolve({ items: [] }),
        ],
      );
      if (
        requestId !== detailsRequestRef.current ||
        activeTemplateIdRef.current !== templateId
      ) {
        return;
      }
      setPage(nextPage);
      setUsages(nextUsages);
      setRevisions(nextRevisions);
      setRuns(nextRuns.items);
    } catch {
      if (
        requestId === detailsRequestRef.current &&
        activeTemplateIdRef.current === templateId
      ) {
        setLoadError(true);
      }
    } finally {
      if (
        requestId === detailsRequestRef.current &&
        activeTemplateIdRef.current === templateId
      ) {
        setLoading(false);
      }
    }
  }, [template]);

  useEffect(() => {
    const detailsGeneration = ++detailsGenerationRef.current;
    usagesRequestRef.current += 1;
    revisionsRequestRef.current += 1;
    activeTemplateIdRef.current = opened ? (template?.id ?? null) : null;
    if (!opened || !template) {
      detailsRequestRef.current += 1;
      return;
    }
    setPage(null);
    setUsages(null);
    setRevisions(null);
    setRuns([]);
    setUsagesLoadingMore(false);
    setRevisionsLoadingMore(false);
    void loadDetails();
    return () => {
      detailsRequestRef.current += 1;
      if (detailsGenerationRef.current === detailsGeneration) {
        detailsGenerationRef.current += 1;
      }
      usagesRequestRef.current += 1;
      revisionsRequestRef.current += 1;
    };
  }, [loadDetails, opened, template]);

  const latestRun = runs[0];
  const hasActiveRun =
    latestRun?.status === "pending" || latestRun?.status === "running";

  useEffect(() => {
    if (!opened || !hasActiveRun || !template) return;
    const templateId = template.id;
    const pollRuns = async () => {
      const requestId = ++syncPollRequestRef.current;
      try {
        const nextRuns = await getPageTemplateSyncRuns(templateId);
        if (
          requestId === syncPollRequestRef.current &&
          activeTemplateIdRef.current === templateId
        ) {
          setRuns(nextRuns.items);
        }
      } catch {
        // Keep the last known progress; the next interval can recover.
      }
    };
    const timer = window.setInterval(() => void pollRuns(), 2_500);
    return () => {
      syncPollRequestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [hasActiveRun, opened, template]);

  const loadMoreUsages = async () => {
    if (!template || !usages?.nextCursor) return;
    const templateId = template.id;
    const cursor = usages.nextCursor;
    const detailsGeneration = detailsGenerationRef.current;
    const requestId = ++usagesRequestRef.current;
    const isCurrentRequest = () =>
      activeTemplateIdRef.current === templateId &&
      detailsGenerationRef.current === detailsGeneration &&
      usagesRequestRef.current === requestId;
    setUsagesLoadingMore(true);
    try {
      const next = await getPageTemplateUsages(templateId, cursor, 20);
      if (!isCurrentRequest()) return;
      setUsages((current) =>
        current
          ? {
              ...next,
              items: mergeUsagesByPageId(current.items, next.items),
            }
          : next,
      );
    } catch (error) {
      if (!isCurrentRequest()) return;
      notifications.show({
        color: "red",
        message: errorMessage(error, t("Could not load template history.")),
      });
    } finally {
      if (isCurrentRequest()) {
        setUsagesLoadingMore(false);
      }
    }
  };

  const loadMoreRevisions = async () => {
    if (!template || !revisions?.nextCursor) return;
    const templateId = template.id;
    const cursor = revisions.nextCursor;
    const detailsGeneration = detailsGenerationRef.current;
    const requestId = ++revisionsRequestRef.current;
    const isCurrentRequest = () =>
      activeTemplateIdRef.current === templateId &&
      detailsGenerationRef.current === detailsGeneration &&
      revisionsRequestRef.current === requestId;
    setRevisionsLoadingMore(true);
    try {
      const next = await getPageTemplateRevisions(templateId, cursor, 20);
      if (!isCurrentRequest()) return;
      setRevisions((current) =>
        current
          ? {
              ...next,
              items: mergeById(current.items, next.items),
            }
          : next,
      );
    } catch (error) {
      if (!isCurrentRequest()) return;
      notifications.show({
        color: "red",
        message: errorMessage(error, t("Could not load template history.")),
      });
    } finally {
      if (isCurrentRequest()) {
        setRevisionsLoadingMore(false);
      }
    }
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position={mobile ? "bottom" : "right"}
      size={mobile ? "100dvh" : 440}
      returnFocus={returnFocus}
      title={template?.title || t("Untitled")}
      closeButtonProps={{ "aria-label": t("Close") }}
      overlayProps={{ backgroundOpacity: mobile ? 0.45 : 0 }}
      classNames={{ body: classes.drawerBody }}
    >
      {!template ? null : loading ? (
        <Center py={72} role="status">
          <Loader size="sm" />
        </Center>
      ) : loadError ? (
        <EmptyState
          compact
          icon={IconAlertCircle}
          title={t("Could not load template history.")}
          action={
            <Button
              variant="light"
              leftSection={<IconRefresh size={16} />}
              onClick={() => void loadDetails()}
            >
              {t("Retry")}
            </Button>
          }
        />
      ) : (
        <Stack gap="md">
          <Stack gap={6}>
            <Group gap="xs" wrap="wrap">
              <Badge
                className={classes.accessibleBadge}
                variant="light"
                color={template.kind === "synced" ? "teal" : "gray"}
              >
                {template.kind === "synced"
                  ? t("Linked page")
                  : t("Independent copy")}
              </Badge>
              {template.archiveState === "archived" && (
                <Badge
                  className={classes.accessibleBadge}
                  variant="light"
                  color="orange"
                >
                  {t("Archived")}
                </Badge>
              )}
            </Group>
            <Text size="sm" c="dimmed">
              {template.kind === "synced"
                ? t(
                    "Published template blocks update every linked page while fields keep local values.",
                  )
                : t(
                    "New pages receive an independent copy. Later template changes do not affect them.",
                  )}
            </Text>
          </Stack>

          <Group gap="xs" wrap="wrap">
            {template.actions.use && (
              <Button
                size="compact-sm"
                leftSection={<IconFilePlus size={15} />}
                onClick={() => onUse(template)}
              >
                {t("Use")}
              </Button>
            )}
            <Button
              component={Link}
              to={templateUrl}
              size="compact-sm"
              variant="default"
              leftSection={<IconEdit size={15} />}
            >
              {template.actions.manage ? t("Edit") : t("Open template")}
            </Button>
            {template.actions.archive && (
              <Button
                size="compact-sm"
                variant="subtle"
                color="red"
                leftSection={<IconArchive size={15} />}
                onClick={() => onArchive(template)}
              >
                {t("Archive template")}
              </Button>
            )}
            {template.actions.restore && (
              <Button
                size="compact-sm"
                variant="subtle"
                loading={actionPending}
                leftSection={<IconArchiveOff size={15} />}
                onClick={() => onRestore(template)}
              >
                {t("Restore")}
              </Button>
            )}
          </Group>

          {!template.actions.manage && (
            <Alert color="gray">
              {t(
                "Usage and version details require permission to manage this template.",
              )}
            </Alert>
          )}

          <Tabs defaultValue="preview" keepMounted={false}>
            <Tabs.List grow={mobile}>
              <Tabs.Tab value="preview" leftSection={<IconFile size={14} />}>
                {t("Preview")}
              </Tabs.Tab>
              {template.actions.manage && (
                <>
                  <Tabs.Tab value="uses" leftSection={<IconLink size={14} />}>
                    {t("Uses")}
                  </Tabs.Tab>
                  {template.kind === "synced" && (
                    <>
                      <Tabs.Tab
                        value="versions"
                        leftSection={<IconHistory size={14} />}
                      >
                        {t("History")}
                      </Tabs.Tab>
                      <Tabs.Tab
                        value="status"
                        leftSection={<IconVersions size={14} />}
                      >
                        {t("Status")}
                      </Tabs.Tab>
                    </>
                  )}
                </>
              )}
            </Tabs.List>

            <Tabs.Panel value="preview" pt="md">
              {page && (
                <TemplateContentPreview
                  content={parsePageContent(page.content)}
                  label={t("Preview")}
                />
              )}
            </Tabs.Panel>

            {template.actions.manage && (
              <Tabs.Panel value="uses" pt="md">
                {Boolean(usages?.hiddenCount) && (
                  <Alert color="gray" mb="sm">
                    {t("Uses hidden by permissions: {{count}}", {
                      count: usages?.hiddenCount ?? 0,
                    })}
                  </Alert>
                )}
                {!usages || usages.items.length === 0 ? (
                  <EmptyState
                    compact
                    icon={IconFile}
                    title={t("No pages found")}
                    action={
                      usages?.nextCursor ? (
                        <Button
                          variant="light"
                          loading={usagesLoadingMore}
                          onClick={() => void loadMoreUsages()}
                        >
                          {t("Load more")}
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <Stack gap="xs">
                    {usages.items.map((usage) => (
                      <Paper key={usage.childPageId} withBorder p="sm">
                        <Group justify="space-between" wrap="nowrap">
                          <div className={classes.detailItemContent}>
                            <Text
                              component={Link}
                              to={buildPageUrl(
                                template.spaceSlug,
                                usage.slugId,
                                usage.title ?? undefined,
                              )}
                              fw={500}
                              size="sm"
                              lineClamp={1}
                            >
                              {usage.title || t("Untitled")}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {t("Updated {{date}}", {
                                date: dateFormatter.format(
                                  new Date(usage.updatedAt),
                                ),
                              })}
                            </Text>
                            {usage.lastErrorCode && (
                              <Text size="xs" c="red">
                                {getTemplateSyncErrorLabel(
                                  usage.lastErrorCode,
                                  t,
                                )}
                              </Text>
                            )}
                          </div>
                          <Badge
                            className={classes.accessibleBadge}
                            size="xs"
                            variant="light"
                            color={instanceStatusColor(usage.status)}
                          >
                            {instanceStatusLabel(usage.status, t)}
                          </Badge>
                        </Group>
                      </Paper>
                    ))}
                    {usages.nextCursor && (
                      <Button
                        variant="subtle"
                        loading={usagesLoadingMore}
                        onClick={() => void loadMoreUsages()}
                      >
                        {t("Load more")}
                      </Button>
                    )}
                  </Stack>
                )}
              </Tabs.Panel>
            )}

            {template.actions.manage && template.kind === "synced" && (
              <>
                <Tabs.Panel value="versions" pt="md">
                  {!revisions || revisions.items.length === 0 ? (
                    <EmptyState
                      compact
                      icon={IconHistory}
                      title={t("No published versions yet")}
                      action={
                        revisions?.nextCursor ? (
                          <Button
                            variant="light"
                            loading={revisionsLoadingMore}
                            onClick={() => void loadMoreRevisions()}
                          >
                            {t("Load more")}
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <Stack gap="xs">
                      {revisions.items.map((revision) => (
                        <Paper key={revision.id} withBorder p="sm">
                          <Group justify="space-between">
                            <Text fw={500} size="sm">
                              {t("Version {{version}}", {
                                version: revision.revision,
                              })}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {dateFormatter.format(
                                new Date(revision.createdAt),
                              )}
                            </Text>
                          </Group>
                        </Paper>
                      ))}
                      {revisions.nextCursor && (
                        <Button
                          variant="subtle"
                          loading={revisionsLoadingMore}
                          onClick={() => void loadMoreRevisions()}
                        >
                          {t("Load more")}
                        </Button>
                      )}
                    </Stack>
                  )}
                </Tabs.Panel>

                <Tabs.Panel value="status" pt="md">
                  {runs.length === 0 ? (
                    <EmptyState
                      compact
                      icon={IconVersions}
                      title={t("No data")}
                    />
                  ) : (
                    <Stack gap="xs">
                      {runs.map((run) => (
                        <Paper key={run.id} withBorder p="sm">
                          <Group justify="space-between" wrap="nowrap">
                            <div>
                              <Text size="sm" fw={500}>
                                {t("Version {{version}}", {
                                  version: run.revision,
                                })}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {t("{{processed}} of {{total}} pages updated", {
                                  processed: run.processedCount,
                                  total: run.totalCount,
                                })}
                              </Text>
                            </div>
                            <Badge
                              className={classes.accessibleBadge}
                              size="xs"
                              variant="light"
                              color={syncRunStatusColor(run.status)}
                            >
                              {getTemplateSyncRunLabel(run.status, t)}
                            </Badge>
                          </Group>
                        </Paper>
                      ))}
                    </Stack>
                  )}
                </Tabs.Panel>
              </>
            )}
          </Tabs>
        </Stack>
      )}
    </Drawer>
  );
}

export function CreateTemplateWizard({
  opened,
  spaceId,
  initialSourcePageId,
  onClose,
  onCreated,
}: {
  opened: boolean;
  spaceId: string;
  initialSourcePageId?: string;
  onClose: () => void;
  onCreated: (page: any) => void;
}) {
  const { t } = useTranslation();
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [step, setStep] = useState<0 | 1>(0);
  const [sourceMode, setSourceMode] = useState<SourceMode>(
    initialSourcePageId ? "page" : "blank",
  );
  const [sourcePageId, setSourcePageId] = useState(initialSourcePageId);
  const [sourceQuery, setSourceQuery] = useState("");
  const [debouncedSourceQuery] = useDebouncedValue(sourceQuery, 200);
  const [sourcePages, setSourcePages] = useState<PageTemplateDestination[]>([]);
  const [sourceNextCursor, setSourceNextCursor] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceLoadingMore, setSourceLoadingMore] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  const [initialSourceError, setInitialSourceError] = useState(false);
  const [kind, setKind] = useState<TemplateKind>("regular");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [collaborationUnavailable, setCollaborationUnavailable] =
    useState(false);
  const sourceRequestRef = useRef(0);
  const initialSourceResolvedRef = useRef(!initialSourcePageId);
  const selectedSourceRef = useRef<PageTemplateDestination | null>(null);

  const loadSources = useCallback(
    async (cursor?: string) => {
      const append = Boolean(cursor);
      const requestId = ++sourceRequestRef.current;
      if (append) {
        setSourceLoadingMore(true);
      } else {
        setSourceLoading(true);
        setSourceLoadingMore(false);
      }
      if (!append) setSourceError(false);
      try {
        const result = await getPageTemplateDestinations({
          spaceId,
          query: debouncedSourceQuery || undefined,
          cursor,
          limit: 20,
          purpose: "source",
        });
        let nextItems = result.items;
        const shouldResolveInitialSource = Boolean(
          !append && initialSourcePageId && !initialSourceResolvedRef.current,
        );
        let initialSourceUnavailable = false;
        let resolvedInitialSourcePageId: string | undefined;
        let resolvedInitialSourceTitle: string | null | undefined;
        let resolvedInitialSource: PageTemplateDestination | undefined;
        if (shouldResolveInitialSource && initialSourcePageId) {
          try {
            const initialResult = await getPageTemplateDestinations({
              spaceId,
              purpose: "source",
              pageId: initialSourcePageId,
              limit: 1,
            });
            const initialPage = initialResult.items.find(
              (item) => item.id === initialSourcePageId,
            );
            if (!initialPage) {
              initialSourceUnavailable = true;
            } else {
              resolvedInitialSource = initialPage;
              resolvedInitialSourcePageId = initialPage.id;
              resolvedInitialSourceTitle = initialPage.title;
              if (!nextItems.some((item) => item.id === initialPage.id)) {
                nextItems = [initialPage, ...nextItems];
              }
            }
          } catch {
            initialSourceUnavailable = true;
          }
        }
        if (requestId !== sourceRequestRef.current) return;
        if (shouldResolveInitialSource) {
          initialSourceResolvedRef.current = true;
          setInitialSourceError(initialSourceUnavailable);
          if (initialSourceUnavailable) {
            selectedSourceRef.current = null;
            setSourcePageId(undefined);
          } else if (resolvedInitialSourcePageId) {
            selectedSourceRef.current = resolvedInitialSource ?? null;
            setSourcePageId(resolvedInitialSourcePageId);
            setTitle((current) => current || resolvedInitialSourceTitle || "");
          }
        }
        if (
          !append &&
          selectedSourceRef.current &&
          !nextItems.some((item) => item.id === selectedSourceRef.current?.id)
        ) {
          nextItems = [selectedSourceRef.current, ...nextItems];
        }
        setSourcePages((current) =>
          append ? mergeById(current, nextItems) : nextItems,
        );
        setSourceNextCursor(result.nextCursor);
      } catch {
        if (requestId !== sourceRequestRef.current) return;
        if (!append) {
          setSourcePages([]);
          setSourceNextCursor(null);
          setSourceError(true);
        } else {
          notifications.show({
            color: "red",
            message: t("Could not load source pages"),
          });
        }
      } finally {
        if (requestId === sourceRequestRef.current) {
          append ? setSourceLoadingMore(false) : setSourceLoading(false);
        }
      }
    },
    [debouncedSourceQuery, initialSourcePageId, spaceId, t],
  );

  useEffect(() => {
    if (!opened) return;
    setStep(0);
    setSourceMode(initialSourcePageId ? "page" : "blank");
    setSourcePageId(initialSourcePageId);
    setSourceQuery("");
    setSourcePages([]);
    setSourceNextCursor(null);
    setInitialSourceError(false);
    initialSourceResolvedRef.current = !initialSourcePageId;
    selectedSourceRef.current = null;
    setKind("regular");
    setTitle("");
    setCollaborationUnavailable(false);
  }, [initialSourcePageId, opened]);

  useEffect(() => {
    if (!opened || sourceMode !== "page") return;
    void loadSources();
  }, [loadSources, opened, sourceMode]);

  const selectedSource = sourcePages.find((page) => page.id === sourcePageId);
  const canContinue =
    Boolean(title.trim()) &&
    (sourceMode === "blank" || Boolean(selectedSource)) &&
    !sourceError;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setCollaborationUnavailable(false);
    try {
      const result = await createPageTemplate({
        spaceId,
        kind,
        sourcePageId: sourceMode === "page" ? sourcePageId : undefined,
        title: title.trim(),
      });
      onCreated(result.page);
    } catch (error) {
      if (isCollaborationUnavailable(error)) {
        setCollaborationUnavailable(true);
      } else {
        notifications.show({
          color: "red",
          message: errorMessage(error, t("Could not create template.")),
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={submitting ? () => undefined : onClose}
      title={t("Create template")}
      centered
      size="lg"
      fullScreen={Boolean(isMobile)}
      closeOnClickOutside={!submitting}
      closeOnEscape={!submitting}
      closeButtonProps={{
        "aria-label": t("Close"),
        disabled: submitting,
      }}
    >
      <Stack gap="md">
        <SegmentedControl
          value={String(step)}
          onChange={(value) => value === "0" && setStep(0)}
          data={[
            { value: "0", label: t("Source") },
            { value: "1", label: t("How it works"), disabled: step === 0 },
          ]}
        />

        {step === 0 ? (
          <Stack gap="md">
            <TextInput
              label={t("Template name")}
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder={t("Untitled template")}
              autoFocus
            />
            <Divider label={t("Source")} labelPosition="left" />
            <SegmentedControl
              fullWidth
              value={sourceMode}
              onChange={(value) => {
                initialSourceResolvedRef.current = true;
                setInitialSourceError(false);
                setSourceMode(value as SourceMode);
              }}
              data={[
                { value: "blank", label: t("Start from scratch") },
                { value: "page", label: t("Use an existing page") },
              ]}
            />
            {sourceMode === "blank" ? (
              <Alert icon={<IconFilePlus size={18} />}>
                {t(
                  "A new template document will be created in the template catalog.",
                )}
              </Alert>
            ) : (
              <Stack gap="xs">
                <TextInput
                  value={sourceQuery}
                  onChange={(event) =>
                    setSourceQuery(event.currentTarget.value)
                  }
                  placeholder={t("Search pages")}
                  aria-label={t("Search pages")}
                  leftSection={<IconSearch size={16} />}
                />
                {initialSourceError && (
                  <Alert color="red">
                    <Group justify="space-between" align="center" wrap="wrap">
                      <Text size="sm">
                        {t(
                          "The selected source page is no longer available or readable.",
                        )}
                      </Text>
                      <Button
                        size="compact-sm"
                        variant="light"
                        leftSection={<IconRefresh size={15} />}
                        onClick={() => {
                          initialSourceResolvedRef.current = false;
                          void loadSources();
                        }}
                      >
                        {t("Retry")}
                      </Button>
                    </Group>
                  </Alert>
                )}
                <ScrollArea
                  h={
                    isMobile
                      ? "clamp(8rem, calc(100dvh - 390px), 15.625rem)"
                      : 250
                  }
                >
                  {sourceLoading ? (
                    <Center py="xl" role="status">
                      <Loader size="sm" />
                    </Center>
                  ) : sourceError ? (
                    <EmptyState
                      compact
                      icon={IconAlertCircle}
                      title={t("Could not load source pages")}
                      action={
                        <Button
                          variant="light"
                          leftSection={<IconRefresh size={16} />}
                          onClick={() => void loadSources()}
                        >
                          {t("Retry")}
                        </Button>
                      }
                    />
                  ) : sourcePages.length === 0 ? (
                    <EmptyState
                      compact
                      icon={IconFile}
                      title={t("No pages found")}
                      action={
                        sourceNextCursor ? (
                          <Button
                            variant="light"
                            loading={sourceLoadingMore}
                            onClick={() => void loadSources(sourceNextCursor)}
                          >
                            {t("Load more")}
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <Stack gap={4}>
                      {sourcePages.map((page) => (
                        <SelectionOption
                          key={page.id}
                          selected={sourcePageId === page.id}
                          icon={page.icon || <IconFile size={18} />}
                          title={page.title || t("Untitled")}
                          onClick={() => {
                            initialSourceResolvedRef.current = true;
                            selectedSourceRef.current = page;
                            setInitialSourceError(false);
                            setSourcePageId(page.id);
                            setTitle((current) => current || page.title || "");
                          }}
                        />
                      ))}
                      {sourceNextCursor && (
                        <Button
                          variant="subtle"
                          loading={sourceLoadingMore}
                          onClick={() => void loadSources(sourceNextCursor)}
                        >
                          {t("Load more")}
                        </Button>
                      )}
                    </Stack>
                  )}
                </ScrollArea>
                <Text size="xs" c="dimmed">
                  {t(
                    "The original page will not change. The template is always a separate copy.",
                  )}
                </Text>
              </Stack>
            )}
          </Stack>
        ) : (
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <TemplateKindOption
                selected={kind === "regular"}
                title={t("Independent copy")}
                description={t(
                  "Creates independent copies. Editing the template later changes nothing on existing pages.",
                )}
                icon={<IconTemplate size={22} />}
                onClick={() => setKind("regular")}
              />
              <TemplateKindOption
                selected={kind === "synced"}
                title={t("Linked page")}
                description={t(
                  "Published template blocks update every linked page while fields keep local values.",
                )}
                icon={<IconVersions size={22} />}
                onClick={() => setKind("synced")}
              />
            </SimpleGrid>
            <Paper withBorder p="md" className={classes.summary}>
              <Stack gap="xs">
                <div>
                  <Text size="xs" c="dimmed">
                    {t("Template name")}
                  </Text>
                  <Text fw={600}>{title.trim()}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    {t("Source")}
                  </Text>
                  <Text size="sm">
                    {sourceMode === "blank"
                      ? t("Start from scratch")
                      : selectedSource?.title || t("Untitled")}
                  </Text>
                </div>
                <Alert color={kind === "synced" ? "teal" : "gray"}>
                  {kind === "synced"
                    ? t(
                        "Autosave only updates the draft. Publish the first version before creating linked pages.",
                      )
                    : t(
                        "Each created page is a one-time copy and can be edited without affecting the template or other pages.",
                      )}
                </Alert>
              </Stack>
            </Paper>
          </Stack>
        )}

        {collaborationUnavailable && (
          <Alert color="red" icon={<IconAlertCircle size={18} />} role="alert">
            <Group justify="space-between" align="center" wrap="wrap">
              <Text size="sm">
                {t(
                  "Live editing is temporarily unavailable. Your input is preserved. Try again.",
                )}
              </Text>
              <Button
                size="compact-sm"
                variant="light"
                leftSection={<IconRefresh size={15} />}
                loading={submitting}
                onClick={() => void submit()}
              >
                {t("Retry")}
              </Button>
            </Group>
          </Alert>
        )}

        <Group justify="space-between" wrap="nowrap">
          <Button
            variant="default"
            onClick={step === 0 ? onClose : () => setStep(0)}
            disabled={submitting}
          >
            {step === 0 ? t("Cancel") : t("Back")}
          </Button>
          {step === 0 ? (
            <Button disabled={!canContinue} onClick={() => setStep(1)}>
              {t("Next")}
            </Button>
          ) : (
            <Button loading={submitting} onClick={() => void submit()}>
              {t("Create template")}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}

function TemplateKindOption({
  selected,
  title,
  description,
  icon,
  onClick,
}: {
  selected: boolean;
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      className={classes.kindOption}
      data-selected={selected || undefined}
      aria-pressed={selected}
      onClick={onClick}
    >
      <Group align="flex-start" wrap="nowrap">
        <div className={classes.kindIcon}>{icon}</div>
        <div>
          <Text fw={600}>{title}</Text>
          <Text size="sm" c="dimmed" mt={4}>
            {description}
          </Text>
        </div>
      </Group>
    </UnstyledButton>
  );
}

function SelectionOption({
  selected,
  icon,
  title,
  description,
  onClick,
}: {
  selected: boolean;
  icon: ReactNode;
  title: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      className={classes.selectionOption}
      data-selected={selected || undefined}
      aria-pressed={selected}
      onClick={onClick}
    >
      <Group gap="sm" wrap="nowrap">
        <div className={classes.selectionIcon}>{icon}</div>
        <div className={classes.detailItemContent}>
          <Text size="sm" fw={500} lineClamp={1}>
            {title}
          </Text>
          {description && (
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          )}
        </div>
      </Group>
    </UnstyledButton>
  );
}

function instanceStatusLabel(
  status: string,
  t: (key: string) => string,
): string {
  if (status === "error") return t("Update failed");
  if (status === "syncing") return t("Updating");
  if (status === "active") return t("Up to date");
  return t("Independent copy");
}

function instanceStatusColor(status: string): string {
  if (status === "error") return "red";
  if (status === "syncing") return "blue";
  if (status === "active") return "teal";
  return "gray";
}

function syncRunStatusColor(status: TemplateSyncRun["status"]): string {
  if (status === "failed") return "red";
  if (status === "partial") return "orange";
  if (status === "running") return "blue";
  if (status === "pending") return "gray";
  return "teal";
}
