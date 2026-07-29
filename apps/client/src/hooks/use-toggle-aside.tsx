import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import { useAtom } from "jotai";
import type { AsideTabPreference } from "@/features/user/types/user.types.ts";

const useToggleAside = () => {
  const [asideState, setAsideState] = useAtom(asideStateAtom);

  const toggleAside = (tab: AsideTabPreference) => {
    if (asideState.tab === tab) {
      setAsideState({ tab, isAsideOpen: !asideState.isAsideOpen });
    } else {
      setAsideState({ tab, isAsideOpen: true });
    }
  };

  return toggleAside;
};

export default useToggleAside;
