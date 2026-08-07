import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  Modal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Stepper,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconArchive,
  IconDots,
  IconEdit,
  IconFile,
  IconFilePlus,
  IconFolder,
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
import {
  archivePageTemplate,
  createPageFromTemplate,
  createPageTemplate,
  discoverPageTemplates,
  getPageTemplateDestinations,
} from "@/features/page-template/services/page-template-api";
import type {
  PageTemplateCapabilities,
  PageTemplateDestination,
  PageTemplateDiscoveryItem,
  TemplateKind,
} from "@/features/page-template/types/page-template.types";
import { buildPageUrl } from "@/features/page/page.utils";
import { invalidateOnCreatePage } from "@/features/page/queries/page-query";
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

export default function SpaceTemplates() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { spaceSlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 200);
  const [tab, setTab] = useState<CatalogTab>("all");
  const [items, setItems] = useState<PageTemplateDiscoveryItem[]>([]);
  const [capabilities, setCapabilities] =
    useState<PageTemplateCapabilities | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [wizardOpened, setWizardOpened] = useState(
    Boolean(searchParams.get("sourcePageId")),
  );
  const [selectedTemplate, setSelectedTemplate] =
    useState<PageTemplateDiscoveryItem | null>(null);
  const [archiveCandidate, setArchiveCandidate] =
    useState<PageTemplateDiscoveryItem | null>(null);
  const [archiving, setArchiving] = useState(false);
  const requestIdRef = useRef(0);

  const loadTemplates = async () => {
    if (!space?.id) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(false);
    try {
      const result = await discoverPageTemplates({
        spaceId: space.id,
        query: debouncedQuery || undefined,
        kind: tab === "all" ? undefined : tab,
        limit: PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) return;
      setItems(result.items);
      setCapabilities(result.capabilities);
      setNextCursor(result.nextCursor);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setItems([]);
      setCapabilities(null);
      setNextCursor(null);
      setLoadError(true);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedTemplate(null);
    void loadTemplates();
  }, [space?.id, debouncedQuery, tab]);

  useEffect(() => {
    if (searchParams.get("sourcePageId")) setWizardOpened(true);
  }, [searchParams]);

  const loadMore = async () => {
    if (!space?.id || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await discoverPageTemplates({
        spaceId: space.id,
        query: debouncedQuery || undefined,
        kind: tab === "all" ? undefined : tab,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
      setItems((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        result.items.forEach((item) => byId.set(item.id, item));
        return [...byId.values()];
      });
      setCapabilities(result.capabilities);
      setNextCursor(result.nextCursor);
    } catch (error) {
      notifications.show({
        color: "red",
        message: errorMessage(error, t("Could not load more templates.")),
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const archiveTemplate = async () => {
    if (!archiveCandidate) return;
    setArchiving(true);
    try {
      await archivePageTemplate(archiveCandidate.id);
      setItems((current) =>
        current.filter((item) => item.id !== archiveCandidate.id),
      );
      setArchiveCandidate(null);
      notifications.show({ message: t("Template archived") });
    } catch (error) {
      notifications.show({
        color: "red",
        message: errorMessage(error, t("Could not archive template.")),
      });
    } finally {
      setArchiving(false);
    }
  };

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

  return (
    <>
      <Helmet>
        <title>
          {t("Templates")} - {getAppName()}
        </title>
      </Helmet>
      <PageFrame size="document">
        <SectionHeader
          title={
            <Group gap="xs" wrap="nowrap">
              <span>{t("Templates")}</span>
              <Badge variant="light" size="sm">
                {items.length}
              </Badge>
            </Group>
          }
          description={t(
            "Create independent page copies or keep pages synchronized with a published template.",
          )}
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
          <SegmentedControl
            fullWidth
            value={tab}
            onChange={(value) => setTab(value as CatalogTab)}
            data={[
              { value: "all", label: t("All") },
              { value: "regular", label: t("Regular") },
              { value: "synced", label: t("Synchronized") },
            ]}
          />
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("Search templates")}
            leftSection={<IconSearch size={16} />}
            aria-label={t("Search templates")}
          />

          {loading ? (
            <Center py="xl">
              <Loader size="sm" />
            </Center>
          ) : loadError ? (
            <EmptyState
              icon={IconAlertCircle}
              title={t("Could not load templates")}
              description={t("Try loading the template list again.")}
              action={
                <Button
                  variant="light"
                  leftSection={<IconRefresh size={16} />}
                  onClick={() => void loadTemplates()}
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
              icon={IconTemplate}
              title={debouncedQuery ? t("No matching templates") : t("No templates yet")}
              description={
                debouncedQuery
                  ? t("Try a different search term.")
                  : t("Create your first regular or synchronized template.")
              }
              action={
                !debouncedQuery && capabilities?.createTemplate ? (
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
            <div className={classes.list}>
              {items.map((template) => (
                <div className={classes.row} key={template.id}>
                  <Group className={classes.identity} gap="sm" wrap="nowrap">
                    <Text className={classes.icon} aria-hidden>
                      {template.icon || <IconTemplate size={18} />}
                    </Text>
                    <div className={classes.details}>
                      <Group gap="xs" wrap="wrap">
                        <Text
                          component={Link}
                          to={templateUrl(template)}
                          className={classes.title}
                          fw={600}
                          lineClamp={1}
                        >
                          {template.title || t("Untitled")}
                        </Text>
                        <Badge
                          size="xs"
                          color={template.kind === "synced" ? "teal" : "gray"}
                          variant="light"
                        >
                          {template.kind === "synced"
                            ? t("Synchronized")
                            : t("Regular")}
                        </Badge>
                        {template.kind === "synced" && template.draftChanged && (
                          <Badge size="xs" color="orange" variant="light">
                            {t("Draft changes")}
                          </Badge>
                        )}
                        {template.failedInstanceCount > 0 && (
                          <Badge size="xs" color="red" variant="light">
                            {t("{{count}} errors", {
                              count: template.failedInstanceCount,
                            })}
                          </Badge>
                        )}
                      </Group>
                      <Group gap="xs" mt={2}>
                        <Text size="xs" c="dimmed">
                          {t("Updated {{date}}", {
                            date: dateFormatter.format(new Date(template.updatedAt)),
                          })}
                        </Text>
                        <Text size="xs" c="dimmed">·</Text>
                        <Text size="xs" c="dimmed">
                          {t("{{count}} uses", {
                            count: template.activeInstanceCount,
                          })}
                        </Text>
                        {template.kind === "synced" && (
                          <>
                            <Text size="xs" c="dimmed">·</Text>
                            <Text size="xs" c="dimmed">
                              {template.publishedRevision
                                ? t("Version {{version}}", {
                                    version: template.publishedRevision,
                                  })
                                : t("Not published")}
                            </Text>
                          </>
                        )}
                      </Group>
                    </div>
                  </Group>

                  <Group className={classes.actions} gap="xs" wrap="nowrap">
                    {template.actions.use && (
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconFilePlus size={15} />}
                        onClick={() => setSelectedTemplate(template)}
                      >
                        {t("Use")}
                      </Button>
                    )}
                    <Button
                      component={Link}
                      to={templateUrl(template)}
                      size="xs"
                      variant="default"
                      leftSection={<IconEdit size={15} />}
                    >
                      {t("Edit")}
                    </Button>
                    {template.actions.manage && (
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
                          <Menu.Item
                            color="red"
                            leftSection={<IconArchive size={16} />}
                            onClick={() => setArchiveCandidate(template)}
                          >
                            {t("Archive template")}
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                  </Group>
                </div>
              ))}
              {nextCursor && (
                <Group justify="center" py="sm">
                  <Button
                    variant="subtle"
                    loading={loadingMore}
                    onClick={() => void loadMore()}
                  >
                    {t("Load more")}
                  </Button>
                </Group>
              )}
            </div>
          )}
        </Stack>
      </PageFrame>

      {space && (
        <CreateTemplateWizard
          opened={wizardOpened}
          spaceId={space.id}
          initialSourcePageId={searchParams.get("sourcePageId") ?? undefined}
          onClose={() => {
            setWizardOpened(false);
            if (searchParams.has("sourcePageId")) {
              searchParams.delete("sourcePageId");
              setSearchParams(searchParams, { replace: true });
            }
          }}
          onCreated={(page) => {
            navigate(buildPageUrl(space.slug, page.slugId, page.title));
          }}
        />
      )}

      {space && selectedTemplate && (
        <TemplateDestinationModal
          opened
          spaceId={space.id}
          template={selectedTemplate}
          onClose={() => setSelectedTemplate(null)}
          onCreated={(page) => {
            invalidateOnCreatePage(page);
            setSelectedTemplate(null);
            navigate(buildPageUrl(space.slug, page.slugId, page.title));
          }}
        />
      )}

      <Modal
        opened={Boolean(archiveCandidate)}
        onClose={() => !archiving && setArchiveCandidate(null)}
        title={t("Archive template")}
        centered
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
              disabled={archiving}
              onClick={() => setArchiveCandidate(null)}
            >
              {t("Cancel")}
            </Button>
            <Button
              color="red"
              loading={archiving}
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

function CreateTemplateWizard({
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
  const [step, setStep] = useState(0);
  const [sourceMode, setSourceMode] = useState<SourceMode>(
    initialSourcePageId ? "page" : "blank",
  );
  const [sourcePageId, setSourcePageId] = useState(initialSourcePageId);
  const [sourceQuery, setSourceQuery] = useState("");
  const [debouncedSourceQuery] = useDebouncedValue(sourceQuery, 200);
  const [sourcePages, setSourcePages] = useState<PageTemplateDestination[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [kind, setKind] = useState<TemplateKind>("regular");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setStep(0);
    setSourceMode(initialSourcePageId ? "page" : "blank");
    setSourcePageId(initialSourcePageId);
    setKind("regular");
    setTitle("");
  }, [initialSourcePageId, opened]);

  useEffect(() => {
    if (!opened || sourceMode !== "page") return;
    let cancelled = false;
    setSourceLoading(true);
    getPageTemplateDestinations({
      spaceId,
      query: debouncedSourceQuery || undefined,
      limit: 50,
    })
      .then((result) => {
        if (!cancelled) setSourcePages(result.items);
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSourceQuery, opened, sourceMode, spaceId]);

  const selectedSource = sourcePages.find((page) => page.id === sourcePageId);
  const stepLabels = [
    t("Source"),
    t("Type"),
    t("Details"),
    t("How it works"),
  ];
  const canContinue =
    step !== 0 || sourceMode === "blank" || Boolean(sourcePageId);

  const submit = async () => {
    setSubmitting(true);
    try {
      const result = await createPageTemplate({
        spaceId,
        kind,
        sourcePageId: sourceMode === "page" ? sourcePageId : undefined,
        title: title.trim() || selectedSource?.title || undefined,
      });
      onCreated(result.page);
    } catch (error) {
      notifications.show({
        color: "red",
        message: errorMessage(error, t("Could not create template.")),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Create template")}
      centered
      size="xl"
    >
      <Stack>
        <Text className={classes.wizardMobileStep} size="sm" fw={600}>
          {step + 1} / {stepLabels.length} · {stepLabels[step]}
        </Text>
        <Stepper
          active={step}
          size="sm"
          allowNextStepsSelect={false}
          className={classes.wizardStepper}
        >
          {stepLabels.map((label) => (
            <Stepper.Step key={label} label={label} aria-label={label} />
          ))}
        </Stepper>

        {step === 0 && (
          <Stack>
            <SegmentedControl
              fullWidth
              className={classes.sourceModeControl}
              value={sourceMode}
              onChange={(value) => setSourceMode(value as SourceMode)}
              data={[
                { value: "blank", label: t("Start from scratch") },
                { value: "page", label: t("Use an existing page") },
              ]}
            />
            {sourceMode === "blank" ? (
              <Alert icon={<IconFilePlus size={18} />}>
                {t("A new template document will be created in the template catalog.")}
              </Alert>
            ) : (
              <>
                <TextInput
                  value={sourceQuery}
                  onChange={(event) => setSourceQuery(event.currentTarget.value)}
                  placeholder={t("Search pages")}
                  leftSection={<IconSearch size={16} />}
                />
                <ScrollArea h={250}>
                  {sourceLoading ? (
                    <Center py="xl"><Loader size="sm" /></Center>
                  ) : (
                    <Stack gap={4}>
                      {sourcePages.map((page) => (
                        <DestinationOption
                          key={page.id}
                          selected={sourcePageId === page.id}
                          icon={<IconFile size={18} />}
                          title={page.title || t("Untitled")}
                          onClick={() => {
                            setSourcePageId(page.id);
                            if (!title) setTitle(page.title ?? "");
                          }}
                        />
                      ))}
                    </Stack>
                  )}
                </ScrollArea>
                <Text size="xs" c="dimmed">
                  {t("The original page will not change. The template is always a separate copy.")}
                </Text>
              </>
            )}
          </Stack>
        )}

        {step === 1 && (
          <div className={classes.kindGrid}>
            <TemplateKindOption
              selected={kind === "regular"}
              title={t("Regular template")}
              description={t("Creates independent copies. Editing the template later changes nothing on existing pages.")}
              icon={<IconTemplate size={24} />}
              onClick={() => setKind("regular")}
            />
            <TemplateKindOption
              selected={kind === "synced"}
              title={t("Synchronized template")}
              description={t("Published template blocks update every linked page while fields keep local values.")}
              icon={<IconVersions size={24} />}
              onClick={() => setKind("synced")}
            />
          </div>
        )}

        {step === 2 && (
          <Stack>
            <TextInput
              label={t("Template name")}
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder={selectedSource?.title || t("Untitled template")}
              autoFocus
            />
            <Alert color={kind === "synced" ? "teal" : "gray"}>
              <Text fw={600}>{title.trim() || selectedSource?.title || t("Untitled template")}</Text>
              <Text size="sm" c="dimmed">
                {kind === "synced" ? t("Synchronized") : t("Regular")}
              </Text>
            </Alert>
          </Stack>
        )}

        {step === 3 && (
          <Stack>
            {kind === "synced" ? (
              <>
                <Alert color="blue" title={t("Template blocks")}>
                  {t("They are edited only in the template and appear read-only on linked pages.")}
                </Alert>
                <Alert color="teal" title={t("Fields to fill")}>
                  {t("People fill these on linked pages. Their values survive every publication.")}
                </Alert>
                <Alert color="orange" title={t("Publish before use")}>
                  {t("Autosave only updates the draft. Publish the first version before creating linked pages.")}
                </Alert>
              </>
            ) : (
              <Alert color="gray" title={t("Independent by design")}>
                {t("Each created page is a one-time copy and can be edited without affecting the template or other pages.")}
              </Alert>
            )}
          </Stack>
        )}

        <Group justify="space-between">
          <Button
            variant="default"
            onClick={step === 0 ? onClose : () => setStep((current) => current - 1)}
          >
            {step === 0 ? t("Cancel") : t("Back")}
          </Button>
          {step < 3 ? (
            <Button
              disabled={!canContinue}
              onClick={() => setStep((current) => current + 1)}
            >
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
  icon: React.ReactNode;
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
          <Text fw={650}>{title}</Text>
          <Text size="sm" c="dimmed" mt={4}>{description}</Text>
        </div>
      </Group>
    </UnstyledButton>
  );
}

function TemplateDestinationModal({
  opened,
  spaceId,
  template,
  onClose,
  onCreated,
}: {
  opened: boolean;
  spaceId: string;
  template: PageTemplateDiscoveryItem;
  onClose: () => void;
  onCreated: (page: any) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 200);
  const [items, setItems] = useState<PageTemplateDestination[]>([]);
  const [rootAllowed, setRootAllowed] = useState(false);
  const [selected, setSelected] = useState<"root" | string>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    getPageTemplateDestinations({
      spaceId,
      query: debouncedQuery || undefined,
      limit: 50,
    })
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setRootAllowed(result.rootAllowed);
        setSelected((current) => current ?? (result.rootAllowed ? "root" : undefined));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, opened, spaceId]);

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const result = await createPageFromTemplate({
        templatePageId: template.id,
        spaceId,
        parentPageId: selected === "root" ? undefined : selected,
        title: title.trim() || undefined,
      });
      onCreated(result.page);
    } catch (error) {
      notifications.show({
        color: "red",
        message: errorMessage(error, t("Could not create page from template.")),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t("Create page from template")} centered size="lg">
      <Stack gap="sm">
        <Alert color={template.kind === "synced" ? "teal" : "gray"}>
          <Text fw={600}>{template.title || t("Untitled")}</Text>
          <Text size="sm" c="dimmed">
            {template.kind === "synced"
              ? t("This page stays linked. Template blocks are read-only; fields are yours to fill.")
              : t("This page is an independent copy and will not receive template updates.")}
          </Text>
        </Alert>
        <TextInput
          label={t("Page title")}
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          placeholder={template.title || t("Untitled")}
        />
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("Search parent pages")}
          leftSection={<IconSearch size={16} />}
          aria-label={t("Search parent pages")}
        />
        <ScrollArea h={280}>
          {loading ? (
            <Center py="xl"><Loader size="sm" /></Center>
          ) : loadError ? (
            <EmptyState compact icon={IconAlertCircle} title={t("Could not load destinations")} />
          ) : (
            <Stack gap={4}>
              {rootAllowed && (
                <DestinationOption
                  selected={selected === "root"}
                  icon={<IconFolder size={18} />}
                  title={t("Space root")}
                  description={t("Create a top-level page.")}
                  onClick={() => setSelected("root")}
                />
              )}
              {items.map((item) => (
                <DestinationOption
                  key={item.id}
                  selected={selected === item.id}
                  icon={<IconFile size={18} />}
                  title={item.title || t("Untitled")}
                  onClick={() => setSelected(item.id)}
                />
              ))}
              {!rootAllowed && items.length === 0 && (
                <EmptyState
                  compact
                  icon={IconFolder}
                  title={t("No available destinations")}
                  description={t("You do not have permission to create a page in the available locations.")}
                />
              )}
            </Stack>
          )}
        </ScrollArea>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t("Cancel")}</Button>
          <Button disabled={!selected || loadError} loading={submitting} onClick={() => void submit()}>
            {t("Create page")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function DestinationOption({
  selected,
  icon,
  title,
  description,
  onClick,
}: {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      className={classes.destination}
      data-selected={selected || undefined}
      aria-pressed={selected}
      onClick={onClick}
    >
      <Group gap="sm" wrap="nowrap">
        <div className={classes.destinationIcon}>{icon}</div>
        <div>
          <Text size="sm" fw={500} lineClamp={1}>{title}</Text>
          {description && <Text size="xs" c="dimmed">{description}</Text>}
        </div>
      </Group>
    </UnstyledButton>
  );
}
