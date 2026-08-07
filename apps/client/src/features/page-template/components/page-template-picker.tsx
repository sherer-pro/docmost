import { useEffect, useState } from "react";
import {
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import type { Editor, Range } from "@tiptap/core";
import { useNavigate } from "react-router-dom";
import {
  createPageFromTemplate,
  discoverPageTemplates,
  hashProseMirrorJson,
  insertPageEmbed,
} from "../services/page-template-api";
import type { PageTemplateDiscoveryItem } from "../types/page-template.types";
import classes from "./page-template-picker.module.css";

type PickerRequest =
  | { mode: "live"; editor: Editor; range: Range }
  | { mode: "snapshot" };

export const PAGE_TEMPLATE_PICKER_EVENT = "docmost:page-template-picker";
type PickerTab = "all" | "favorites" | "recent";
const PICKER_TAB_STORAGE_KEY = "docmost:page-template-picker-tab";

export function PageTemplatePicker({
  pageId,
  spaceId,
}: {
  pageId: string;
  spaceId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [request, setRequest] = useState<PickerRequest | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 200);
  const [items, setItems] = useState<PageTemplateDiscoveryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<PickerTab>(() => {
    const stored = localStorage.getItem(PICKER_TAB_STORAGE_KEY);
    return stored === "favorites" || stored === "recent" ? stored : "all";
  });
  const [loading, setLoading] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  useEffect(() => {
    const listener = (event: Event) => {
      setRequest((event as CustomEvent<PickerRequest>).detail);
      setQuery("");
    };
    window.addEventListener(PAGE_TEMPLATE_PICKER_EVENT, listener);
    return () =>
      window.removeEventListener(PAGE_TEMPLATE_PICKER_EVENT, listener);
  }, []);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    setLoading(true);
    discoverPageTemplates({
      spaceId,
      query: debouncedQuery || undefined,
      limit: 50,
    })
      .then((result) => {
        if (!cancelled) {
          setItems(result.items);
          setNextCursor(result.nextCursor);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setNextCursor(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, request, spaceId]);

  const loadMore = async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const result = await discoverPageTemplates({
        spaceId,
        query: debouncedQuery || undefined,
        cursor: nextCursor,
        limit: 50,
      });
      setItems((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const item of result.items) byId.set(item.id, item);
        return [...byId.values()];
      });
      setNextCursor(result.nextCursor);
    } finally {
      setLoading(false);
    }
  };

  const visibleItems = items.filter(
    (item) =>
      (request?.mode === "snapshot"
        ? item.actions.snapshot
        : item.actions.liveEmbed) &&
      (tab === "all" ||
        (tab === "favorites" && item.favorite) ||
        (tab === "recent" && item.recent)),
  );

  const select = async (template: PageTemplateDiscoveryItem) => {
    if (!request) return;
    setSubmittingId(template.id);
    try {
      if (request.mode === "live") {
        await insertPageEmbed({
          consumerPageId: pageId,
          sourcePageId: template.id,
          from: request.range.from,
          to: request.range.to,
          baseContentHash: await hashProseMirrorJson(request.editor.getJSON()),
        });
      } else {
        const result = await createPageFromTemplate({
          templatePageId: template.id,
          spaceId,
          parentPageId: pageId,
        });
        navigate(`/p/${result.page.slugId}`);
      }
      setRequest(null);
    } catch (error: any) {
      notifications.show({
        color: "red",
        message:
          error?.response?.data?.message ??
          t("The page changed. Refresh and try again."),
      });
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <Modal
      opened={Boolean(request)}
      onClose={() => setRequest(null)}
      title={
        request?.mode === "snapshot"
          ? t("Create page from template")
          : t("Embed template page")
      }
      centered
      size="lg"
    >
      <Stack gap="sm">
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("Search templates")}
          autoFocus
        />
        <SegmentedControl
          fullWidth
          value={tab}
          data={[
            { value: "all", label: t("Page templates") },
            { value: "favorites", label: t("Favorites") },
            { value: "recent", label: t("Recently updated") },
          ]}
          onChange={(value) => {
            const nextTab = value as PickerTab;
            setTab(nextTab);
            localStorage.setItem(PICKER_TAB_STORAGE_KEY, nextTab);
          }}
        />
        <ScrollArea h={360}>
          {loading && items.length === 0 ? (
            <Group justify="center" py="xl">
              <Loader size="sm" />
            </Group>
          ) : visibleItems.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">
              {t("No templates found")}
            </Text>
          ) : (
            <Stack gap={4}>
              {visibleItems.map((item) => (
                <UnstyledButton
                  key={item.id}
                  className={classes.item}
                  disabled={Boolean(submittingId)}
                  onClick={() => void select(item)}
                >
                  <Group wrap="nowrap" justify="space-between">
                    <Group gap="sm" wrap="nowrap">
                      <Text aria-hidden>{item.icon || "📄"}</Text>
                      <div>
                        <Text fw={500} lineClamp={1}>
                          {item.title || t("Untitled")}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {item.spaceName}
                        </Text>
                      </div>
                    </Group>
                    {submittingId === item.id && <Loader size="xs" />}
                  </Group>
                </UnstyledButton>
              ))}
              {nextCursor && (
                <Button
                  variant="subtle"
                  loading={loading}
                  onClick={() => void loadMore()}
                >
                  {t("Load more")}
                </Button>
              )}
            </Stack>
          )}
        </ScrollArea>
      </Stack>
    </Modal>
  );
}
