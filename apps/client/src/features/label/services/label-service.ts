import api from "@/lib/api-client";
import { IPagination } from "@/lib/types";
import { IPageLabel } from "@/features/page/services/page-service";

export interface ILabelRegistryItem extends IPageLabel {
  pageCount: number;
}

export async function getLabelRegistry(data: {
  spaceId: string;
  cursor?: string;
}): Promise<IPagination<ILabelRegistryItem>> {
  const req = await api.post<IPagination<ILabelRegistryItem>>(
    "/labels/registry",
    {
      spaceId: data.spaceId,
      type: "page",
      limit: 50,
      cursor: data.cursor,
    },
  );
  return req.data;
}

export async function renameLabel(data: {
  labelId: string;
  spaceId: string;
  name: string;
}): Promise<IPageLabel> {
  const req = await api.post<IPageLabel>("/labels/rename", data);
  return req.data;
}

export async function deleteLabel(data: {
  labelId: string;
  spaceId: string;
}): Promise<void> {
  await api.post<void>("/labels/delete", data);
}
