import api from "@/lib/api-client";
import { ICurrentUser, IUser } from "@/features/user/types/user.types";

/**
 * Получает профиль текущего пользователя через read-only endpoint.
 *
 * Используем GET, чтобы запрос не подпадал под CSRF-проверку мутирующих
 * методов и корректно отрабатывал даже до инициализации CSRF-cookie.
 */
export async function getMyInfo(): Promise<ICurrentUser> {
  const req = await api.get<ICurrentUser>("/users/me");
  return req.data as ICurrentUser;
}

export async function updateUser(data: Partial<IUser>): Promise<IUser> {
  const req = await api.post<IUser>("/users/update", data);
  return req.data as IUser;
}
