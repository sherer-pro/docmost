import React, { type ReactNode } from "react";
import { SectionHeader } from "@/components/ui/page-frame.tsx";

export default function SettingsTitle({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <SectionHeader
      title={title}
      actions={actions}
      headingLevel={1}
      titleSize="h3"
      divider
    />
  );
}
