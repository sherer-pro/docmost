import type { QueryClient } from "@tanstack/react-query";
import type { ISpace } from "@/features/space/types/space.types";

export function applySpaceUpdateToCache(
  queryClient: QueryClient,
  spaceId: string,
  spacePatch: Partial<ISpace>,
) {
  queryClient.setQueriesData<ISpace>({ queryKey: ["space"] }, (cachedSpace) => {
    if (!cachedSpace || cachedSpace.id !== spaceId) {
      return cachedSpace;
    }

    return { ...cachedSpace, ...spacePatch };
  });

  queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === "space" &&
      ((query.state.data as ISpace | undefined)?.id === spaceId ||
        query.queryKey[1] === spaceId ||
        query.queryKey[1] === spacePatch.slug),
  });
}
