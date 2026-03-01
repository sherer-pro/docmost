import { PageCustomFieldStatus } from "@/features/page/types/page.types.ts";

export type SpaceTreeNode = {
  id: string;
  slugId: string;
  name: string;
  icon?: string;
  status?: PageCustomFieldStatus | null;
  position: string;
  spaceId: string;
  parentPageId: string;
  hasChildren: boolean;
  children: SpaceTreeNode[];
};
