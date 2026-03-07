import api from "@/lib/api-client";
import { ICurrentUser, IUser } from "@/features/user/types/user.types";
import { ApiResponseEnvelope } from "@docmost/api-contract";

function isEnvelope<T>(value: unknown): value is ApiResponseEnvelope<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "success" in value &&
    "status" in value
  );
}

function unwrapResponse<T>(value: unknown): T {
  return isEnvelope<T>(value) ? (value.data as T) : (value as T);
}

/**
 * Fetches the current user's profile through a read-only endpoint.
 *
 * We use GET so the request is not treated as a mutating method by CSRF checks
 * and works correctly even before the CSRF cookie is initialized.
 */
export async function getMyInfo(): Promise<ICurrentUser> {
  const req = await api.get<ICurrentUser>("/users/me");
  return unwrapResponse<ICurrentUser>(req);
}

export async function updateUser(data: Partial<IUser>): Promise<IUser> {
  const req = await api.post<IUser>("/users/update", data);
  return unwrapResponse<IUser>(req);
}
