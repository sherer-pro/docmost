import {
  ActionIcon,
  Button,
  Dialog,
  Flex,
  Input,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowNarrowDown,
  IconArrowNarrowUp,
  IconLetterCase,
  IconReplace,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useEditor, useEditorState } from "@tiptap/react";
import type { Range } from "@tiptap/core";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { searchAndReplaceStateAtom } from "@/features/editor/components/search-and-replace/atoms/search-and-replace-state-atom.ts";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { getHotkeyHandler, useToggle } from "@mantine/hooks";
import { useLocation } from "react-router-dom";
import classes from "./search-replace.module.css";
import { useEditorIsolation } from "../../editor-isolation-context";

interface PageFindDialogDialogProps {
  editor: ReturnType<typeof useEditor>;
  editable?: boolean;
}

function SearchAndReplaceDialog({
  editor,
  editable = true,
}: PageFindDialogDialogProps) {
  const { t } = useTranslation();
  const isolated = useEditorIsolation();
  const [searchText, setSearchText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [pageFindState, setPageFindState] = useAtom(searchAndReplaceStateAtom);
  const inputRef = useRef(null);
  const searchSnapshot = useEditorState({
    editor,
    selector: ({ editor }) => {
      const search = editor?.isDestroyed
        ? undefined
        : editor?.storage.searchAndReplace;
      return {
        count: search?.results?.length ?? 0,
        index: search?.resultIndex ?? 0,
        readOnly: Boolean(
          search?.results?.[search?.resultIndex ?? 0]?.readOnly,
        ),
        replaceable:
          search?.results?.some((result) => !result.readOnly) ?? false,
      };
    },
  });
  const canSearch = () =>
    Boolean(editor && !editor.isDestroyed && editor.storage.searchAndReplace);

  const [replaceButton, replaceButtonToggle] = useToggle([
    { isReplaceShow: false, color: "gray" },
    { isReplaceShow: true, color: "blue" },
  ]);

  const [caseSensitive, caseSensitiveToggle] = useToggle([
    { isCaseSensitive: false, color: "gray" },
    { isCaseSensitive: true, color: "blue" },
  ]);

  const searchInputEvent = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(event.target.value);
  };

  const replaceInputEvent = (event: React.ChangeEvent<HTMLInputElement>) => {
    setReplaceText(event.target.value);
  };

  const closeDialog = () => {
    setSearchText("");
    setReplaceText("");
    setPageFindState({ isOpen: false });
    // Reset replace button state when closing
    if (replaceButton.isReplaceShow) {
      replaceButtonToggle();
    }
    // Clear search term in editor
    if (canSearch()) {
      editor.commands.setSearchTerm("");
    }
  };

  const goToSelection = () => {
    if (!canSearch()) return;

    const { results, resultIndex } = editor.storage.searchAndReplace;
    //TODO: check type error
    //@ts-ignore
    const position: Range = results[resultIndex];

    if (!position) return;

    // @ts-ignore
    editor.commands.setTextSelection(position);
    document.dispatchEvent(
      new CustomEvent("docmost:reveal-search-match", {
        detail: { editor, position: position.from },
      }),
    );

    const element = editor.view.dom.querySelector(".search-result-current");
    if (element)
      element.scrollIntoView({ behavior: "smooth", block: "center" });

    editor.commands.setTextSelection(0);
  };

  const next = () => {
    if (!canSearch()) return;
    editor.commands.nextSearchResult();
    goToSelection();
  };

  const previous = () => {
    if (!canSearch()) return;
    editor.commands.previousSearchResult();
    goToSelection();
  };

  const replace = () => {
    if (!canSearch()) return;
    editor.commands.setReplaceTerm(replaceText);
    editor.commands.replace();
    goToSelection();
  };

  const replaceAll = () => {
    if (!canSearch()) return;
    editor.commands.setReplaceTerm(replaceText);
    editor.commands.replaceAll();
  };

  useEffect(() => {
    if (!canSearch()) return;
    editor.commands.setSearchTerm(searchText);
    editor.commands.resetIndex();
    editor.commands.selectCurrentItem();
  }, [editor, searchText]);

  const handleOpenEvent = (e) => {
    if (e.detail?.editor ? e.detail.editor !== editor : isolated) return;
    if (!canSearch()) return;
    setPageFindState({ isOpen: true });
    const selectedText = editor.state.doc.textBetween(
      editor.state.selection.from,
      editor.state.selection.to,
    );
    if (selectedText !== "") {
      setSearchText(selectedText);
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const handleCloseEvent = (e) => {
    if (e.detail?.editor ? e.detail.editor !== editor : isolated) return;
    closeDialog();
  };

  useEffect(() => {
    !pageFindState.isOpen && closeDialog();

    document.addEventListener("openFindDialogFromEditor", handleOpenEvent);
    document.addEventListener("closeFindDialogFromEditor", handleCloseEvent);

    return () => {
      document.removeEventListener("openFindDialogFromEditor", handleOpenEvent);
      document.removeEventListener(
        "closeFindDialogFromEditor",
        handleCloseEvent,
      );
    };
  }, [editor, pageFindState.isOpen]);

  useEffect(() => {
    if (!canSearch()) return;
    const dom = editor?.view?.dom;
    if (!dom) return;
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        handleOpenEvent(
          new CustomEvent("openFindDialogFromEditor", { detail: { editor } }),
        );
      } else if (event.key === "Escape" && pageFindState.isOpen) {
        event.preventDefault();
        event.stopPropagation();
        closeDialog();
      }
    };
    dom.addEventListener("keydown", keyboard);
    return () => dom.removeEventListener("keydown", keyboard);
  }, [editor, pageFindState.isOpen, isolated]);

  useEffect(() => {
    if (!canSearch()) return;
    editor.commands.setCaseSensitive(caseSensitive.isCaseSensitive);
    editor.commands.resetIndex();
    goToSelection();
  }, [editor, caseSensitive]);

  const resultsCount = useMemo(
    () =>
      searchText.trim() === ""
        ? ""
        : searchSnapshot?.count > 0
          ? searchSnapshot.index + 1 + "/" + searchSnapshot.count
          : t("Not found"),
    [searchText, searchSnapshot?.index, searchSnapshot?.count],
  );

  const location = useLocation();
  useEffect(() => {
    if (isolated) return;
    closeDialog();
    const term = new URLSearchParams(location.search)
      .get("find")
      ?.trim()
      .slice(0, 512);
    if (!term || !canSearch()) return;
    editor.commands.setSearchTerm(term);
    editor.commands.resetIndex();
    setSearchText(term);
    setPageFindState({ isOpen: true });
    let revealed = false;
    const reveal = () => {
      if (revealed || !canSearch()) return;
      const match = editor.view?.dom?.querySelector(
        ".search-result-current",
      ) as HTMLElement | null;
      const position =
        editor.storage.searchAndReplace?.results[
          editor.storage.searchAndReplace?.resultIndex
        ]?.from;
      if (typeof position === "number") {
        const event = new CustomEvent("docmost:reveal-search-match", {
          cancelable: true,
          detail: { editor, position },
        });
        if (!document.dispatchEvent(event) && !match) revealed = true;
      }
      if (!match) return;
      revealed = true;
      for (
        let parent = match.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (parent.tagName === "DETAILS")
          (parent as HTMLDetailsElement).open = true;
      }
      match.dispatchEvent(
        new CustomEvent("docmost:reveal-search-match", { bubbles: true }),
      );
      match.scrollIntoView?.({ block: "center", behavior: "instant" });
    };
    editor.on?.("transaction", reveal);
    const timer = setTimeout(reveal, 0);
    return () => {
      clearTimeout(timer);
      editor.off?.("transaction", reveal);
    };
  }, [editor, location.key, location.pathname, location.search, isolated]);

  return (
    <Dialog
      className={classes.findDialog}
      opened={pageFindState.isOpen}
      size="lg"
      radius="md"
      w={"auto"}
      position={{ top: 90, right: 50 }}
      withBorder
      transitionProps={{ transition: "slide-down" }}
    >
      <Stack gap="xs">
        <Flex align="center" gap="xs">
          <Input
            ref={inputRef}
            placeholder={t("Find")}
            leftSection={<IconSearch size={16} />}
            rightSection={
              <Text size="xs" ta="right">
                {resultsCount}
              </Text>
            }
            rightSectionWidth="70"
            rightSectionPointerEvents="all"
            size="xs"
            w={220}
            onChange={searchInputEvent}
            value={searchText}
            autoFocus
            onKeyDown={getHotkeyHandler([
              ["Escape", closeDialog],
              ["Enter", next],
              ["shift+Enter", previous],
              ["alt+C", caseSensitiveToggle],
              //@ts-ignore
              ...(editable ? [["alt+R", replaceButtonToggle]] : []),
            ])}
          />

          <ActionIcon.Group>
            <Tooltip label={t("Previous match (Shift+Enter)")}>
              <ActionIcon
                aria-label={t("Previous match (Shift+Enter)")}
                variant="subtle"
                color="gray"
                onClick={previous}
              >
                <IconArrowNarrowUp
                  style={{ width: "70%", height: "70%" }}
                  stroke={1.5}
                />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("Next match (Enter)")}>
              <ActionIcon
                aria-label={t("Next match (Enter)")}
                variant="subtle"
                color="gray"
                onClick={next}
              >
                <IconArrowNarrowDown
                  style={{ width: "70%", height: "70%" }}
                  stroke={1.5}
                />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("Match case (Alt+C)")}>
              <ActionIcon
                variant="subtle"
                color={caseSensitive.color}
                aria-label={t("Match case (Alt+C)")}
                onClick={() => caseSensitiveToggle()}
              >
                <IconLetterCase
                  style={{ width: "70%", height: "70%" }}
                  stroke={1.5}
                />
              </ActionIcon>
            </Tooltip>
            {editable && (
              <Tooltip label={t("Replace")}>
                <ActionIcon
                  variant="subtle"
                  color={replaceButton.color}
                  aria-label={t("Replace")}
                  onClick={() => replaceButtonToggle()}
                >
                  <IconReplace
                    style={{ width: "70%", height: "70%" }}
                    stroke={1.5}
                  />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label={t("Close (Escape)")}>
              <ActionIcon
                aria-label={t("Close (Escape)")}
                variant="subtle"
                color="gray"
                onClick={closeDialog}
              >
                <IconX style={{ width: "70%", height: "70%" }} stroke={1.5} />
              </ActionIcon>
            </Tooltip>
          </ActionIcon.Group>
        </Flex>
        {replaceButton.isReplaceShow && editable && (
          <>
            {searchSnapshot?.readOnly && (
              <Text size="xs">{t("integrationPreviews.searchReadOnly")}</Text>
            )}
            <Flex align="center" gap="xs">
              <Input
                placeholder={t("Replace")}
                leftSection={<IconReplace size={16} />}
                rightSection={<div></div>}
                rightSectionPointerEvents="all"
                size="xs"
                w={180}
                autoFocus
                onChange={replaceInputEvent}
                value={replaceText}
                onKeyDown={getHotkeyHandler([
                  ["Escape", closeDialog],
                  ["Enter", replace],
                  ["ctrl+alt+Enter", replaceAll],
                ])}
              />
              <ActionIcon.Group>
                <Tooltip label={t("Replace (Enter)")}>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={replace}
                    disabled={searchSnapshot?.readOnly}
                  >
                    {t("Replace")}
                  </Button>
                </Tooltip>
                <Tooltip label={t("Replace all (Ctrl+Alt+Enter)")}>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={replaceAll}
                    disabled={!searchSnapshot?.replaceable}
                  >
                    {t("Replace all")}
                  </Button>
                </Tooltip>
              </ActionIcon.Group>
            </Flex>
          </>
        )}
      </Stack>
    </Dialog>
  );
}

export default SearchAndReplaceDialog;
