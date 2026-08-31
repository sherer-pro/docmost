import { ActionIcon, Loader, Menu, Tooltip } from "@mantine/core";
import { IconStar } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  useFavoriteIdsQuery,
  useToggleFavoriteMutation,
} from "@/features/favorite/queries/favorite-query";
import { FavoriteType } from "@/features/favorite/types/favorite.types";

interface FavoriteButtonProps {
  type: FavoriteType;
  id: string;
  spaceId?: string;
  presentation?: "action-icon" | "menu-item";
}

export default function FavoriteButton({
  type,
  id,
  spaceId,
  presentation = "action-icon",
}: FavoriteButtonProps) {
  const { t } = useTranslation();
  const { data } = useFavoriteIdsQuery(type, spaceId);
  const toggleFavorite = useToggleFavoriteMutation();
  const isFavorite = data?.items?.includes(id) ?? false;
  const label = isFavorite ? t("Remove from favorites") : t("Add to favorites");
  const handleToggle = () =>
    toggleFavorite.mutate({
      type,
      id,
      isFavorite,
      spaceId,
    });
  const star = (
    <IconStar
      size={presentation === "menu-item" ? 16 : 20}
      stroke={1.8}
      fill={isFavorite ? "currentColor" : "none"}
    />
  );

  if (presentation === "menu-item") {
    return (
      <Menu.Item
        leftSection={
          toggleFavorite.isPending ? (
            <Loader size={16} aria-hidden="true" />
          ) : (
            star
          )
        }
        disabled={toggleFavorite.isPending}
        aria-busy={toggleFavorite.isPending}
        data-page-header-menu-action="favorite"
        onClick={handleToggle}
      >
        {label}
      </Menu.Item>
    );
  }

  return (
    <Tooltip label={label} openDelay={250} withArrow>
      <ActionIcon
        variant="subtle"
        color={isFavorite ? "yellow" : "dark"}
        loading={toggleFavorite.isPending}
        aria-label={label}
        data-page-header-action="favorite"
        onClick={handleToggle}
      >
        {star}
      </ActionIcon>
    </Tooltip>
  );
}
