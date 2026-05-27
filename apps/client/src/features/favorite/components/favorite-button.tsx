import { ActionIcon, Tooltip } from "@mantine/core";
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
}

export default function FavoriteButton({
  type,
  id,
  spaceId,
}: FavoriteButtonProps) {
  const { t } = useTranslation();
  const { data } = useFavoriteIdsQuery(type, spaceId);
  const toggleFavorite = useToggleFavoriteMutation();
  const isFavorite = data?.items?.includes(id) ?? false;

  return (
    <Tooltip
      label={isFavorite ? t("Remove from favorites") : t("Add to favorites")}
      openDelay={250}
      withArrow
    >
      <ActionIcon
        variant="subtle"
        color={isFavorite ? "yellow" : "dark"}
        loading={toggleFavorite.isPending}
        aria-label={
          isFavorite ? t("Remove from favorites") : t("Add to favorites")
        }
        onClick={() =>
          toggleFavorite.mutate({
            type,
            id,
            isFavorite,
            spaceId,
          })
        }
      >
        <IconStar
          size={20}
          stroke={1.8}
          fill={isFavorite ? "currentColor" : "none"}
        />
      </ActionIcon>
    </Tooltip>
  );
}
