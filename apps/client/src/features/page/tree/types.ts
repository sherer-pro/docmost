import { PageCustomFieldStatus } from "@/features/page/types/page.types.ts";
import { PageAccessInfo } from "@/features/page/types/page.types.ts";

/**
 * Tree node type discriminator.
 *
 * Important: databaseRow is currently used as a reserved type
 * for future display of base rows within the same tree.
 */
export type SpaceTreeNodeType = "page" | "database" | "databaseRow";

/**
 * A unified sidebar tree node for pages and databases.
 */
export type SpaceTreeNode = {
  id: string;
  nodeType: SpaceTreeNodeType;
  /**
   * For page this is a page slug.
   * There is no field for database/databaseRow.
   */
  slugId?: string | null;
  /**
   * For database - id of the database entity (for API), and the route is built using slugId: /db/:slug.
   * For page it is usually null.
   */
  databaseId?: string | null;
  name: string;
  icon?: string | null;
  status?: PageCustomFieldStatus | null;
  position: string;
  spaceId: string;
  parentPageId: string | null;
  hasChildren: boolean;
  access?: PageAccessInfo;
  children: SpaceTreeNode[];
};
