import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { getPageById } from "@/features/page/services/page-service";
import {
  getDatabaseProperties,
  getDatabaseRowContextByPage,
} from "../services/database-service";
import {
  buildDatabaseCellReview,
  type DatabaseCellConflict,
  type DatabaseCellReview,
} from "../utils/database-cell-conflict";
import { DatabaseCellRenderer } from "./database-cell-renderer";
import { getRowTitle } from "../utils/database-markdown";

export function DatabaseCellConflictDialog({
  conflict,
  databaseId,
  spaceId,
  onClose,
  onUseCurrent,
  onApply,
  onReturnFocus,
}: {
  conflict: DatabaseCellConflict | null;
  databaseId: string;
  spaceId: string;
  onClose: () => void;
  onUseCurrent: (
    conflict: DatabaseCellConflict,
    current: DatabaseCellReview,
  ) => void;
  onApply: (
    conflict: DatabaseCellConflict,
    current: DatabaseCellReview,
  ) => Promise<boolean>;
  onReturnFocus: (conflict: DatabaseCellConflict) => void;
}) {
  const { t } = useTranslation();
  const [review, setReview] = useState<DatabaseCellReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const closingConflict = useRef<DatabaseCellConflict | null>(null);
  const intent = useRef(0);
  useEffect(() => {
    const request = ++intent.current;
    setReview(null);
    setFailed(false);
    setPending(false);
    if (!conflict) {
      setLoading(false);
      return;
    }
    closingConflict.current = conflict;
    setLoading(true);
    void Promise.all([
      getDatabaseRowContextByPage(conflict.row.pageId),
      getDatabaseProperties(databaseId),
      getPageById({ pageId: conflict.row.pageId }),
    ])
      .then(([context, properties, page]) => {
        if (request !== intent.current) return;
        const current = buildDatabaseCellReview({
          databaseId,
          conflict,
          context,
          properties,
          page,
        });
        setReview(current);
        setFailed(!current);
      })
      .catch(() => {
        if (request === intent.current) setFailed(true);
      })
      .finally(() => {
        if (request === intent.current) setLoading(false);
      });
    return () => {
      intent.current++;
    };
  }, [conflict, databaseId, generation]);
  const close = () => {
    if (!pending) onClose();
  };
  const value = (input: unknown) =>
    conflict && (
      <DatabaseCellRenderer
        property={review?.property ?? conflict.property}
        value={input}
        spaceId={spaceId}
        isEditable={false}
        isEditing={false}
        editingValue={null}
        onStartEdit={() => {}}
        onChange={() => {}}
        onSave={() => {}}
      />
    );
  return (
    <Modal
      opened={Boolean(conflict)}
      onClose={close}
      title={t("dbTable.cellConflictTitle")}
      closeButtonProps={{ "aria-label": t("Close"), disabled: pending }}
      returnFocus={false}
      onExitTransitionEnd={() => {
        if (!conflict && closingConflict.current)
          onReturnFocus(closingConflict.current);
      }}
    >
      {conflict && (
        <Stack>
          <Text>
            {getRowTitle(conflict.row, t("Untitled"))} ·{" "}
            {conflict.property.name}
          </Text>
          <Text size="sm">{t("dbTable.cellConflictHelp")}</Text>
          {loading && <Loader aria-label={t("Loading...")} />}
          {failed && (
            <Alert color="red" role="alert">
              {t("dbTable.cellConflictUnavailable")}
            </Alert>
          )}
          <Table
            withTableBorder
            layout="fixed"
            style={{ overflowWrap: "anywhere" }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("dbTable.cellConflictVersion")}</Table.Th>
                <Table.Th>{t("dbTable.cellConflictValue")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td>{t("dbTable.cellConflictOriginal")}</Table.Td>
                <Table.Td>{value(conflict.originalValue)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>{t("dbTable.cellConflictCurrent")}</Table.Td>
                <Table.Td>
                  {review
                    ? value(review.value)
                    : t("dbTable.cellConflictNotLoaded")}
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>{t("dbTable.cellConflictDraft")}</Table.Td>
                <Table.Td>{value(conflict.draftValue)}</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
          {review && !review.canWrite && (
            <Alert color="yellow">{t("dbTable.cellConflictReadOnly")}</Alert>
          )}
          <Group>
            <Button
              variant="default"
              disabled={pending || loading}
              onClick={() => setGeneration((n) => n + 1)}
            >
              {t("dbTable.cellConflictReload")}
            </Button>
            <Button
              variant="default"
              disabled={pending || !review}
              onClick={() => {
                if (review) onUseCurrent(conflict, review);
              }}
            >
              {t("dbTable.cellConflictUseCurrent")}
            </Button>
            <Button
              disabled={loading || !review?.canWrite}
              loading={pending}
              onClick={async () => {
                if (!review?.canWrite || pending) return;
                const request = intent.current;
                setPending(true);
                let applied = false;
                try {
                  applied = await onApply(conflict, review);
                } catch {
                  /* Keep the draft available for another explicit review. */
                }
                if (request !== intent.current) return;
                setPending(false);
                if (!applied) {
                  setReview(null);
                  setFailed(true);
                }
              }}
            >
              {t("dbTable.cellConflictApplyDraft")}
            </Button>
            <Button variant="subtle" disabled={pending} onClick={close}>
              {t("Cancel")}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
