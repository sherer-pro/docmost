import { Button, Center, Loader } from "@mantine/core";
import { IconAlertCircle, IconInbox } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { EmptyState } from "./empty-state";

export type AsyncQueryStateKind = "loading" | "error" | "empty" | "ready";

type AsyncQueryStateProps = {
  state: AsyncQueryStateKind;
  loadingLabel: string;
  errorTitle: string;
  emptyTitle: string;
  retryLabel: string;
  onRetry: () => void;
  children: ReactNode;
};

export function AsyncQueryState({
  state,
  loadingLabel,
  errorTitle,
  emptyTitle,
  retryLabel,
  onRetry,
  children,
}: AsyncQueryStateProps) {
  if (state === "loading") {
    return (
      <Center mih={180} role="status" aria-label={loadingLabel}>
        <Loader size="sm" />
      </Center>
    );
  }

  if (state === "error") {
    return (
      <EmptyState
        icon={IconAlertCircle}
        title={errorTitle}
        action={
          <Button variant="default" onClick={onRetry}>
            {retryLabel}
          </Button>
        }
      />
    );
  }

  if (state === "empty") {
    return <EmptyState icon={IconInbox} title={emptyTitle} />;
  }

  return children;
}
