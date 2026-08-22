import { MantineSize, SegmentedControl, VisuallyHidden } from "@mantine/core";
import { IconBook, IconPencil } from "@tabler/icons-react";
import { useAtom } from "jotai";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateUser } from "@/features/user/services/user-service.ts";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import {
  buildPageEditModeByPageId,
  normalizePageEditMode,
  normalizePageEditModeByPageId,
  resolvePageEditMode,
} from "@/features/user/utils/page-edit-mode.ts";
import classes from "./page-state-pref.module.css";

interface PageStateSegmentedControlProps {
  size?: MantineSize;
  pageId?: string | null;
  disabled?: boolean;
  compact?: boolean;
}

export function PageStateSegmentedControl({
  size,
  pageId,
  disabled = false,
  compact = false,
}: PageStateSegmentedControlProps) {
  const { t } = useTranslation();
  const [user, setUser] = useAtom(userAtom);
  const pageEditMode = resolvePageEditMode({
    pageId,
    preferences: user?.settings?.preferences,
  });
  const [value, setValue] = useState(pageEditMode);
  const [isSaving, setIsSaving] = useState(false);
  const latestRequestIdRef = useRef(0);

  const setLocalPageEditModeByPageId = useCallback(
    (pageEditModeByPageId: Record<string, PageEditMode>) => {
      if (!user) {
        return;
      }

      setUser({
        ...user,
        settings: {
          ...user.settings,
          preferences: {
            ...user.settings?.preferences,
            pageEditModeByPageId,
          },
        },
      });
    },
    [setUser, user],
  );

  const handleChange = useCallback(
    async (nextValue: string) => {
      const nextMode = normalizePageEditMode(nextValue);
      if (!user || !pageId || nextMode === value) {
        return;
      }

      const previousMode = value;
      const previousPageEditModeByPageId = normalizePageEditModeByPageId(
        user.settings?.preferences?.pageEditModeByPageId,
      );
      const nextPageEditModeByPageId = buildPageEditModeByPageId(
        previousPageEditModeByPageId,
        pageId,
        nextMode,
      );
      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;
      setValue(nextMode);
      setLocalPageEditModeByPageId(nextPageEditModeByPageId);
      setIsSaving(true);

      try {
        const updatedUser = await updateUser({
          pageEditModeByPageId: nextPageEditModeByPageId,
        });
        if (requestId !== latestRequestIdRef.current) {
          return;
        }

        const persistedMode = resolvePageEditMode({
          pageId,
          preferences: updatedUser?.settings?.preferences,
        });

        setValue(persistedMode);
        setUser(updatedUser);
      } catch {
        if (requestId !== latestRequestIdRef.current) {
          return;
        }
        setValue(previousMode);
        setLocalPageEditModeByPageId(previousPageEditModeByPageId);
      } finally {
        if (requestId === latestRequestIdRef.current) {
          setIsSaving(false);
        }
      }
    },
    [pageId, setLocalPageEditModeByPageId, setUser, user, value],
  );

  useEffect(() => {
    setValue(pageEditMode);
  }, [pageEditMode]);

  return (
    <SegmentedControl
      size={size}
      className={compact ? classes.compactControl : undefined}
      value={value}
      onChange={handleChange}
      aria-busy={isSaving}
      disabled={disabled || !pageId || isSaving}
      data={[
        {
          label: compact ? (
            <span className={classes.compactLabel}>
              <IconPencil size={17} aria-hidden="true" />
              <VisuallyHidden>{t("Edit")}</VisuallyHidden>
            </span>
          ) : (
            t("Edit")
          ),
          value: PageEditMode.Edit,
        },
        {
          label: compact ? (
            <span className={classes.compactLabel}>
              <IconBook size={17} aria-hidden="true" />
              <VisuallyHidden>{t("Read")}</VisuallyHidden>
            </span>
          ) : (
            t("Read")
          ),
          value: PageEditMode.Read,
        },
      ]}
    />
  );
}
