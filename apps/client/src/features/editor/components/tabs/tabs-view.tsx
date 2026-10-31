import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { Button, Group, Menu, Modal, Stack, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconDots, IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { generateNodeId } from "@docmost/editor-ext";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon";
import { useEditorEditable } from "../transclusion/use-editor-editable";
import classes from "./tabs-view.module.css";

const activeTabs = new Map<string, string>();

export default function TabsView({ editor, node, getPos }: NodeViewProps) {
  const { t } = useTranslation();
  const editable = useEditorEditable(editor);
  const scope = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const location = useLocation();
  const wrapper = useRef<HTMLDivElement>(null);
  const handledHash = useRef("");
  const lastSearchMatch = useRef("");
  const attributes = editor.options.editorProps.attributes;
  const owner =
    typeof attributes === "object"
      ? attributes?.["data-editor-view-key"]
      : undefined;
  const cacheKey =
    typeof owner === "string" && typeof node.attrs.id === "string"
      ? `${owner}:${node.attrs.id}`
      : undefined;
  const [selected, setLocalSelected] = useState<string | null>(() =>
    cacheKey ? (activeTabs.get(cacheKey) ?? null) : null,
  );
  const setSelected = (id: string) => {
    if (cacheKey) {
      activeTabs.delete(cacheKey);
      activeTabs.set(cacheKey, id);
      if (activeTabs.size > 100)
        activeTabs.delete(activeTabs.keys().next().value!);
    }
    setLocalSelected(id);
  };
  const [rename, setRename] = useState<{
    id: string;
    title: string;
    base: string;
  } | null>(null);
  const [renameConflict, setRenameConflict] = useState(false);
  const entries: { id: string; title: string; offset: number; size: number }[] =
    [];
  node.forEach((child, offset) =>
    entries.push({
      id:
        typeof child.attrs.id === "string"
          ? child.attrs.id
          : `position-${offset}`,
      title:
        typeof child.attrs.title === "string"
          ? child.attrs.title
          : t("Untitled"),
      offset,
      size: child.nodeSize,
    }),
  );
  const index = Math.max(
    0,
    entries.findIndex((entry) => entry.id === selected),
  );
  const active = entries[index];
  useEffect(() => {
    if (selected !== null)
      document
        .getElementById(`${scope}-tab-${index}`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index, scope, selected]);
  useEffect(() => {
    const revealHash = () => {
      let hash: string;
      try {
        hash = decodeURIComponent(location.hash || window.location.hash);
      } catch {
        return;
      }
      if (!hash || hash === handledHash.current) return;
      const id = hash.slice(1);
      let target = entries.find((entry) => entry.id === id);
      node.descendants((child, position) => {
        if (child.type.name === "heading" && child.attrs.id === id)
          target = entries.find(
            (entry) =>
              position >= entry.offset && position < entry.offset + entry.size,
          );
      });
      if (!target) return;
      handledHash.current = hash;
      setSelected(target.id);
      requestAnimationFrame(() => {
        const anchor = Array.from(
          wrapper.current?.querySelectorAll("[id]") ?? [],
        ).find((element) => element.id === id);
        (anchor?.hasAttribute("data-tab-heading")
          ? anchor.closest('[data-type="tabItem"]')
          : anchor
        )?.scrollIntoView({ block: "start" });
      });
    };
    revealHash();
    window.addEventListener("hashchange", revealHash);
    return () => window.removeEventListener("hashchange", revealHash);
  }, [node, location.hash]);
  function current(id: string) {
    const position = getPos();
    if (typeof position !== "number" || !editor.isEditable) return;
    const block = editor.state.doc.nodeAt(position);
    if (block?.type.name !== "tabs") return;
    let result:
      | { node: typeof node; position: number; index: number }
      | undefined;
    block.forEach((child, offset, index) => {
      if ((child.attrs.id ?? `position-${offset}`) === id)
        result = { node: child, position: position + 1 + offset, index };
    });
    return result;
  }
  useEffect(() => {
    const selectMatch = (matchPosition: number, force = false) => {
      let position: number | undefined;
      try {
        position = getPos();
      } catch {
        return false;
      }
      if (typeof position !== "number") return false;
      const entry = entries.find(
        (item) =>
          matchPosition >= position + 1 + item.offset &&
          matchPosition < position + 1 + item.offset + item.size,
      );
      if (!entry) return false;
      const search = editor.storage.searchAndReplace;
      const key = `${search?.searchTerm}:${search?.resultIndex}:${matchPosition}:${entry.id}`;
      if (!force && lastSearchMatch.current === key) return true;
      lastSearchMatch.current = key;
      setSelected(entry.id);
      requestAnimationFrame(() => {
        if (!editor.isDestroyed)
          editor.view.dom
            .querySelector(".search-result-current")
            ?.scrollIntoView({ block: "center" });
      });
      return true;
    };
    const reveal = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.editor === editor &&
        typeof detail.position === "number" &&
        selectMatch(detail.position, true)
      )
        event.preventDefault();
    };
    const currentMatch = () => {
      const search = editor.storage.searchAndReplace;
      const match = search?.results?.[search.resultIndex];
      if (search?.searchTerm && match) selectMatch(match.from);
      else lastSearchMatch.current = "";
    };
    document.addEventListener("docmost:reveal-search-match", reveal);
    editor.on("transaction", currentMatch);
    currentMatch();
    return () => {
      document.removeEventListener("docmost:reveal-search-match", reveal);
      editor.off("transaction", currentMatch);
    };
  });
  const add = () => {
    if (!editor.isEditable) return;
    const position = getPos();
    if (typeof position !== "number") return;
    const block = editor.state.doc.nodeAt(position);
    if (block?.type.name !== "tabs") return;
    const id = generateNodeId();
    const item = editor.schema.nodes.tabItem.create(
      { id, title: t("docBlocks.tabNumber", { number: block.childCount + 1 }) },
      editor.schema.nodes.paragraph.create(),
    );
    editor.view.dispatch(
      editor.state.tr.insert(position + block.nodeSize - 1, item),
    );
    setSelected(id);
  };
  const duplicate = () => {
    const item = current(active.id);
    if (!item) return;
    const id = generateNodeId();
    editor.view.dispatch(
      editor.state.tr.insert(
        item.position + item.node.nodeSize,
        item.node.type.create({ ...item.node.attrs, id }, item.node.content),
      ),
    );
    setSelected(id);
  };
  const move = (delta: -1 | 1) => {
    const item = current(active.id);
    const position = getPos();
    if (!item || typeof position !== "number") return;
    const block = editor.state.doc.nodeAt(position)!;
    const neighbor = item.index + delta;
    if (neighbor < 0 || neighbor >= block.childCount) return;
    const target =
      delta < 0
        ? item.position - block.child(neighbor).nodeSize
        : item.position + block.child(neighbor).nodeSize;
    editor.view.dispatch(
      editor.state.tr
        .delete(item.position, item.position + item.node.nodeSize)
        .insert(target, item.node),
    );
  };
  const remove = () => {
    if (entries.length <= 1) return;
    modals.openConfirmModal({
      title: t("docBlocks.deleteTab"),
      children: t("docBlocks.deleteTabDescription"),
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => {
        const item = current(active.id);
        if (item)
          editor.view.dispatch(
            editor.state.tr.delete(
              item.position,
              item.position + item.node.nodeSize,
            ),
          );
      },
    });
  };
  return (
    <NodeViewWrapper
      ref={wrapper}
      className={classes.root}
      data-type="tabs"
      data-docmost-tabs-scope={scope}
    >
      <style
        contentEditable={false}
      >{`[data-docmost-tabs-scope="${scope}"] section[data-type="tabItem"] { display: none; } [data-docmost-tabs-scope="${scope}"] section[data-type="tabItem"]:nth-of-type(${index + 1}) { display: block; }`}</style>
      <Group wrap="nowrap" contentEditable={false} align="start">
        <div
          className={classes.navigation}
          role="tablist"
          aria-label={t("docBlocks.tabs")}
          onKeyDown={(event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % entries.length
                : event.key === "ArrowLeft"
                  ? (index + entries.length - 1) % entries.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? entries.length - 1
                      : null;
            if (next === null) return;
            event.preventDefault();
            setSelected(entries[next].id);
            document.getElementById(`${scope}-tab-${next}`)?.focus();
          }}
        >
          {entries.map((entry, tabIndex) => (
            <Button
              key={entry.id}
              role="tab"
              id={`${scope}-tab-${tabIndex}`}
              aria-controls={`${scope}-panel`}
              aria-selected={index === tabIndex}
              tabIndex={index === tabIndex ? 0 : -1}
              variant={index === tabIndex ? "light" : "subtle"}
              size="compact-md"
              style={{ flexShrink: 0, minHeight: 32 }}
              onClick={() => setSelected(entry.id)}
            >
              {entry.title}
            </Button>
          ))}
        </div>
        {editable && (
          <Group gap={0} wrap="nowrap">
            <AccessibleActionIcon
              label={t("docBlocks.addTab")}
              variant="subtle"
              onClick={add}
            >
              <IconPlus size={18} />
            </AccessibleActionIcon>
            {active && (
              <Menu withinPortal>
                <Menu.Target>
                  <AccessibleActionIcon
                    label={t("docBlocks.tabActions")}
                    variant="subtle"
                  >
                    <IconDots size={18} />
                  </AccessibleActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    onClick={() => {
                      setRenameConflict(false);
                      setRename({
                        id: active.id,
                        title: active.title,
                        base: active.title,
                      });
                    }}
                  >
                    {t("Rename")}
                  </Menu.Item>
                  <Menu.Item onClick={duplicate}>{t("Duplicate")}</Menu.Item>
                  <Menu.Item disabled={index === 0} onClick={() => move(-1)}>
                    {t("docBlocks.moveTabLeft")}
                  </Menu.Item>
                  <Menu.Item
                    disabled={index === entries.length - 1}
                    onClick={() => move(1)}
                  >
                    {t("docBlocks.moveTabRight")}
                  </Menu.Item>
                  <Menu.Item
                    color="red"
                    disabled={entries.length <= 1}
                    onClick={remove}
                  >
                    {t("docBlocks.deleteTab")}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        )}
      </Group>
      <div
        role="tabpanel"
        id={`${scope}-panel`}
        aria-labelledby={`${scope}-tab-${index}`}
      >
        <NodeViewContent className={classes.content} />
      </div>
      <Modal
        opened={Boolean(rename)}
        onClose={() => setRename(null)}
        title={t("Rename")}
        withinPortal
      >
        {rename && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const item = current(rename.id);
              if (!item || item.node.attrs.title !== rename.base) {
                setRenameConflict(true);
                return;
              }
              editor.view.dispatch(
                editor.state.tr.setNodeMarkup(item.position, undefined, {
                  ...item.node.attrs,
                  title: rename.title.trim(),
                }),
              );
              setRename(null);
            }}
          >
            <Stack>
              <TextInput
                label={t("Name")}
                maxLength={200}
                value={rename.title}
                onChange={(event) =>
                  setRename({ ...rename, title: event.currentTarget.value })
                }
                error={renameConflict ? t("docBlocks.tabChanged") : undefined}
                data-autofocus
              />
              <Group justify="end">
                <Button variant="default" onClick={() => setRename(null)}>
                  {t("Cancel")}
                </Button>
                <Button type="submit" disabled={!rename.title.trim()}>
                  {t("Save")}
                </Button>
              </Group>
            </Stack>
          </form>
        )}
      </Modal>
    </NodeViewWrapper>
  );
}
