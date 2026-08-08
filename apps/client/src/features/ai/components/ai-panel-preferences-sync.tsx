import { useEffect, useLayoutEffect, useRef } from "react";
import { useAtom } from "jotai";
import {
  asideStateAtom,
  asideWidthAtom,
} from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateUser } from "@/features/user/services/user-service.ts";
import {
  clampAiPanelWidth,
  getAiPanelPreferencePayload,
} from "@/features/ai/utils/ai-policies.ts";

export function AiPanelPreferencesSync() {
  const [user, setUser] = useAtom(userAtom);
  const [asideState, setAsideState] = useAtom(asideStateAtom);
  const [asideWidth, setAsideWidth] = useAtom(asideWidthAtom);
  const hydratedUserId = useRef<string | null>(null);
  const skipNextPersist = useRef(false);

  useLayoutEffect(() => {
    if (!user || hydratedUserId.current === user.id) {
      return;
    }

    hydratedUserId.current = user.id;
    skipNextPersist.current = true;
    const preferences = user.settings?.preferences;
    setAsideState({
      tab: preferences?.aiPanelTab ?? "",
      isAsideOpen: Boolean(preferences?.aiPanelOpen),
    });
    setAsideWidth(clampAiPanelWidth(preferences?.aiPanelWidth));
  }, [setAsideState, setAsideWidth, user]);

  useEffect(() => {
    if (!user || hydratedUserId.current !== user.id) {
      return;
    }

    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        const updatedUser = await updateUser(
          getAiPanelPreferencePayload({
            aiPanelOpen: asideState.isAsideOpen,
            aiPanelTab: asideState.tab,
            aiPanelWidth: asideWidth,
          }),
        );
        setUser(updatedUser);
      } catch {
        // Local panel state remains usable when preference persistence fails.
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [asideState.isAsideOpen, asideState.tab, asideWidth, setUser, user?.id]);

  return null;
}
