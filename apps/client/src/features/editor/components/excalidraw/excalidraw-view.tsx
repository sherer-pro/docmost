import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import {
  ActionIcon,
  Button,
  Card,
  Group,
  Image,
  Modal,
  Text,
  useComputedColorScheme,
} from "@mantine/core";
import { lazy, Suspense, useCallback, useState } from "react";
import { uploadFile } from "@/features/page/services/page-service.ts";
import { svgStringToFile } from "@/lib";
import { useDisclosure } from "@mantine/hooks";
import { getFileUrl } from "@/lib/config.ts";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { IAttachment } from "@/features/attachments/types/attachment.types";
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

const ExcalidrawEditor = lazy(
  () => import("@/features/editor/components/excalidraw/excalidraw-editor.tsx"),
);

export default function ExcalidrawView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { node, updateAttributes, editor, selected } = props;
  const { src, title, width, attachmentId } = node.attrs;
  const widthMode = normalizeBlockWidthMode(node.attrs.widthMode);

  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI>(null);
  const [excalidrawData, setExcalidrawData] = useState<any>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const [isPreviewOpened, setIsPreviewOpened] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const computedColorScheme = useComputedColorScheme();
  const imageUrl = src ? getFileUrl(src) : null;
  const handleExcalidrawApiChange = useCallback(
    (api: ExcalidrawImperativeAPI) => setExcalidrawAPI(api),
    [],
  );

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

        const { loadFromBlob } = await import("@excalidraw/excalidraw");

        const data = await loadFromBlob(await request.blob(), null, null);
        setExcalidrawData(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      open();
    }
  };

  const handleSave = async () => {
    if (!excalidrawAPI || isSaving) {
      return;
    }

    setIsSaving(true);
    try {
      const { exportToSvg } = await import("@excalidraw/excalidraw");

      const svg = await exportToSvg({
        elements: excalidrawAPI?.getSceneElements(),
        appState: {
          exportEmbedScene: true,
          exportWithDarkMode: false,
        },
        files: excalidrawAPI?.getFiles(),
      });

      const serializer = new XMLSerializer();
      let svgString = serializer.serializeToString(svg);

      svgString = svgString.replace(
        /https:\/\/unpkg\.com\/@excalidraw\/excalidraw@undefined/g,
        "https://unpkg.com/@excalidraw/excalidraw@latest",
      );

      const fileName = "diagram.excalidraw.svg";
      const excalidrawSvgFile = await svgStringToFile(svgString, fileName);

      // @ts-ignore
      const pageId = editor.storage?.pageId;

      const attachmentIdForSave = getDiagramAttachmentIdForSave(
        editor.state.doc,
        attachmentId,
      );
      let attachment: IAttachment;
      try {
        attachment = await uploadFile(
          excalidrawSvgFile,
          pageId,
          attachmentIdForSave,
        );
      } catch (err) {
        if (!attachmentIdForSave || !shouldCreateNewDiagramAttachment(err)) {
          throw err;
        }
        attachment = await uploadFile(excalidrawSvgFile, pageId);
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
      <Modal
        opened={opened}
        onClose={isSaving ? () => null : close}
        centered
        size="90vw"
        padding={0}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={!isSaving}
        title={t("Draw and sketch excalidraw diagrams")}
        styles={{ content: { overflow: "hidden" }, body: { padding: 0 } }}
      >
        <Group
          justify="flex-end"
          wrap="nowrap"
          bg="var(--mantine-color-body)"
          p="xs"
        >
          <Button onClick={handleSave} loading={isSaving} size={"compact-sm"}>
            {t("Save & Exit")}
          </Button>
          <Button
            onClick={close}
            color="red"
            disabled={isSaving}
            size={"compact-sm"}
          >
            {t("Exit")}
          </Button>
        </Group>
        <div style={{ height: "90vh" }}>
          <Suspense fallback={null}>
            <ExcalidrawEditor
              initialData={excalidrawData}
              onApiChange={handleExcalidrawApiChange}
              theme={computedColorScheme}
            />
          </Suspense>
        </div>
      </Modal>

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
              aria-label={t("Double-click to edit Excalidraw diagram")}
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
              {t("Double-click to edit Excalidraw diagram")}
            </Text>
          </div>
        </Card>
      )}
    </NodeViewWrapper>
  );
}
