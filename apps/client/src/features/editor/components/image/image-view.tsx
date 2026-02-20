import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Group, Image, Loader, Modal, Text } from "@mantine/core";
import { useMemo, useState } from "react";
import { getFileUrl } from "@/lib/config.ts";
import clsx from "clsx";
import classes from "./image-view.module.css";
import { useTranslation } from "react-i18next";

/**
 * Рендерит изображение внутри редактора и открывает его в модальном окне по клику.
 * Такой подход работает как для режима редактирования, так и для режима чтения,
 * потому что используется общий NodeView для узла изображения.
 */
export default function ImageView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { editor, node, selected } = props;
  const [isLightboxOpened, setIsLightboxOpened] = useState(false);
  const { src, width, align, title, aspectRatio, placeholder } = node.attrs;

  /**
   * Вычисляем CSS-класс выравнивания один раз на изменение атрибута align,
   * чтобы не пересчитывать его на каждый ререндер.
   */
  const alignClass = useMemo(() => {
    if (align === "left") return "alignLeft";
    if (align === "right") return "alignRight";
    if (align === "center") return "alignCenter";
    return "alignCenter";
  }, [align]);

  /**
   * Для загружаемых изображений сначала показываем локальный preview из shared storage,
   * чтобы пользователь видел картинку сразу, не дожидаясь завершения загрузки.
   */
  const previewSrc = useMemo(() => {
    editor.storage.shared.imagePreviews =
      editor.storage.shared.imagePreviews || {};

    if (placeholder?.id) {
      return editor.storage.shared.imagePreviews[placeholder.id];
    }

    return null;
  }, [placeholder, editor]);

  const imageUrl = src ? getFileUrl(src) : null;

  return (
    <NodeViewWrapper data-drag-handle>
      <div
        className={clsx(
          selected && "ProseMirror-selectednode",
          classes.imageWrapper,
          alignClass,
        )}
        style={{
          aspectRatio: aspectRatio ? aspectRatio : src ? undefined : "16 / 9",
          width,
        }}
      >
        {src && (
          <>
            <Image
              className={classes.clickableImage}
              radius="md"
              fit="contain"
              src={imageUrl}
              alt={title}
              onClick={() => setIsLightboxOpened(true)}
            />

            <Modal
              opened={isLightboxOpened}
              onClose={() => setIsLightboxOpened(false)}
              centered
              size="auto"
              title={title || t("Image preview")}
            >
              <Image
                radius="md"
                fit="contain"
                src={imageUrl}
                alt={title}
                mah="80vh"
                maw="90vw"
              />
            </Modal>
          </>
        )}
        {!src && previewSrc && (
          <Group pos="relative" h="100%" w="100%">
            <Image
              radius="md"
              fit="contain"
              src={previewSrc}
              alt={placeholder?.name}
            />
            <Loader size={20} pos="absolute" bottom={6} right={6} />
          </Group>
        )}
        {!src && !previewSrc && (
          <Group justify="center" wrap="nowrap" gap="xs" maw="100%" px="md">
            <Loader size={20} style={{ flexShrink: 0 }} />
            <Text component="span" size="sm" truncate="end">
              {placeholder?.name
                ? t("Uploading {{name}}", { name: placeholder.name })
                : t("Uploading file")}
            </Text>
          </Group>
        )}
      </div>
    </NodeViewWrapper>
  );
}
