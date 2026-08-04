import { useEffect } from "react";
import useCurrentUser from "@/features/user/hooks/use-current-user.ts";
import APP_ROUTE from "@/lib/app-route.ts";
import { useNavigate, useSearchParams } from "react-router-dom";
import { sanitizeRelativeReturnTo } from "@/features/auth/utils/return-to.ts";

export function useRedirectIfAuthenticated() {
  const { data, isLoading } = useCurrentUser();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (data && data?.user) {
      const returnTo = searchParams.get("returnTo");
      navigate(sanitizeRelativeReturnTo(returnTo, APP_ROUTE.HOME));
    }
  }, [isLoading, data]);
}
