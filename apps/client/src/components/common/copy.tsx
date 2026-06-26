import { CopyButton } from "@/components/common/copy-button";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";

interface CopyProps {
  text: string;
}
export default function CopyTextButton({ text }: CopyProps) {
  const { t } = useTranslation();

  return (
    <CopyButton value={text} timeout={2000}>
      {({ copied, copy }) => (
        <AccessibleActionIcon
          label={copied ? t("Copied") : t("Copy")}
          tooltip={copied ? t("Copied") : t("Copy")}
          tooltipProps={{ withArrow: true, position: "right" }}
          color={copied ? "teal" : "gray"}
          variant="subtle"
          onClick={copy}
        >
          {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
        </AccessibleActionIcon>
      )}
    </CopyButton>
  );
}
