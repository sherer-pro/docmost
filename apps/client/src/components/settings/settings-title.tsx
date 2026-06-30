import React from "react";
import { SectionHeader } from "@/components/ui/page-frame.tsx";

export default function SettingsTitle({ title }: { title: string }) {
  return <SectionHeader title={title} headingLevel={1} titleSize="h3" divider />;
}
