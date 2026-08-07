import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconDots,
  IconExternalLink,
  IconFilePlus,
  IconFolder,
  IconPlus,
  IconSearch,
  IconTemplate,
  IconTemplateOff,
  IconTrash,
} from "@tabler/icons-react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { PageFrame, SectionHeader } from "@/components/ui/page-frame";
import {
  createPageFromTemplate,
  createPageTemplate,
  discoverPageTemplates,
  getPageTemplateDestinations,
  setPageTemplate,
} from "@/features/page-template/services/page-template-api";
import type {
  PageTemplateCapabilities,
  PageTemplateDestination,
  PageTemplateDiscoveryItem,
} from "@/features/page-template/types/page-template.types";
import { buildPageUrl } from "@/features/page/page.utils";
import { invalidateOnCreatePage } from "@/features/page/queries/page-query";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query";
import { getAppName } from "@/lib/config";
import classes from "@/features/page-template/components/page-template-catalog.module.css";

const PAGE_SIZE = 20;

function errorMessage(error: any, fallback: string): string {
  const message = error?.response?.data?.message;
  return typeof message === "string" ? message : fallback;
}

export default function SpaceTemplates() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { spaceSlug } = useParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 200);
  const [items, setItems] = useState<PageTemplateDiscoveryItem[]>([]);
  const [capabilities, setCapabilities] =
    useState<PageTemplateCapabilities | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [selectedTemplate, setSelectedTemplate] =
    useState<PageTemplateDiscoveryItem | null>(null);
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
  }, [space?.id, debouncedQuery]);

  const loadMore = async () => {
    if (!space?.id || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await discoverPageTemplates({
        spaceId: space.id,
        query: debouncedQuery || undefined,
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

  const createBlankTemplate = async () => {
    if (!space) return;
    setCreatingTemplate(true);
    try {
      const result = await createPageTemplate({ spaceId: space.id });
      invalidateOnCreatePage(result.page);
      navigate(buildPageUrl(space.slug, result.page.slugId, result.page.title));
    } catch (error) {
      notifications.show({
        color: "red",
        message: errorMessage(error, t("Could not create template.")),
      });
    } finally {
      setCreatingTemplate(false);
    }
  };

  const removeTemplate = (template: PageTemplateDiscoveryItem) => {
    modals.openConfirmModal({
      title: t("Remove template marker"),
      children: (
        <Text size="sm">
          {t("This page will remain available as a regular page.")}
        </Text>
      ),
      labels: { confirm: t("Remove template marker"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await setPageTemplate(template.id, false);
          setItems((current) =>
            current.filter((item) => item.id !== template.id),
          );
          notifications.show({ message: t("Template marker removed") });
        } catch (error) {
          notifications.show({
            color: "red",
            message: errorMessage(error, t("Could not update template.")),
          });
        }
      },
    });
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

  const headerTitle = (
    <Group gap="xs" wrap="nowrap">
      <span>{t("Templates")}</span>
      <Badge variant="light" size="sm" aria-label={t("Templates")}>
        {items.length}
      </Badge>
    </Group>
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
          title={headerTitle}
          description={t("Create and reuse pages within this space.")}
          actions={
            capabilities?.createTemplate ? (
              <Button
                leftSection={<IconPlus size={16} />}
                loading={creatingTemplate}
                onClick={() => void createBlankTemplate()}
              >
                {t("New template")}
              </Button>
            ) : undefined
          }
          divider
        />

        <Stack gap="md">
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
                <Button variant="light" onClick={() => void loadTemplates()}>
                  {t("Retry")}
                </Button>
              }
            />
          ) : capabilities && !capabilities.enabled ? (
            <EmptyState
              icon={IconTemplateOff}
              title={t("Templates are disabled")}
              description={t("Templates are disabled for this space.")}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={IconTemplate}
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
                !debouncedQuery && capabilities?.createTemplate ? (
                  <Button
                    variant="light"
                    leftSection={<IconPlus size={16} />}
                    loading={creatingTemplate}
                    onClick={() => void createBlankTemplate()}
                  >
                    {t("New template")}
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
                      {template.icon || "📄"}
                    </Text>
                    <div className={classes.details}>
                      <Text
                        component={Link}
                        to={templateUrl(template)}
                        className={classes.title}
                        fw={500}
                        lineClamp={1}
                      >
                        {template.title || t("Untitled")}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t("Updated {{date}}", {
                          date: dateFormatter.format(
                            new Date(template.updatedAt),
                          ),
                        })}
                      </Text>
                    </div>
                  </Group>

                  <Group className={classes.actions} gap="xs" wrap="nowrap">
                    {template.actions.snapshot && (
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconFilePlus size={15} />}
                        onClick={() => setSelectedTemplate(template)}
                      >
                        {t("Create page")}
                      </Button>
                    )}
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
                          component={Link}
                          to={templateUrl(template)}
                          leftSection={<IconExternalLink size={16} />}
                        >
                          {t("Open template")}
                        </Menu.Item>
                        {template.actions.manage && (
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={16} />}
                            onClick={() => removeTemplate(template)}
                          >
                            {t("Remove template marker")}
                          </Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
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
    </>
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
        setSelected(
          (current) => current ?? (result.rootAllowed ? "root" : undefined),
        );
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
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Choose page destination")}
      centered
      size="lg"
    >
      <Stack gap="sm">
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("Search parent pages")}
          leftSection={<IconSearch size={16} />}
          aria-label={t("Search parent pages")}
        />
        <ScrollArea h={320}>
          {loading ? (
            <Center py="xl">
              <Loader size="sm" />
            </Center>
          ) : loadError ? (
            <EmptyState
              compact
              icon={IconAlertCircle}
              title={t("Could not load destinations")}
            />
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
                  icon={<Text aria-hidden>{item.icon || "📄"}</Text>}
                  title={item.title || t("Untitled")}
                  onClick={() => setSelected(item.id)}
                />
              ))}
              {!rootAllowed && items.length === 0 && (
                <EmptyState
                  compact
                  icon={IconFolder}
                  title={t("No available destinations")}
                  description={t(
                    "You do not have permission to create a page in the available locations.",
                  )}
                />
              )}
            </Stack>
          )}
        </ScrollArea>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={!selected || loadError}
            loading={submitting}
            onClick={() => void submit()}
          >
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
