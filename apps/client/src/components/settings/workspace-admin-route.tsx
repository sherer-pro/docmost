import { Navigate, Outlet } from "react-router-dom";
import APP_ROUTE from "@/lib/app-route.ts";
import useCurrentUser from "@/features/user/hooks/use-current-user.ts";
import { UserRole } from "@/lib/types.ts";

export default function WorkspaceAdminRoute() {
  const { data: currentUser, isLoading } = useCurrentUser();
  const role = currentUser?.user?.role;
  const isAdmin = role === UserRole.OWNER || role === UserRole.ADMIN;

  if (isLoading) {
    return null;
  }

  if (!isAdmin) {
    return <Navigate to={APP_ROUTE.SETTINGS.ACCOUNT.PROFILE} replace />;
  }

  return <Outlet />;
}
