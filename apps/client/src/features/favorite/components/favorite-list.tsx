import { Anchor, Group, Stack, Text } from "@mantine/core";
import { IconFileText, IconFolder } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useFavoritesQuery } from "@/features/favorite/queries/favorite-query";
import { FavoriteType, IFavorite } from "@/features/favorite/types/favorite.types";
import { buildPageUrl } from "@/features/page/page.utils";

interface FavoriteListProps {
  type?: FavoriteType;
  spaceId?: string;
}

function favoriteHref(favorite: IFavorite): string {
  if (favorite.type === "space") {
    return favorite.space?.slug ? `/s/${favorite.space.slug}` : "#";
  }

  if (!favorite.space?.slug || !favorite.page?.slugId) {
    return "#";
  }

  return buildPageUrl(
    favorite.space.slug,
    favorite.page.slugId,
    favorite.page?.title,
  );
}

function favoriteTitle(favorite: IFavorite): string {
  if (favorite.type === "space") {
    return favorite.space?.name || "Untitled";
  }

  return favorite.page?.title || "Untitled";
}

export default function FavoriteList({ type, spaceId }: FavoriteListProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useFavoritesQuery({ type, spaceId });
  const favorites = data?.items ?? [];

  if (isLoading) {
    return <Text c="dimmed">{t("Loading...")}</Text>;
  }

  if (favorites.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {t("No favorites yet")}
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {!type && (
        <Text fw={500} size="sm">
          {t("Favorites")}
        </Text>
      )}
      {favorites.map((favorite) => (
        <Anchor
          key={favorite.id}
          component={Link}
          to={favoriteHref(favorite)}
          underline="never"
        >
          <Group gap="xs" wrap="nowrap">
            {favorite.type === "space" ? (
              <IconFolder size={18} stroke={1.6} />
            ) : (
              <IconFileText size={18} stroke={1.6} />
            )}
            <Text size="sm" c="var(--mantine-color-text)" truncate>
              {favoriteTitle(favorite)}
            </Text>
            {favorite.type === "page" && favorite.space?.name && (
              <Text size="xs" c="dimmed" truncate>
                {favorite.space.name}
              </Text>
            )}
          </Group>
        </Anchor>
      ))}
    </Stack>
  );
}
