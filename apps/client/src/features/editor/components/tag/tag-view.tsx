import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import cx from "clsx";
import { getTagLabel, getValidTagValue } from "@docmost/editor-ext";
import classes from "./tag-view.module.css";

export default function TagView(props: NodeViewProps) {
  const value = getValidTagValue(props.node.attrs.value);

  return (
    <NodeViewWrapper
      as="span"
      className={cx(classes.tag, classes[value], {
        [classes.selected]: props.selected,
      })}
      data-tag-value={value}
    >
      {getTagLabel(value)}
    </NodeViewWrapper>
  );
}
