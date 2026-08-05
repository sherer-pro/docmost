import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { getCollabToken, verifyUserToken } from "../services/auth-service";
import { ICollabToken, IVerifyUserToken } from "../types/auth.types";
import { isAxiosError } from "axios";

const COLLAB_TOKEN_MAX_RETRIES = 10;
const COLLAB_TOKEN_RETRY_BASE_DELAY_MS = 5_000;
const COLLAB_TOKEN_RETRY_MAX_DELAY_MS = 60_000;

export function shouldRetryCollabToken(
  failureCount: number,
  error: Error,
): boolean {
  if (isAxiosError(error) && error.response?.status === 404) {
    return false;
  }

  return failureCount < COLLAB_TOKEN_MAX_RETRIES;
}

export function getCollabTokenRetryDelay(retryAttempt: number): number {
  return Math.min(
    COLLAB_TOKEN_RETRY_BASE_DELAY_MS * Math.pow(2, retryAttempt),
    COLLAB_TOKEN_RETRY_MAX_DELAY_MS,
  );
}

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
    retry: shouldRetryCollabToken,
    retryDelay: getCollabTokenRetryDelay,
  });
}
