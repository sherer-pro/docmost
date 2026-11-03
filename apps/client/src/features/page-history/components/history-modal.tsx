import { Modal, Text } from "@mantine/core";
import { useAtom } from "jotai";
import { historyAtoms } from "@/features/page-history/atoms/history-atoms";
import HistoryModalBody from "@/features/page-history/components/history-modal-body";
import HistoryModalMobile from "@/features/page-history/components/history-modal-mobile";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "@mantine/hooks";
import classes from "./css/history.module.css";

interface Props {
  pageId: string;
  pageTitle?: string;
  opened?: boolean;
  onClose?: () => void;
  readOnly?: boolean;
}

export default function HistoryModal({
  pageId,
  pageTitle,
  opened,
  onClose,
  readOnly = false,
}: Props) {
  const { t } = useTranslation();
  const [globalOpen, setModalOpen] = useAtom(historyAtoms);
  const isModalOpen = opened ?? globalOpen;
  const close = onClose ?? (() => setModalOpen(false));
  const isMobile = useMediaQuery("(max-width: 800px)");

  if (isMobile) {
    return (
      <Modal.Root opened={isModalOpen} onClose={close} fullScreen>
        <Modal.Overlay />
        <Modal.Content style={{ overflow: "hidden" }}>
          <Modal.Header>
            <Modal.Title>
              <Text size="md" fw={500}>
                {t("Page history")}
              </Text>
            </Modal.Title>
            <Modal.CloseButton aria-label={t("Close")} />
          </Modal.Header>
          <Modal.Body
            p={0}
            style={{ height: "calc(100vh - 60px)", overflow: "hidden" }}
          >
            <HistoryModalMobile
              pageId={pageId}
              pageTitle={pageTitle}
              readOnly={readOnly}
            />
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    );
  }

  return (
    <Modal.Root size={1400} opened={isModalOpen} onClose={close}>
      <Modal.Overlay />
      <Modal.Content className={classes.modalContent}>
        <Modal.Header className={classes.modalHeader}>
          <Modal.Title>
            <Text size="md" fw={500}>
              {t("Page history")}
            </Text>
          </Modal.Title>
          <Modal.CloseButton aria-label={t("Close")} />
        </Modal.Header>
        <Modal.Body className={classes.modalBody}>
          <HistoryModalBody pageId={pageId} readOnly={readOnly} />
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
