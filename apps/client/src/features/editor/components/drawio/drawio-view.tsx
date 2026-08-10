import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import {
  ActionIcon,
  Card,
  Image,
  LoadingOverlay,
  Modal,
  Text,
  useComputedColorScheme,
} from "@mantine/core";
import { useRef, useState } from "react";
import { uploadFile } from "@/features/page/services/page-service.ts";
import { useDisclosure } from "@mantine/hooks";
import { getDrawioUrl, getFileUrl } from "@/lib/config.ts";
import {
  DrawIoEmbed,
  DrawIoEmbedRef,
  EventExit,
  EventSave,
} from "react-drawio";
import { IAttachment } from "@/features/attachments/types/attachment.types";
import { decodeBase64ToSvgString, svgStringToFile } from "@/lib/utils";
import clsx from "clsx";
import { IconEdit } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import {
  getDiagramAttachmentIdForSave,
  getDiagramAttachmentSrc,
  getDiagramSaveErrorMessage,
  shouldCreateNewDiagramAttachment,
} from "@/features/editor/components/diagram/diagram-attachment";
import { ImagePreviewModal } from "@/features/editor/components/common/image-preview-modal";
import { normalizeBlockWidthMode } from "@docmost/editor-ext";

export default function DrawioView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { node, updateAttributes, editor, selected } = props;
  const { src, title, width, attachmentId } = node.attrs;
  const widthMode = normalizeBlockWidthMode(node.attrs.widthMode);
  const drawioRef = useRef<DrawIoEmbedRef>(null);
  const [initialXML, setInitialXML] = useState<string>("");
  const [opened, { open, close }] = useDisclosure(false);
  const [isPreviewOpened, setIsPreviewOpened] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const computedColorScheme = useComputedColorScheme();
  const imageUrl = src ? getFileUrl(src) : null;

  const handleOpen = async () => {
    if (!editor.isEditable) {
      return;
    }

    try {
      if (src) {
        const url = getFileUrl(src);
        const request = await fetch(url, {
          credentials: "include",
          cache: "no-store",
        });
        const blob = await request.blob();

        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          const base64data = (reader.result || "") as string;
          setInitialXML(base64data);
        };
      }
    } catch (err) {
      console.error(err);
    } finally {
      open();
    }
  };

  const handleSave = async (data: EventSave) => {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    try {
      const svgString = decodeBase64ToSvgString(data.xml);

      const fileName = "diagram.drawio.svg";
      const drawioSVGFile = await svgStringToFile(svgString, fileName);

      //@ts-ignore
      const pageId = editor.storage?.pageId;

      const attachmentIdForSave = getDiagramAttachmentIdForSave(
        editor.state.doc,
        attachmentId,
      );
      let attachment: IAttachment;
      try {
        attachment = await uploadFile(
          drawioSVGFile,
          pageId,
          attachmentIdForSave,
        );
      } catch (err) {
        if (!attachmentIdForSave || !shouldCreateNewDiagramAttachment(err)) {
          throw err;
        }
        attachment = await uploadFile(drawioSVGFile, pageId);
      }

      updateAttributes({
        src: getDiagramAttachmentSrc(attachment),
        title: attachment.fileName,
        size: attachment.fileSize,
        attachmentId: attachment.id,
      });

      close();
    } catch (err) {
      console.error(err);
      notifications.show({
        color: "red",
        message: getDiagramSaveErrorMessage(err, t),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <NodeViewWrapper
      data-drag-handle
      className="blockWidthWrapper"
      data-block-width-mode={widthMode}
    >
      <Modal.Root
        opened={opened}
        onClose={isSaving ? () => null : close}
        fullScreen
      >
        <Modal.Overlay />
        <Modal.Content style={{ overflow: "hidden" }}>
          <LoadingOverlay visible={isSaving} zIndex={1000} />
          <Modal.Body>
            <div style={{ height: "100vh" }}>
              <DrawIoEmbed
                ref={drawioRef}
                xml={initialXML}
                baseUrl={getDrawioUrl()}
                urlParameters={{
                  ui: computedColorScheme === "light" ? "kennedy" : "dark",
                  spin: true,
                  libraries: true,
                  saveAndExit: true,
                  noSaveBtn: true,
                }}
                onSave={(data: EventSave) => {
                  // If the save is triggered by another event, then do nothing
                  if (data.parentEvent !== "save") {
                    return;
                  }
                  void handleSave(data);
                }}
                onClose={(data: EventExit) => {
                  // If the exit is triggered by another event, then do nothing
                  if (data.parentEvent || isSaving) {
                    return;
                  }
                  close();
                }}
              />
            </div>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>

      {src ? (
        <div style={{ position: "relative" }}>
          <Image
            onClick={(e) => {
              if (!editor.isEditable) {
                setIsPreviewOpened(true);
                return;
              }

              if (e.detail === 2) {
                handleOpen();
              }
            }}
            radius="md"
            fit="contain"
            w={width}
            src={imageUrl ?? undefined}
            alt={title}
            className={clsx(
              selected ? "ProseMirror-selectednode" : "",
              "alignCenter",
            )}
            style={{ cursor: !editor.isEditable ? "zoom-in" : undefined }}
          />

          <ImagePreviewModal
            opened={isPreviewOpened}
            onClose={() => setIsPreviewOpened(false)}
            title={title || t("Image preview")}
          >
            <Image
              radius="md"
              fit="contain"
              src={imageUrl ?? undefined}
              alt={title}
            />
          </ImagePreviewModal>

          {selected && editor.isEditable && (
            <ActionIcon
              onClick={handleOpen}
              variant="default"
              color="gray"
              aria-label={t("Double-click to edit Draw.io diagram")}
              mx="xs"
              className="print-hide"
              style={{
                position: "absolute",
                top: 8,
                right: 8,
              }}
            >
              <IconEdit size={18} />
            </ActionIcon>
          )}
        </div>
      ) : (
        <Card
          radius="md"
          onClick={(e) => e.detail === 2 && handleOpen()}
          p="xs"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
          withBorder
          className={clsx(selected ? "ProseMirror-selectednode" : "")}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <ActionIcon
              component="span"
              variant="transparent"
              color="gray"
              aria-hidden="true"
            >
              <IconEdit size={18} />
            </ActionIcon>

            <Text component="span" size="lg" c="dimmed">
              {t("Double-click to edit Draw.io diagram")}
            </Text>
          </div>
        </Card>
      )}
    </NodeViewWrapper>
  );
}
