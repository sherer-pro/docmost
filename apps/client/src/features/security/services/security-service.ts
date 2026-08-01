import api from "@/lib/api-client.ts";
import {
  IAuthProvider,
  ICreateAuthProvider,
  IUpdateAuthProvider,
} from "@/features/security/types/security.types.ts";
import { IPagination } from "@/lib/types.ts";

export async function getSsoProviderById(data: {
  providerId: string;
}): Promise<IAuthProvider> {
  const req = await api.post<IAuthProvider>("/sso/info", data);
  return req.data;
}

export async function getSsoProviders(): Promise<IPagination<IAuthProvider>> {
  const req = await api.post<IPagination<IAuthProvider>>("/sso/providers");
  return req.data;
}

export async function createSsoProvider(
  data: ICreateAuthProvider,
): Promise<IAuthProvider> {
  const req = await api.post<IAuthProvider>("/sso/create", data);
  return req.data;
}

export async function deleteSsoProvider(data: {
  providerId: string;
}): Promise<void> {
  await api.post<void>("/sso/delete", data);
}

export async function updateSsoProvider(
  data: IUpdateAuthProvider,
): Promise<IAuthProvider> {
  const req = await api.post<IAuthProvider>("/sso/update", data);
  return req.data;
}
