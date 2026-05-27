import { IPage } from "@/features/page/types/page.types";
import { ISpace } from "@/features/space/types/space.types";

export type FavoriteType = "page" | "space";

export interface IFavorite {
  id: string;
  type: FavoriteType;
  pageId?: string | null;
  spaceId?: string | null;
  page?: Partial<IPage> | null;
  space?: Partial<ISpace> | null;
  createdAt: string;
}
