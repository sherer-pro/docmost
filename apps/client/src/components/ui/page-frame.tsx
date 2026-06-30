import React, { ReactNode } from "react";
import {
  Container,
  ContainerProps,
  Divider,
  Group,
  MantineSize,
  Text,
  Title,
} from "@mantine/core";
import cx from "clsx";
import classes from "./page-frame.module.css";

type PageFrameSize = "narrow" | "settings" | "document" | "wide";

const PAGE_FRAME_SIZES: Record<PageFrameSize, ContainerProps["size"]> = {
  narrow: 640,
  settings: 850,
  document: 800,
  wide: "xl",
};

interface PageFrameProps extends Omit<ContainerProps, "size"> {
  size?: PageFrameSize;
}

export function PageFrame({
  size = "document",
  className,
  children,
  ...props
}: PageFrameProps) {
  return (
    <Container
      size={PAGE_FRAME_SIZES[size]}
      className={cx(classes.frame, className)}
      {...props}
    >
      {children}
    </Container>
  );
}

interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  divider?: boolean;
  titleSize?: MantineSize | (string & {});
}

export function SectionHeader({
  title,
  description,
  actions,
  headingLevel = 1,
  divider = false,
  titleSize = "h2",
}: SectionHeaderProps) {
  return (
    <>
      <div className={classes.sectionHeader}>
        <div className={classes.sectionHeaderMain}>
          <Title
            order={headingLevel}
            size={titleSize}
            className={classes.sectionTitle}
          >
            {title}
          </Title>
          {description &&
            (typeof description === "string" ? (
              <Text size="sm" className={classes.sectionDescription}>
                {description}
              </Text>
            ) : (
              <div className={classes.sectionDescription}>{description}</div>
            ))}
        </div>
        {actions && (
          <Group className={classes.sectionActions} gap="xs" wrap="wrap">
            {actions}
          </Group>
        )}
      </div>
      {divider && <Divider mb="md" />}
    </>
  );
}
