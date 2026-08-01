import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { IWorkspace } from "@/features/workspace/types/workspace.types.ts";
import { getJoinedWorkspaces } from "@/features/cloud/services/cloud-service.ts";

export function useJoinedWorkspacesQuery(): UseQueryResult<
  Partial<IWorkspace[]>,
  Error
> {
  return useQuery({
    queryKey: ["joined-workspaces"],
    queryFn: () => getJoinedWorkspaces(),
  });
}
