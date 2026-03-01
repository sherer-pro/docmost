import React from "react";
import { STATUS_COLOR_MAP } from "@/components/ui/status-indicator.constants.ts";


interface StatusIndicatorProps {
  status: string;
  className?: string;
  size?: number;
  fallbackColor?: string;
}

/**
 * Unified status indicator.
 *
 * Reused by page tree and sidebar to avoid duplicated visual logic and keep
 * status color mapping centralized.
 */
export function StatusIndicator({
  status,
  className,
  size = 8,
  fallbackColor = "var(--mantine-color-gray-5)",
}: StatusIndicatorProps) {
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        backgroundColor: STATUS_COLOR_MAP[status] ?? fallbackColor,
      }}
    />
  );
}
