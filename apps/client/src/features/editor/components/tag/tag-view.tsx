import { Tooltip } from "@mantine/core";
import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import cx from "clsx";
import { useTranslation } from "react-i18next";
import { getTagLabel, getValidTagValue } from "@docmost/editor-ext";
import classes from "./tag-view.module.css";

export default function TagView(props: NodeViewProps) {
  const { t } = useTranslation();
  const value = getValidTagValue(props.node.attrs.value);
  const description =
    value === "tbd" ? t("Tag TBD description") : t("Tag TODO description");

  return (
    <NodeViewWrapper
      as="span"
      className={cx(classes.tag, classes[value], {
        [classes.selected]: props.selected,
      })}
      data-tag-value={value}
    >
      <Tooltip
        label={description}
        multiline
        w={320}
        withArrow
        withinPortal
        openDelay={250}
      >
        <span className={classes.label}>{getTagLabel(value)}</span>
      </Tooltip>
    </NodeViewWrapper>
  );
}
