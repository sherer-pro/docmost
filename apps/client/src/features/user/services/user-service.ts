import api from "@/lib/api-client";
import { ICurrentUser, IUser } from "@/features/user/types/user.types";

/**
 * Fetches the current user's profile through a read-only endpoint.
 *
 * We use GET so the request is not treated as a mutating method by CSRF checks
 * and works correctly even before the CSRF cookie is initialized.
 */
export async function getMyInfo(): Promise<ICurrentUser> {
  const req = await api.get<ICurrentUser>("/users/me");
  return req.data as ICurrentUser;
}

export async function updateUser(data: Partial<IUser>): Promise<IUser> {
  const req = await api.post<IUser>("/users/update", data);
  return req.data as IUser;
}
