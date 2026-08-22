import {
  ActionIcon,
  Anchor,
  Group,
  Indicator,
  Popover,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconExternalLink, IconWorld } from "@tabler/icons-react";
import React, { useEffect, useMemo, useState } from "react";
import {
  useCreateShareMutation,
  useDeleteShareMutation,
  useShareForPageQuery,
  useUpdateShareMutation,
} from "@/features/share/queries/share-query.ts";
import { Link, useParams } from "react-router-dom";
import { extractPageSlugId, getPageIcon } from "@/lib";
import { useTranslation } from "react-i18next";
import { usePageQuery } from "@/features/page/queries/page-query.ts";
import CopyTextButton from "@/components/common/copy.tsx";
import { getAppUrl } from "@/lib/config.ts";
import {
  buildPageUrl,
  buildSharedPageUrl,
} from "@/features/page/page.utils.ts";
import classes from "@/features/share/components/share.module.css";
import { useAtom } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { useSpaceQuery } from "@/features/space/queries/space-query.ts";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";

interface ShareModalProps {
  /**
   * Explicit page identifier.
   *
   * Needed for scenarios where the page context does not come from the URL
   * (for example, database menu by `database.pageId`).
   */
  pageId?: string;
  readOnly?: boolean;
}
export default function ShareModal({
  pageId: pageIdProp,
  readOnly = false,
}: ShareModalProps) {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const pageSlugId = extractPageSlugId(pageSlug);
  const pageQueryId = pageIdProp ?? pageSlugId;
  const { data: page } = usePageQuery({ pageId: pageQueryId });
  const hasValidSharePageContext =
    !!page?.id && !!page?.slugId && (!pageIdProp || page.id === pageIdProp);
  const { spaceSlug } = useParams();
  const [workspace] = useAtom(workspaceAtom);
  const { data: space } = useSpaceQuery(page?.spaceId ?? spaceSlug ?? "");
  const workspaceDisabled = workspace?.settings?.sharing?.disabled === true;
  const spaceDisabled =
    (space?.settings ?? page?.space?.settings)?.sharing?.disabled === true;
  const sharingDisabled = workspaceDisabled || spaceDisabled;
  const shareLookupPageId = hasValidSharePageContext ? page.slugId : undefined;
  const pageId = pageIdProp ?? page?.id;
  const { data: share } = useShareForPageQuery({
    pageId: shareLookupPageId,
    queryKeyId: page?.id,
    enabled: hasValidSharePageContext && !sharingDisabled,
  });
  const createShareMutation = useCreateShareMutation();
  const updateShareMutation = useUpdateShareMutation();
  const deleteShareMutation = useDeleteShareMutation();
  // pageIsShared means that the share exists and its level equals zero.
  const pageIsShared = share && share.level === 0;
  // if level is greater than zero, then it is a descendant page from a shared page
  const isDescendantShared = share && share.level > 0;

  /**
   * Build the public link through the shared helper so its format always matches
   * regular page/share URLs, regardless of the pageId source.
   */
  const publicLink = `${getAppUrl()}${buildSharedPageUrl({
    shareId: share?.key,
    pageSlugId: page?.slugId ?? pageSlugId,
    pageTitle: page?.title,
  })}`;

  const [isPagePublic, setIsPagePublic] = useState<boolean>(false);
  useEffect(() => {
    if (share) {
      setIsPagePublic(true);
    } else {
      setIsPagePublic(false);
    }
  }, [share, pageId]);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.checked;

    if (value) {
      createShareMutation.mutateAsync({
        pageId: pageId,
        includeSubPages: true,
        searchIndexing: false,
      });
      setIsPagePublic(value);
    } else {
      if (share && share.id) {
        deleteShareMutation.mutateAsync(share.id);
        setIsPagePublic(value);
      }
    }
  };

  const handleSubPagesChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.currentTarget.checked;
    updateShareMutation.mutateAsync({
      shareId: share.id,
      includeSubPages: value,
    });
  };

  const handleIndexSearchChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.currentTarget.checked;
    updateShareMutation.mutateAsync({
      shareId: share.id,
      searchIndexing: value,
    });
  };

  const shareLink = useMemo(
    () => (
      <Group my="sm" gap={4} wrap="nowrap">
        <TextInput
          variant="filled"
          aria-label={t("Public link")}
          value={publicLink}
          readOnly
          rightSection={<CopyTextButton text={publicLink} />}
          style={{ width: "100%" }}
        />
        <ActionIcon
          aria-label={t("Open public link")}
          component="a"
          variant="default"
          target="_blank"
          href={publicLink}
          size={32}
        >
          <IconExternalLink size={16} />
        </ActionIcon>
      </Group>
    ),
    [publicLink, t],
  );

  if (sharingDisabled) {
    return null;
  }

  return (
    <Popover width={350} position="bottom" withArrow shadow="md">
      <Popover.Target>
        <AccessibleActionIcon
          label={t("Share")}
          tooltipProps={{ openDelay: 250, withArrow: true }}
          variant="subtle"
          color="dark"
        >
          <Indicator
            color="green"
            offset={5}
            disabled={!isPagePublic}
            withBorder
          >
            <IconWorld size={20} stroke={1.5} />
          </Indicator>
        </AccessibleActionIcon>
      </Popover.Target>
      <Popover.Dropdown style={{ userSelect: "none" }}>
        {isDescendantShared ? (
          <>
            <Text size="sm">{t("Inherits public sharing from")}</Text>
            <Anchor
              size="sm"
              underline="never"
              style={{
                cursor: "pointer",
                color: "var(--mantine-color-text)",
              }}
              component={Link}
              to={buildPageUrl(
                page?.space?.slug ?? spaceSlug,
                share.sharedPage.slugId,
                share.sharedPage.title,
              )}
            >
              <Group gap="4" wrap="nowrap" my="sm">
                {getPageIcon(share.sharedPage.icon)}
                <div className={classes.shareLinkText}>
                  <Text fz="sm" fw={500} lineClamp={1}>
                    {share.sharedPage.title || t("untitled")}
                  </Text>
                </div>
              </Group>
            </Anchor>

            {shareLink}
          </>
        ) : (
          <>
            <Group justify="space-between" wrap="nowrap" gap="xl">
              <div>
                <Text size="sm">
                  {isPagePublic ? t("Shared to web") : t("Share to web")}
                </Text>
                <Text size="xs" c="dimmed">
                  {isPagePublic
                    ? t("Anyone with the link can view this page")
                    : t("Make this page publicly accessible")}
                </Text>
              </div>
              <Switch
                aria-label={t("Share page to web")}
                onChange={handleChange}
                checked={isPagePublic}
                disabled={readOnly}
                size="xs"
              />
            </Group>

            {pageIsShared && (
              <>
                {shareLink}
                <Group justify="space-between" wrap="nowrap" gap="xl">
                  <div>
                    <Text size="sm">{t("Include sub-pages")}</Text>
                    <Text size="xs" c="dimmed">
                      {t("Make sub-pages public too")}
                    </Text>
                  </div>

                  <Switch
                    aria-label={t("Include sub-pages")}
                    onChange={handleSubPagesChange}
                    checked={share.includeSubPages}
                    size="xs"
                    disabled={readOnly}
                  />
                </Group>
                <Group justify="space-between" wrap="nowrap" gap="xl" mt="sm">
                  <div>
                    <Text size="sm">{t("Search engine indexing")}</Text>
                    <Text size="xs" c="dimmed">
                      {t("Allow search engines to index page")}
                    </Text>
                  </div>
                  <Switch
                    aria-label={t("Search engine indexing")}
                    onChange={handleIndexSearchChange}
                    checked={share.searchIndexing}
                    size="xs"
                    disabled={readOnly}
                  />
                </Group>
              </>
            )}
          </>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
