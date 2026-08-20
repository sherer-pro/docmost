import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { ActionIcon, Anchor, Text } from "@mantine/core";
import { IconFileDescription } from "@tabler/icons-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  buildPageUrl,
  buildSharedPageUrl,
} from "@/features/page/page.utils.ts";
import { extractPageSlugId } from "@/lib";
import classes from "./mention.module.css";
import { usePageReference } from "./use-page-reference";
import { resolvePageMentionReference } from "./mention-reference";

export default function MentionView(props: NodeViewProps) {
  const { node } = props;
  const { label, entityType, entityId, slugId, anchorId, icon } = node.attrs;
  const { spaceSlug, pageSlug } = useParams();
  const { shareId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isShareRoute = location.pathname.startsWith("/share");
  const page = usePageReference(
    entityType === "page" ? entityId : null,
    !isShareRoute,
  );
  const resolvedPage = resolvePageMentionReference(
    { slugId, label, icon },
    page,
  );

  const currentPageSlugId = extractPageSlugId(pageSlug);
  const isSamePage = currentPageSlugId === resolvedPage.slugId;

  const handleClick = (e: React.MouseEvent) => {
    if (isSamePage && anchorId) {
      e.preventDefault();
      const element = document.querySelector(`[id="${anchorId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
        navigate(`#${anchorId}`, { replace: true });
      }
    }
  };

  const shareSlugUrl = buildSharedPageUrl({
    shareId,
    pageSlugId: resolvedPage.slugId,
    pageTitle: resolvedPage.title,
    anchorId,
  });

  return (
    <NodeViewWrapper style={{ display: "inline" }} data-drag-handle>
      {entityType === "user" && (
        <Text className={classes.userMention} component="span">
          @{label}
        </Text>
      )}

      {entityType === "page" && (
        <Anchor
          component={Link}
          fw={500}
          to={
            isShareRoute
              ? shareSlugUrl
              : buildPageUrl(
                  spaceSlug,
                  resolvedPage.slugId,
                  resolvedPage.title,
                  anchorId,
                )
          }
          onClick={handleClick}
          underline="never"
          className={classes.pageMentionLink}
        >
          {resolvedPage.icon ? (
            <span style={{ marginRight: "4px" }}>{resolvedPage.icon}</span>
          ) : (
            <ActionIcon
              variant="transparent"
              color="gray"
              component="span"
              size={18}
              style={{ verticalAlign: "text-bottom" }}
            >
              <IconFileDescription size={18} />
            </ActionIcon>
          )}

          <span className={classes.pageMentionText}>{resolvedPage.title}</span>
        </Anchor>
      )}
    </NodeViewWrapper>
  );
}
