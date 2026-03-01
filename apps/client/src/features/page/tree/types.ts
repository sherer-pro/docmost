import { PageCustomFieldStatus } from "@/features/page/types/page.types.ts";

/**
 * Дискриминатор типа узла дерева.
 *
 * Важно: databaseRow пока используется как зарезервированный тип
 * для будущего отображения строк базы внутри того же дерева.
 */
export type SpaceTreeNodeType = "page" | "database" | "databaseRow";

/**
 * Унифицированная нода sidebar-дерева для страниц и баз данных.
 */
export type SpaceTreeNode = {
  id: string;
  nodeType: SpaceTreeNodeType;
  /**
   * Для page это slug страницы.
   * Для database/databaseRow поле отсутствует.
   */
  slugId?: string | null;
  /**
   * Для database — id сущности базы (для API), а роут строится по slugId: /db/:slug.
   * Для page обычно null.
   */
  databaseId?: string | null;
  name: string;
  icon?: string | null;
  status?: PageCustomFieldStatus | null;
  position: string;
  spaceId: string;
  parentPageId: string | null;
  hasChildren: boolean;
  children: SpaceTreeNode[];
};
