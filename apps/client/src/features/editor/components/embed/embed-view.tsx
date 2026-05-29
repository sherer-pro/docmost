import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import React, { useMemo, useCallback } from "react";
import clsx from "clsx";
import {
  ActionIcon,
  Button,
  Card,
  FocusTrap,
  Group,
  Popover,
  Text,
  TextInput,
} from "@mantine/core";
import { IconEdit } from "@tabler/icons-react";
import { z } from "zod";
import { useForm } from "@mantine/form";
import { zodResolver } from "mantine-form-zod-resolver";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import {
  getEmbedProviderById,
  getEmbedUrlAndProvider,
} from "@docmost/editor-ext";
import { ResizableWrapper } from "../common/resizable-wrapper";
import {
  sanitizeEmbedUrl,
  sanitizeEmbedUrlForProvider,
} from "./embed-url-sanitizer";
import { getEmbedIframeSandbox } from "./embed-sandbox";
import classes from "./embed-view.module.css";

const schema = z.object({
  url: z
    .string()
    .trim()
    .url({ message: i18n.t("Please enter a valid url") }),
});

export default function EmbedView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { node, selected, updateAttributes, editor } = props;
  const { src, provider, height: nodeHeight } = node.attrs;

  const embed = useMemo(() => {
    if (src) {
      return getEmbedUrlAndProvider(src);
    }
    return null;
  }, [src]);
  const embedUrl = embed?.embedUrl ?? null;
  const embedProviderId = embed?.provider ?? provider;
  const safeEmbedUrl = useMemo(
    () => sanitizeEmbedUrlForProvider(embedUrl, embedProviderId),
    [embedProviderId, embedUrl],
  );

  const embedForm = useForm<{ url: string }>({
    initialValues: {
      url: "",
    },
    validate: zodResolver(schema),
  });

  const handleResize = useCallback(
    (newHeight: number) => {
      updateAttributes({ height: newHeight });
    },
    [updateAttributes],
  );

  async function onSubmit(data: { url: string }) {
    if (!editor.isEditable) {
      return;
    }

    if (provider) {
      const embedProvider = getEmbedProviderById(provider);
      const sanitizedUrl =
        embedProvider.id === "iframe"
          ? sanitizeEmbedUrlForProvider(data.url, embedProvider.id)
          : sanitizeEmbedUrl(data.url);

      if (!sanitizedUrl) {
        notifications.show({
          message: t("Invalid {{provider}} embed link", {
            provider: embedProvider.name,
          }),
          position: "top-right",
          color: "red",
        });
        return;
      }

      if (embedProvider.id === "iframe") {
        updateAttributes({ src: sanitizedUrl });
        return;
      }
      if (embedProvider.regex.test(data.url)) {
        updateAttributes({ src: sanitizedUrl });
      } else {
        notifications.show({
          message: t("Invalid {{provider}} embed link", {
            provider: embedProvider.name,
          }),
          position: "top-right",
          color: "red",
        });
      }
    }
  }

  return (
    <NodeViewWrapper data-drag-handle>
      {safeEmbedUrl ? (
        <ResizableWrapper
          initialHeight={nodeHeight || 480}
          minHeight={200}
          maxHeight={1200}
          onResize={handleResize}
          isEditable={editor.isEditable}
          className={clsx(classes.embedWrapper, {
            "ProseMirror-selectednode": selected,
          })}
        >
          <iframe
            className={classes.embedIframe}
            src={safeEmbedUrl}
            allow="encrypted-media"
            sandbox={getEmbedIframeSandbox(embedProviderId)}
            allowFullScreen
            frameBorder="0"
          />
        </ResizableWrapper>
      ) : (
        <Popover
          width={300}
          position="bottom"
          withArrow
          shadow="md"
          disabled={!editor.isEditable}
        >
          <Popover.Target>
            <Card
              radius="md"
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
                <ActionIcon variant="transparent" color="gray">
                  <IconEdit size={18} />
                </ActionIcon>

                <Text component="span" size="lg" c="dimmed">
                  {t("Embed {{provider}}", {
                    provider: getEmbedProviderById(provider)?.name,
                  })}
                </Text>
              </div>
            </Card>
          </Popover.Target>
          <Popover.Dropdown bg="var(--mantine-color-body)">
            <form onSubmit={embedForm.onSubmit(onSubmit)}>
              <FocusTrap active={true}>
                <TextInput
                  placeholder={t("Enter {{provider}} link to embed", {
                    provider: getEmbedProviderById(provider).name,
                  })}
                  key={embedForm.key("url")}
                  {...embedForm.getInputProps("url")}
                  data-autofocus
                />
              </FocusTrap>

              <Group justify="center" mt="xs">
                <Button type="submit">{t("Embed link")}</Button>
              </Group>
            </form>
          </Popover.Dropdown>
        </Popover>
      )}
    </NodeViewWrapper>
  );
}
