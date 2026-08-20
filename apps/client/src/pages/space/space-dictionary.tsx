import {
  Accordion,
  Alert,
  Button,
  FileButton,
  Group,
  Loader,
  Menu,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconBook2,
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconDotsVertical,
  IconFileExport,
  IconFileImport,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { Helmet } from "react-helmet-async";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";
import { EmptyState } from "@/components/ui/empty-state";
import { DictionaryMarkdown } from "@/features/dictionary/components/dictionary-markdown";
import { DictionaryTermModal } from "@/features/dictionary/components/dictionary-term-modal";
import classes from "@/features/dictionary/components/dictionary.module.css";
import {
  useDeleteDictionaryTermMutation,
  useDictionaryTermsQuery,
  useExportDictionaryTermsMutation,
  useGenerateAllDictionaryWordFormsMutation,
  useImportDictionaryTermsMutation,
  useDictionaryWordFormGenerationStatusQuery,
} from "@/features/dictionary/queries/dictionary-query";
import { parseDictionaryImportJson } from "@/features/dictionary/services/dictionary-service";
import { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";
import { openDictionaryImportConfirmModal } from "@/features/dictionary/utils/dictionary-import-confirmation";
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from "@/features/space/permissions/permissions.type";
import { useSpaceAbility } from "@/features/space/permissions/use-space-ability";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query";
import useUserRole from "@/hooks/use-user-role";
import { getAppName } from "@/lib/config";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";
import { PageFrame, SectionHeader } from "@/components/ui/page-frame";

interface DictionaryGroup {
  letter: string;
  terms: IDictionaryTerm[];
}

const MAX_VISIBLE_FORMS = 4;

function getDictionaryLetter(term: string, locale: string): string {
  const firstCharacter = term.trim().charAt(0);
  return firstCharacter ? firstCharacter.toLocaleUpperCase(locale) : "#";
}

function groupDictionaryTerms(
  terms: IDictionaryTerm[],
  locale: string,
): DictionaryGroup[] {
  const collator = new Intl.Collator(locale, {
    sensitivity: "base",
    numeric: true,
  });
  const sortedTerms = [...terms].sort((left, right) =>
    collator.compare(left.term, right.term),
  );
  const groups = new Map<string, IDictionaryTerm[]>();

  sortedTerms.forEach((term) => {
    const letter = getDictionaryLetter(term.term, locale);
    groups.set(letter, [...(groups.get(letter) ?? []), term]);
  });

  return Array.from(groups.entries()).map(([letter, groupTerms]) => ({
    letter,
    terms: groupTerms,
  }));
}

function termMatchesSearch(
  term: IDictionaryTerm,
  query: string,
  locale: string,
): boolean {
  if (!query) {
    return true;
  }

  return [term.term, ...term.forms, term.definitionMarkdown].some((value) =>
    value.toLocaleLowerCase(locale).includes(query),
  );
}

export default function SpaceDictionary() {
  const { t, i18n } = useTranslation();
  const { spaceSlug } = useParams();
  const [searchParams] = useSearchParams();
  const linkedTermId = searchParams.get("term")?.trim() || null;
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const spaceAbility = useSpaceAbility(space?.membership?.permissions);
  const { isAdmin } = useUserRole();
  const canManageDictionary = spaceAbility.can(
    SpaceCaslAction.Manage,
    SpaceCaslSubject.Page,
  );
  const dictionaryEnabled = space?.settings?.dictionary?.enabled === true;
  const { data: terms = [], isLoading } = useDictionaryTermsQuery(
    space?.id,
    Boolean(space?.id && dictionaryEnabled),
  );
  const wordFormGenerationStatus = useDictionaryWordFormGenerationStatusQuery(
    space?.id,
    Boolean(space?.id && dictionaryEnabled && (isAdmin || canManageDictionary)),
  );
  const deleteMutation = useDeleteDictionaryTermMutation(space?.id);
  const exportMutation = useExportDictionaryTermsMutation();
  const importMutation = useImportDictionaryTermsMutation();
  const generateAllMutation = useGenerateAllDictionaryWordFormsMutation();
  const importJsonResetRef = useRef<() => void>(null);
  const [modalOpened, setModalOpened] = useState(false);
  const [editingTerm, setEditingTerm] = useState<IDictionaryTerm | null>(null);
  const [openedTermIds, setOpenedTermIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const [linkedTermUnavailable, setLinkedTermUnavailable] = useState(false);
  const handledLinkedTermRef = useRef<string | null>(null);

  useEffect(() => {
    if (!linkedTermId) {
      handledLinkedTermRef.current = null;
      setLinkedTermUnavailable(false);
      return;
    }
    if (!space || isLoading || handledLinkedTermRef.current === linkedTermId) {
      return;
    }
    handledLinkedTermRef.current = linkedTermId;
    if (!dictionaryEnabled) {
      setLinkedTermUnavailable(true);
      return;
    }
    const linkedTerm = terms.find((term) => term.id === linkedTermId);
    if (!linkedTerm) {
      setLinkedTermUnavailable(true);
      return;
    }
    setLinkedTermUnavailable(false);
    setSearchQuery("");
    setActiveLetter(null);
    setOpenedTermIds((current) =>
      current.includes(linkedTermId) ? current : [...current, linkedTermId],
    );
    window.requestAnimationFrame(() => {
      const control = document.getElementById(
        `dictionary-term-${linkedTermId}`,
      );
      control?.scrollIntoView({ behavior: "smooth", block: "center" });
      control?.focus({ preventScroll: true });
    });
  }, [dictionaryEnabled, isLoading, linkedTermId, space, terms]);

  const allGroups = useMemo(
    () => groupDictionaryTerms(terms, i18n.language),
    [i18n.language, terms],
  );
  const availableLetters = useMemo(
    () => allGroups.map((group) => group.letter),
    [allGroups],
  );
  const normalizedSearchQuery = searchQuery
    .trim()
    .toLocaleLowerCase(i18n.language);

  const filteredTerms = useMemo(
    () =>
      terms.filter((term) => {
        const matchesLetter =
          !activeLetter ||
          getDictionaryLetter(term.term, i18n.language) === activeLetter;

        return (
          matchesLetter &&
          termMatchesSearch(term, normalizedSearchQuery, i18n.language)
        );
      }),
    [activeLetter, i18n.language, normalizedSearchQuery, terms],
  );
  const groupedTerms = useMemo<DictionaryGroup[]>(
    () => groupDictionaryTerms(filteredTerms, i18n.language),
    [filteredTerms, i18n.language],
  );
  const visibleTermIds = useMemo(
    () => filteredTerms.map((term) => term.id),
    [filteredTerms],
  );
  const allVisibleTermsOpened =
    visibleTermIds.length > 0 &&
    visibleTermIds.every((termId) => openedTermIds.includes(termId));
  const hasActiveFilters = Boolean(normalizedSearchQuery || activeLetter);

  const openCreateModal = () => {
    setEditingTerm(null);
    setModalOpened(true);
  };

  const openEditModal = (term: IDictionaryTerm) => {
    setEditingTerm(term);
    setModalOpened(true);
  };

  const confirmDelete = (term: IDictionaryTerm) => {
    modals.openConfirmModal({
      title: t("Delete dictionary term"),
      children: <Text size="sm">{t("This action cannot be undone.")}</Text>,
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => deleteMutation.mutate(term.id),
    });
  };

  const handleExportJson = () => {
    if (!space?.id) {
      return;
    }

    exportMutation.mutate(space.id);
  };

  const confirmGenerateAllWordForms = () => {
    if (!space?.id) {
      return;
    }

    modals.openConfirmModal({
      title: t("Generate word forms for all terms?"),
      children: (
        <Text size="sm">
          {t(
            "Existing word forms will be kept, and generated forms will be saved immediately.",
          )}
        </Text>
      ),
      labels: { confirm: t("Generate word forms"), cancel: t("Cancel") },
      onConfirm: () => generateAllMutation.mutate(space.id),
    });
  };

  const handleImportJson = async (file: File | null) => {
    if (!file || !space?.id) {
      return;
    }

    let importedTerms: ReturnType<typeof parseDictionaryImportJson>;

    try {
      importedTerms = parseDictionaryImportJson(await file.text());
    } catch {
      notifications.show({
        message: t("Invalid dictionary JSON file"),
        color: "red",
      });
      importJsonResetRef.current?.();
      return;
    }

    importJsonResetRef.current?.();

    openDictionaryImportConfirmModal({
      fileName: file.name,
      termCount: importedTerms.length,
      t,
      onConfirm: async () => {
        try {
          await importMutation.mutateAsync({
            spaceId: space.id,
            terms: importedTerms,
          });
        } catch {
          // The mutation hook already shows the server validation error.
        }
      },
    });
  };

  const setGroupOpenedTerms = (
    groupTerms: IDictionaryTerm[],
    termIds: string[],
  ) => {
    const groupTermIds = groupTerms.map((term) => term.id);

    setOpenedTermIds((currentTermIds) =>
      Array.from(
        new Set([
          ...currentTermIds.filter((termId) => !groupTermIds.includes(termId)),
          ...termIds,
        ]),
      ),
    );
  };

  const toggleVisibleTerms = () => {
    if (allVisibleTermsOpened) {
      setOpenedTermIds((currentTermIds) =>
        currentTermIds.filter((termId) => !visibleTermIds.includes(termId)),
      );
      return;
    }

    setOpenedTermIds((currentTermIds) =>
      Array.from(new Set([...currentTermIds, ...visibleTermIds])),
    );
  };

  const clearFilters = () => {
    setSearchQuery("");
    setActiveLetter(null);
  };

  if (!space) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>
          {t("Dictionary")} - {space.name} - {getAppName()}
        </title>
      </Helmet>

      <PageFrame size="document">
        <SectionHeader
          title={t("Dictionary")}
          description={
            dictionaryEnabled && !isLoading ? (
              <Group gap="md">
                <span>
                  {terms.length} {t("Terms")}
                </span>
                <span>
                  {availableLetters.length} {t("Letters")}
                </span>
              </Group>
            ) : undefined
          }
          actions={
            (isAdmin || canManageDictionary) && dictionaryEnabled ? (
              <Group gap="xs" wrap="wrap">
                {isAdmin && (
                  <>
                    <FileButton
                      accept="application/json,.json"
                      onChange={handleImportJson}
                      resetRef={importJsonResetRef}
                    >
                      {(props) => (
                        <Button
                          variant="default"
                          leftSection={<IconFileImport size={16} />}
                          loading={importMutation.isPending}
                          {...props}
                        >
                          {t("Import JSON")}
                        </Button>
                      )}
                    </FileButton>
                    <Button
                      variant="default"
                      leftSection={<IconFileExport size={16} />}
                      loading={exportMutation.isPending}
                      onClick={handleExportJson}
                    >
                      {t("Export JSON")}
                    </Button>
                    {wordFormGenerationStatus.data?.available &&
                      terms.length > 0 && (
                        <Button
                          variant="default"
                          leftSection={<IconSparkles size={16} />}
                          loading={generateAllMutation.isPending}
                          onClick={confirmGenerateAllWordForms}
                        >
                          {t("Generate for all terms")}
                        </Button>
                      )}
                  </>
                )}
                {canManageDictionary && (
                  <Button
                    leftSection={<IconPlus size={16} />}
                    onClick={openCreateModal}
                  >
                    {t("Add term")}
                  </Button>
                )}
              </Group>
            ) : undefined
          }
        />

        {linkedTermUnavailable ? (
          <Alert
            color="red"
            icon={<IconAlertTriangle size={18} />}
            title={t("Dictionary term is unavailable")}
          >
            {t(
              "The linked dictionary term was deleted, disabled, or is not available in this space.",
            )}
          </Alert>
        ) : !dictionaryEnabled ? (
          <EmptyState
            icon={IconBook2}
            title={t("Dictionary is disabled")}
            description={t("Enable dictionary in space settings.")}
          />
        ) : isLoading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" />
          </Group>
        ) : terms.length === 0 ? (
          <EmptyState
            icon={IconBook2}
            title={t("No dictionary terms yet")}
            description={t(
              "Add the first term to start building this space dictionary.",
            )}
            action={
              canManageDictionary ? (
                <Button
                  leftSection={<IconPlus size={16} />}
                  onClick={openCreateModal}
                >
                  {t("Add term")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Stack gap="xs">
            <Stack className={classes.dictionaryControls} gap="sm">
              <Group align="center" className={classes.filterRow} gap="sm">
                <TextInput
                  className={classes.searchInput}
                  aria-label={t("Search terms, forms, definitions")}
                  placeholder={t("Search terms, forms, definitions")}
                  leftSection={<IconSearch size={16} />}
                  rightSection={
                    searchQuery ? (
                      <AccessibleActionIcon
                        variant="subtle"
                        label={t("Clear search")}
                        onClick={() => setSearchQuery("")}
                      >
                        <IconX size={14} />
                      </AccessibleActionIcon>
                    ) : null
                  }
                  rightSectionPointerEvents={searchQuery ? "all" : "none"}
                  value={searchQuery}
                  onChange={(event) =>
                    setSearchQuery(event.currentTarget.value)
                  }
                />
                <Button
                  className={classes.filterAction}
                  variant="default"
                  leftSection={
                    allVisibleTermsOpened ? (
                      <IconChevronUp size={16} />
                    ) : (
                      <IconChevronDown size={16} />
                    )
                  }
                  disabled={visibleTermIds.length === 0}
                  onClick={toggleVisibleTerms}
                >
                  {allVisibleTermsOpened ? t("Collapse all") : t("Expand all")}
                </Button>
              </Group>

              <ScrollArea type="hover" offsetScrollbars>
                <Group className={classes.letterNav} gap={6} wrap="wrap">
                  <button
                    type="button"
                    className={classes.letterButton}
                    data-active={!activeLetter || undefined}
                    onClick={() => setActiveLetter(null)}
                  >
                    {t("All terms")}
                  </button>
                  {availableLetters.map((letter) => (
                    <button
                      key={letter}
                      type="button"
                      className={classes.letterButton}
                      data-active={activeLetter === letter || undefined}
                      onClick={() => setActiveLetter(letter)}
                    >
                      {letter}
                    </button>
                  ))}
                </Group>
              </ScrollArea>

              <Group justify="space-between" gap="xs">
                <Text className={classes.resultsSummary}>
                  {t("Showing {{shown}} of {{total}} terms", {
                    shown: filteredTerms.length,
                    total: terms.length,
                  })}
                </Text>
                {hasActiveFilters && (
                  <Button variant="subtle" size="xs" onClick={clearFilters}>
                    {t("Clear filters")}
                  </Button>
                )}
              </Group>
            </Stack>

            {groupedTerms.length === 0 ? (
              <EmptyState
                icon={IconSearch}
                title={t("No matching dictionary terms")}
                description={t("Try a different search or letter filter.")}
                action={
                  <Button variant="default" size="sm" onClick={clearFilters}>
                    {t("Clear filters")}
                  </Button>
                }
              />
            ) : (
              groupedTerms.map((group) => (
                <div key={group.letter}>
                  <div className={classes.letter}>{group.letter}</div>
                  <Accordion
                    multiple
                    variant="separated"
                    value={group.terms
                      .filter((term) => openedTermIds.includes(term.id))
                      .map((term) => term.id)}
                    onChange={(termIds) =>
                      setGroupOpenedTerms(group.terms, termIds)
                    }
                  >
                    {group.terms.map((term) => {
                      const isTermOpened = openedTermIds.includes(term.id);
                      const visibleForms = isTermOpened
                        ? term.forms
                        : term.forms.slice(0, MAX_VISIBLE_FORMS);
                      const remainingFormsCount = isTermOpened
                        ? 0
                        : term.forms.length - visibleForms.length;

                      return (
                        <Accordion.Item key={term.id} value={term.id}>
                          <Accordion.Control id={`dictionary-term-${term.id}`}>
                            <Group justify="space-between" wrap="nowrap">
                              <div className={classes.termHeader}>
                                <Text className={classes.termTitle} fw={600}>
                                  {term.term}
                                </Text>
                                {term.forms.length > 0 && (
                                  <Group gap={4} className={classes.formsList}>
                                    {visibleForms.map((form, index) => (
                                      <Text
                                        key={`${form}-${index}`}
                                        component="span"
                                        className={classes.formText}
                                      >
                                        {form}
                                        {index < visibleForms.length - 1
                                          ? ","
                                          : ""}
                                      </Text>
                                    ))}
                                    {remainingFormsCount > 0 && (
                                      <Text
                                        component="span"
                                        className={classes.moreFormsText}
                                      >
                                        {t("+{{count}} more", {
                                          count: remainingFormsCount,
                                        })}
                                      </Text>
                                    )}
                                  </Group>
                                )}
                              </div>
                              {canManageDictionary && (
                                <Menu withinPortal position="bottom-end">
                                  <Menu.Target>
                                    <AccessibleActionIcon
                                      variant="subtle"
                                      label={t("Dictionary term actions")}
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                    >
                                      <IconDotsVertical size={16} />
                                    </AccessibleActionIcon>
                                  </Menu.Target>
                                  <Menu.Dropdown>
                                    <Menu.Item
                                      leftSection={<IconPencil size={16} />}
                                      onClick={() => openEditModal(term)}
                                    >
                                      {t("Edit")}
                                    </Menu.Item>
                                    <Menu.Item
                                      color="red"
                                      leftSection={<IconTrash size={16} />}
                                      onClick={() => confirmDelete(term)}
                                    >
                                      {t("Delete")}
                                    </Menu.Item>
                                  </Menu.Dropdown>
                                </Menu>
                              )}
                            </Group>
                          </Accordion.Control>
                          <Accordion.Panel>
                            {isTermOpened && (
                              <Stack gap="sm">
                                <DictionaryMarkdown
                                  markdown={term.definitionMarkdown}
                                />
                              </Stack>
                            )}
                          </Accordion.Panel>
                        </Accordion.Item>
                      );
                    })}
                  </Accordion>
                </div>
              ))
            )}
          </Stack>
        )}
      </PageFrame>

      <DictionaryTermModal
        opened={modalOpened}
        onClose={() => setModalOpened(false)}
        spaceId={space.id}
        term={editingTerm}
        wordFormGenerationAvailable={Boolean(
          wordFormGenerationStatus.data?.available && canManageDictionary,
        )}
      />
    </>
  );
}
