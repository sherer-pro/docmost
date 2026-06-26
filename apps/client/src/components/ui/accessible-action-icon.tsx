import {
  ActionIcon,
  type ActionIconProps,
  type ElementProps,
  Tooltip,
  type TooltipProps,
} from "@mantine/core";
import { forwardRef, type ReactNode } from "react";

type AccessibleActionIconProps = ActionIconProps &
  ElementProps<"button"> & {
    children: ReactNode;
    label: string;
    minTargetSize?: number | string;
    tooltip?: ReactNode | false;
    tooltipProps?: Omit<TooltipProps, "children" | "label">;
  };

export const AccessibleActionIcon = forwardRef<
  HTMLButtonElement,
  AccessibleActionIconProps
>(
  (
    {
      children,
      label,
      minTargetSize = 32,
      size = 32,
      style,
      tooltip,
      tooltipProps,
      ...props
    },
    ref,
  ) => {
    const control = (
      <ActionIcon
        {...props}
        ref={ref}
        aria-label={label}
        size={size}
        style={{
          minHeight: minTargetSize,
          minWidth: minTargetSize,
          ...style,
        }}
      >
        {children}
      </ActionIcon>
    );

    if (tooltip === false) {
      return control;
    }

    return (
      <Tooltip label={tooltip ?? label} openDelay={350} {...tooltipProps}>
        {control}
      </Tooltip>
    );
  },
);

AccessibleActionIcon.displayName = "AccessibleActionIcon";
