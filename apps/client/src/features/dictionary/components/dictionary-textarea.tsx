import { Button, Popover, Textarea, TextareaProps } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DictionaryTermModal } from "./dictionary-term-modal";

interface DictionaryTextareaProps extends TextareaProps {
  spaceId?: string;
  canCreate?: boolean;
}

export function DictionaryTextarea({
  spaceId,
  canCreate = false,
  onKeyUp,
  onMouseUp,
  ...props
}: DictionaryTextareaProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [initialTerm, setInitialTerm] = useState("");
  const [modalOpened, { open: openModal, close: closeModal }] =
    useDisclosure(false);

  const updateSelectedText = () => {
    const textarea = textareaRef.current;
    if (!textarea || !spaceId || !canCreate) {
      setSelectedText("");
      return;
    }

    const nextSelectedText = textarea.value
      .slice(textarea.selectionStart, textarea.selectionEnd)
      .trim();
    setSelectedText(nextSelectedText);
  };

  return (
    <>
      <Popover opened={Boolean(selectedText)} position="bottom-start" withArrow>
        <Popover.Target>
          <Textarea
            ref={textareaRef}
            onKeyUp={(event) => {
              updateSelectedText();
              onKeyUp?.(event);
            }}
            onMouseUp={(event) => {
              updateSelectedText();
              onMouseUp?.(event);
            }}
            {...props}
          />
        </Popover.Target>
        <Popover.Dropdown>
          <Button
            size="xs"
            variant="default"
            onClick={() => {
              setInitialTerm(selectedText);
              openModal();
              setSelectedText("");
            }}
          >
            {t("Add to dictionary")}
          </Button>
        </Popover.Dropdown>
      </Popover>

      {spaceId && (
        <DictionaryTermModal
          opened={modalOpened}
          onClose={closeModal}
          spaceId={spaceId}
          initialTerm={initialTerm}
        />
      )}
    </>
  );
}
