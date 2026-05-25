import {
  Accordion,
  ActionIcon,
  Button,
  Container,
  Group,
  Loader,
  Menu,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconBook2,
  IconDotsVertical,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { Helmet } from "react-helmet-async";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { EmptyState } from "@/components/ui/empty-state";
import { DictionaryMarkdown } from "@/features/dictionary/components/dictionary-markdown";
import { DictionaryTermModal } from "@/features/dictionary/components/dictionary-term-modal";
import classes from "@/features/dictionary/components/dictionary.module.css";
import {
  useDeleteDictionaryTermMutation,
  useDictionaryTermsQuery,
} from "@/features/dictionary/queries/dictionary-query";
import { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from "@/features/space/permissions/permissions.type";
import { useSpaceAbility } from "@/features/space/permissions/use-space-ability";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query";
import { getAppName } from "@/lib/config";

interface DictionaryGroup {
  letter: string;
  terms: IDictionaryTerm[];
}

function getDictionaryLetter(term: string, locale: string): string {
  const firstCharacter = term.trim().charAt(0);
  return firstCharacter ? firstCharacter.toLocaleUpperCase(locale) : "#";
}

export default function SpaceDictionary() {
  const { t, i18n } = useTranslation();
  const { spaceSlug } = useParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const spaceAbility = useSpaceAbility(space?.membership?.permissions);
  const canManageDictionary = spaceAbility.can(
    SpaceCaslAction.Manage,
    SpaceCaslSubject.Page,
  );
  const dictionaryEnabled = space?.settings?.dictionary?.enabled === true;
  const { data: terms = [], isLoading } = useDictionaryTermsQuery(
    space?.id,
    Boolean(space?.id && dictionaryEnabled),
  );
  const deleteMutation = useDeleteDictionaryTermMutation(space?.id);
  const [modalOpened, setModalOpened] = useState(false);
  const [editingTerm, setEditingTerm] = useState<IDictionaryTerm | null>(null);
  const [openedTermIds, setOpenedTermIds] = useState<Record<string, boolean>>({});

  const groupedTerms = useMemo<DictionaryGroup[]>(() => {
    const collator = new Intl.Collator(i18n.language, {
      sensitivity: "base",
      numeric: true,
    });
    const sortedTerms = [...terms].sort((left, right) =>
      collator.compare(left.term, right.term),
    );
    const groups = new Map<string, IDictionaryTerm[]>();

    sortedTerms.forEach((term) => {
      const letter = getDictionaryLetter(term.term, i18n.language);
      groups.set(letter, [...(groups.get(letter) ?? []), term]);
    });

    return Array.from(groups.entries()).map(([letter, groupTerms]) => ({
      letter,
      terms: groupTerms,
    }));
  }, [i18n.language, terms]);

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

  const setGroupOpenedTerm = (
    groupTerms: IDictionaryTerm[],
    termId: string | null,
  ) => {
    setOpenedTermIds((currentTermIds) => {
      const nextTermIds = { ...currentTermIds };

      groupTerms.forEach((term) => {
        delete nextTermIds[term.id];
      });

      if (termId) {
        nextTermIds[termId] = true;
      }

      return nextTermIds;
    });
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

      <Container size="800" pt="xl">
        <div className={classes.pageHeader}>
          <Title order={2}>{t("Dictionary")}</Title>
          {canManageDictionary && dictionaryEnabled && (
            <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
              {t("Add term")}
            </Button>
          )}
        </div>

        {!dictionaryEnabled ? (
          <EmptyState
            icon={IconBook2}
            title={t("Dictionary is disabled")}
            description={t("Enable dictionary in space settings.")}
          />
        ) : isLoading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" />
          </Group>
        ) : groupedTerms.length === 0 ? (
          <EmptyState
            icon={IconBook2}
            title={t("No dictionary terms yet")}
            description={t("Add the first term to start building this space dictionary.")}
          />
        ) : (
          <Stack gap="xs">
            {groupedTerms.map((group) => (
              <div key={group.letter}>
                <div className={classes.letter}>{group.letter}</div>
                <Accordion
                  variant="separated"
                  value={
                    group.terms.find((term) => openedTermIds[term.id])?.id ??
                    null
                  }
                  onChange={(termId) => setGroupOpenedTerm(group.terms, termId)}
                >
                  {group.terms.map((term) => (
                    <Accordion.Item key={term.id} value={term.id}>
                      <Accordion.Control>
                        <Group justify="space-between" wrap="nowrap">
                          <div className={classes.termHeader}>
                            <Text fw={600}>{term.term}</Text>
                            {term.forms.length > 0 && (
                              <Text className={classes.forms}>
                                {term.forms.join(", ")}
                              </Text>
                            )}
                          </div>
                          {canManageDictionary && (
                            <Menu withinPortal position="bottom-end">
                              <Menu.Target>
                                <ActionIcon
                                  variant="subtle"
                                  aria-label={t("Dictionary term actions")}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <IconDotsVertical size={16} />
                                </ActionIcon>
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
                        {openedTermIds[term.id] && (
                          <DictionaryMarkdown markdown={term.definitionMarkdown} />
                        )}
                      </Accordion.Panel>
                    </Accordion.Item>
                  ))}
                </Accordion>
              </div>
            ))}
          </Stack>
        )}
      </Container>

      <DictionaryTermModal
        opened={modalOpened}
        onClose={() => setModalOpened(false)}
        spaceId={space.id}
        term={editingTerm}
      />
    </>
  );
}
