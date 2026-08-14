import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Badge,
  Button,
  Center,
  Divider,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconFile,
  IconFolder,
  IconRefresh,
  IconSearch,
  IconTemplate,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@/components/ui/empty-state";
import {
  createPageFromTemplate,
  discoverPageTemplates,
  getPageTemplateDestinations,
} from "../services/page-template-api";
import type {
  PageTemplateDestination,
  PageTemplateDiscoveryItem,
} from "../types/page-template.types";
import classes from "./page-template-picker.module.css";

type PickerRequest = {
  mode: "create";
};

export const PAGE_TEMPLATE_PICKER_EVENT = "docmost:page-template-picker";

function errorMessage(error: any, fallback: string): string {
  const message = error?.response?.data?.message;
  return typeof message === "string" ? message : fallback;
}

export function PageTemplatePicker({
  pageId,
  spaceId,
}: {
  pageId: string;
  spaceId: string;
}) {
  const navigate = useNavigate();
  const [request, setRequest] = useState<PickerRequest | null>(null);

  useEffect(() => {
    const listener = (event: Event) => {
      setRequest((event as CustomEvent<PickerRequest>).detail);
    };
    window.addEventListener(PAGE_TEMPLATE_PICKER_EVENT, listener);
    return () =>
      window.removeEventListener(PAGE_TEMPLATE_PICKER_EVENT, listener);
  }, []);

  return (
    <TemplateUseModal
      opened={Boolean(request)}
      spaceId={spaceId}
      defaultParentPageId={pageId}
      onClose={() => setRequest(null)}
      onCreated={(page) => {
        setRequest(null);
        navigate(`/p/${page.slugId}`);
      }}
    />
  );
}

export function TemplateUseModal({
  opened,
  spaceId,
  defaultParentPageId,
  initialTemplate,
  onClose,
  onCreated,
}: {
  opened: boolean;
  spaceId: string;
  defaultParentPageId?: string;
  initialTemplate?: PageTemplateDiscoveryItem | null;
  onClose: () => void;
  onCreated: (page: any) => void;
}) {
  const { t } = useTranslation();
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [step, setStep] = useState<0 | 1>(initialTemplate ? 1 : 0);
  const [selectedTemplate, setSelectedTemplate] =
    useState<PageTemplateDiscoveryItem | null>(initialTemplate ?? null);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 200);
  const [items, setItems] = useState<PageTemplateDiscoveryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const templateRequestRef = useRef(0);

  const [title, setTitle] = useState(initialTemplate?.title ?? "");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [debouncedDestinationQuery] = useDebouncedValue(destinationQuery, 200);
  const [destinations, setDestinations] = useState<PageTemplateDestination[]>(
    [],
  );
  const [destinationNextCursor, setDestinationNextCursor] = useState<
    string | null
  >(null);
  const [rootAllowed, setRootAllowed] = useState(false);
  const [selectedParent, setSelectedParent] = useState<"root" | string>();
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [destinationsLoadingMore, setDestinationsLoadingMore] = useState(false);
  const [destinationsError, setDestinationsError] = useState(false);
  const destinationRequestRef = useRef(0);
  const defaultParentResolvedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const loadTemplates = useCallback(
    async (cursor?: string) => {
      const requestId = ++templateRequestRef.current;
      const append = Boolean(cursor);
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setLoadingMore(false);
      }
      if (!append) setLoadError(false);
      try {
        const result = await discoverPageTemplates({
          spaceId,
          query: debouncedQuery || undefined,
          cursor,
          limit: 20,
          archiveState: "active",
        });
        if (requestId !== templateRequestRef.current) return;
        setItems((current) => {
          if (!append) return result.items;
          const byId = new Map(current.map((item) => [item.id, item]));
          result.items.forEach((item) => byId.set(item.id, item));
          return [...byId.values()];
        });
        setNextCursor(result.nextCursor);
      } catch {
        if (requestId !== templateRequestRef.current) return;
        if (!append) {
          setItems([]);
          setNextCursor(null);
          setLoadError(true);
        } else {
          notifications.show({
            color: "red",
            message: t("Could not load more templates."),
          });
        }
      } finally {
        if (requestId === templateRequestRef.current) {
          append ? setLoadingMore(false) : setLoading(false);
        }
      }
    },
    [debouncedQuery, spaceId, t],
  );

  useEffect(() => {
    if (!opened) return;
    void loadTemplates();
  }, [loadTemplates, opened]);

  useEffect(() => {
    if (!opened) return;
    setStep(initialTemplate ? 1 : 0);
    setSelectedTemplate(initialTemplate ?? null);
    setTitle(initialTemplate?.title ?? "");
    setQuery("");
    setDestinationQuery("");
    setSelectedParent(undefined);
    defaultParentResolvedRef.current = false;
  }, [initialTemplate, opened]);

  const loadDestinations = useCallback(
    async (cursor?: string) => {
      if (!selectedTemplate) return;
      const requestId = ++destinationRequestRef.current;
      const append = Boolean(cursor);
      if (append) {
        setDestinationsLoadingMore(true);
      } else {
        setDestinationsLoading(true);
        setDestinationsLoadingMore(false);
      }
      if (!append) setDestinationsError(false);
      try {
        const result = await getPageTemplateDestinations({
          spaceId,
          query: debouncedDestinationQuery || undefined,
          cursor,
          limit: 20,
        });
        let nextItems = result.items;
        const shouldResolveDefaultParent = Boolean(
          !append &&
            !debouncedDestinationQuery &&
            !defaultParentResolvedRef.current &&
            defaultParentPageId,
        );
        let resolvedDefaultParentId: string | undefined;
        if (shouldResolveDefaultParent && defaultParentPageId) {
          const listedDefault = nextItems.find(
            (item) => item.id === defaultParentPageId,
          );
          if (listedDefault) {
            resolvedDefaultParentId = listedDefault.id;
          } else {
            try {
              const exactResult = await getPageTemplateDestinations({
                spaceId,
                purpose: "destination",
                pageId: defaultParentPageId,
                limit: 1,
              });
              const exactDefault = exactResult.items.find(
                (item) => item.id === defaultParentPageId,
              );
              if (exactDefault) {
                resolvedDefaultParentId = exactDefault.id;
                nextItems = [exactDefault, ...nextItems];
              }
            } catch {
              // The canonical destination result fails closed.
            }
          }
        }
        if (requestId !== destinationRequestRef.current) return;
        if (shouldResolveDefaultParent) {
          defaultParentResolvedRef.current = true;
        }
        setRootAllowed(result.rootAllowed);
        setDestinations((current) => {
          if (!append) return nextItems;
          const byId = new Map(current.map((item) => [item.id, item]));
          nextItems.forEach((item) => byId.set(item.id, item));
          return [...byId.values()];
        });
        setDestinationNextCursor(result.nextCursor);
        setSelectedParent((current) => {
          if (current) return current;
          return resolvedDefaultParentId
            ? resolvedDefaultParentId
            : result.rootAllowed
              ? "root"
              : undefined;
        });
      } catch {
        if (requestId !== destinationRequestRef.current) return;
        if (!append) {
          setDestinations([]);
          setDestinationNextCursor(null);
          setDestinationsError(true);
        } else {
          notifications.show({
            color: "red",
            message: t("Could not load destinations"),
          });
        }
      } finally {
        if (requestId === destinationRequestRef.current) {
          append
            ? setDestinationsLoadingMore(false)
            : setDestinationsLoading(false);
        }
      }
    },
    [
      debouncedDestinationQuery,
      defaultParentPageId,
      selectedTemplate,
      spaceId,
      t,
    ],
  );

  useEffect(() => {
    if (!opened || step !== 1 || !selectedTemplate) return;
    void loadDestinations();
  }, [loadDestinations, opened, selectedTemplate, step]);

  const chooseTemplate = (template: PageTemplateDiscoveryItem) => {
    setSelectedTemplate(template);
    setTitle(template.title ?? "");
    setStep(1);
  };

  const submit = async () => {
    if (submitting || !selectedTemplate || !selectedParent) return;
    setSubmitting(true);
    try {
      const result = await createPageFromTemplate({
        templatePageId: selectedTemplate.id,
        spaceId,
        parentPageId: selectedParent === "root" ? undefined : selectedParent,
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
    <Modal
      opened={opened}
      onClose={submitting ? () => undefined : onClose}
      title={t("Create page from template")}
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
      {step === 0 ? (
        <Stack gap="md">
          <TextInput
            label={t("Search templates")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("Search templates")}
            leftSection={<IconSearch size={16} />}
            autoFocus
          />
          {!debouncedQuery && (
            <Text size="sm" fw={600}>
              {t("Recently updated")}
            </Text>
          )}
          <ScrollArea
            h={isMobile ? "clamp(8rem, calc(100dvh - 190px), 32rem)" : 360}
          >
            {loading ? (
              <Center py="xl" role="status">
                <Loader size="sm" />
              </Center>
            ) : loadError ? (
              <EmptyState
                compact
                icon={IconAlertCircle}
                title={t("Could not load templates")}
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
            ) : items.length === 0 ? (
              <EmptyState
                compact
                icon={IconTemplate}
                title={t("No matching templates")}
                description={t("Try a different search term.")}
                action={
                  nextCursor ? (
                    <Button
                      variant="light"
                      loading={loadingMore}
                      onClick={() => void loadTemplates(nextCursor)}
                    >
                      {t("Load more")}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <Stack gap={4}>
                {items.map((item) => (
                  <PickerOption
                    key={item.id}
                    selected={selectedTemplate?.id === item.id}
                    title={item.title || t("Untitled")}
                    description={
                      item.kind === "synced"
                        ? t(
                            "This page stays linked. Template blocks are read-only; fields are yours to fill.",
                          )
                        : t(
                            "This page is an independent copy and will not receive template updates.",
                          )
                    }
                    outcome={
                      item.kind === "synced"
                        ? t("Linked page")
                        : t("Independent copy")
                    }
                    status={
                      item.kind === "synced" && item.publishedRevision
                        ? t("Published v{{version}}", {
                            version: item.publishedRevision,
                          })
                        : undefined
                    }
                    disabled={!item.actions.use}
                    disabledReason={
                      item.archiveState === "archived"
                        ? t("Archived")
                        : item.kind === "synced" && !item.publishedRevision
                          ? t("Not published")
                          : !item.actions.use
                            ? t("Action is not allowed")
                            : undefined
                    }
                    icon={item.icon || <IconTemplate size={18} />}
                    onClick={() => chooseTemplate(item)}
                  />
                ))}
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
          </ScrollArea>
        </Stack>
      ) : (
        <Stack gap="md">
          <Alert
            color={selectedTemplate?.kind === "synced" ? "teal" : "blue"}
            icon={<IconTemplate size={18} />}
          >
            <Group gap="xs" wrap="wrap">
              <Text fw={600} lineClamp={1}>
                {selectedTemplate?.title || t("Untitled")}
              </Text>
              <Badge size="xs" variant="light">
                {selectedTemplate?.kind === "synced"
                  ? t("Linked page")
                  : t("Independent copy")}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              {selectedTemplate?.kind === "synced"
                ? t(
                    "This page stays linked. Template blocks are read-only; fields are yours to fill.",
                  )
                : t(
                    "This page is an independent copy and will not receive template updates.",
                  )}
            </Text>
          </Alert>

          <TextInput
            label={t("Page title")}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            placeholder={selectedTemplate?.title || t("Untitled")}
          />
          <Divider label={t("Choose page destination")} labelPosition="left" />
          <TextInput
            label={t("Search parent pages")}
            value={destinationQuery}
            onChange={(event) => setDestinationQuery(event.currentTarget.value)}
            placeholder={t("Search parent pages")}
            leftSection={<IconSearch size={16} />}
          />
          <ScrollArea
            h={isMobile ? "clamp(8rem, calc(100dvh - 430px), 16.25rem)" : 260}
          >
            {destinationsLoading ? (
              <Center py="xl" role="status">
                <Loader size="sm" />
              </Center>
            ) : destinationsError ? (
              <EmptyState
                compact
                icon={IconAlertCircle}
                title={t("Could not load destinations")}
                action={
                  <Button
                    variant="light"
                    leftSection={<IconRefresh size={16} />}
                    onClick={() => void loadDestinations()}
                  >
                    {t("Retry")}
                  </Button>
                }
              />
            ) : (
              <Stack gap={4}>
                {rootAllowed && (
                  <PickerOption
                    selected={selectedParent === "root"}
                    title={t("Space root")}
                    description={t("Create a top-level page.")}
                    icon={<IconFolder size={18} />}
                    onClick={() => {
                      setSelectedParent("root");
                    }}
                  />
                )}
                {destinations.map((item) => (
                  <PickerOption
                    key={item.id}
                    selected={selectedParent === item.id}
                    title={item.title || t("Untitled")}
                    icon={item.icon || <IconFile size={18} />}
                    onClick={() => {
                      setSelectedParent(item.id);
                    }}
                  />
                ))}
                {!rootAllowed && destinations.length === 0 && (
                  <EmptyState
                    compact
                    icon={IconFolder}
                    title={t("No available destinations")}
                    description={t(
                      "You do not have permission to create a page in the available locations.",
                    )}
                  />
                )}
                {destinationNextCursor && (
                  <Button
                    variant="subtle"
                    loading={destinationsLoadingMore}
                    onClick={() => void loadDestinations(destinationNextCursor)}
                  >
                    {t("Load more")}
                  </Button>
                )}
              </Stack>
            )}
          </ScrollArea>
          <Group justify="space-between" wrap="nowrap">
            <Button
              variant="default"
              leftSection={<IconArrowLeft size={16} />}
              disabled={submitting}
              onClick={() => setStep(0)}
            >
              {t("Back")}
            </Button>
            <Button
              loading={submitting}
              disabled={!title.trim() || !selectedParent || destinationsError}
              onClick={() => void submit()}
            >
              {t("Create page")}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function PickerOption({
  selected,
  title,
  description,
  outcome,
  status,
  disabled,
  disabledReason,
  icon,
  onClick,
}: {
  selected: boolean;
  title: string;
  description?: string;
  outcome?: string;
  status?: string;
  disabled?: boolean;
  disabledReason?: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  const descriptionId = useId();
  return (
    <UnstyledButton
      className={classes.item}
      data-selected={selected || undefined}
      aria-pressed={selected}
      aria-disabled={disabled || undefined}
      aria-describedby={disabledReason ? descriptionId : undefined}
      onClick={disabled ? undefined : onClick}
    >
      <Group gap="sm" wrap="nowrap">
        <Text className={classes.icon} aria-hidden>
          {icon}
        </Text>
        <div className={classes.content}>
          <Text fw={500} lineClamp={1}>
            {title}
          </Text>
          <Group gap="xs" wrap="wrap">
            {outcome && (
              <Badge size="xs" variant="light">
                {outcome}
              </Badge>
            )}
            {description && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {description}
              </Text>
            )}
            {status && (
              <Badge size="xs" variant="light" color="teal">
                {status}
              </Badge>
            )}
            {disabledReason && (
              <Text id={descriptionId} size="xs" c="dimmed">
                {disabledReason}
              </Text>
            )}
          </Group>
        </div>
      </Group>
    </UnstyledButton>
  );
}
