import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { getCollabToken, verifyUserToken } from "../services/auth-service";
import { ICollabToken, IVerifyUserToken } from "../types/auth.types";
import { isAxiosError } from "axios";

export function useVerifyUserTokenQuery(
  verify: IVerifyUserToken,
): UseQueryResult<any, Error> {
  return useQuery({
    queryKey: ["verify-token", verify],
    queryFn: () => verifyUserToken(verify),
    enabled: !!verify.token,
    staleTime: 0,
  });
}

export function useCollabToken(
  pageId?: string,
): UseQueryResult<ICollabToken, Error> {
  return useQuery({
    queryKey: ["collab-token", pageId],
    queryFn: () => getCollabToken(pageId!),
    enabled: Boolean(pageId),
    // Must stay below the server-side collab token lifetime (4h in
    // TokenService.COLLAB_TOKEN_EXPIRES_IN), otherwise the editor opens with an
    // expired cached token and only recovers after a failed authentication.
    staleTime: 3 * 60 * 60 * 1000, // 3hrs
    refetchOnMount: true,
    //@ts-ignore
    retry: (failureCount, error) => {
      if (isAxiosError(error) && error.response.status === 404) {
        return false;
      }
      return 10;
    },
    retryDelay: (retryAttempt) => {
      // Exponential backoff: 5s, 10s, 20s, etc.
      return 5000 * Math.pow(2, retryAttempt - 1);
    },
  });
}
