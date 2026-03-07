import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Anchor, Text } from "@mantine/core";
import clsx from "clsx";
import classes from "./link-preview-view.module.css";

export default function LinkPreviewView(props: NodeViewProps) {
  const { node, selected } = props;
  const { url, title, description, image, siteName, loading } = node.attrs;

  return (
    <NodeViewWrapper data-drag-handle>
      <Anchor
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        underline="never"
        className={clsx(classes.container, {
          "ProseMirror-selectednode": selected,
        })}
        draggable={false}
        aria-busy={loading ? true : undefined}
      >
        {loading ? (
          <>
            <div className={clsx(classes.imagePlaceholder, classes.skeleton)} />
            <div className={classes.content}>
              <div className={clsx(classes.titlePlaceholder, classes.skeleton)} />
              <div className={clsx(classes.descriptionPlaceholder, classes.skeleton)} />
            </div>
          </>
        ) : (
          <>
            {image ? (
              <img src={image} alt={siteName || title || "link"} className={classes.image} />
            ) : null}

            <div className={classes.content}>
              <Text lineClamp={1} className={classes.title}>
                {title || siteName || url}
              </Text>

              {description ? (
                <Text className={classes.description}>
                  {description}
                </Text>
              ) : null}
            </div>
          </>
        )}
      </Anchor>
    </NodeViewWrapper>
  );
}
