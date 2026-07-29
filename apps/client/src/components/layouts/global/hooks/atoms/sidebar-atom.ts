import { atomWithWebStorage } from "@/lib/jotai-helper.ts";
import { atom } from "jotai";
import type { AsideTabPreference } from "@/features/user/types/user.types.ts";

export const mobileSidebarAtom = atom<boolean>(false);

export const desktopSidebarAtom = atomWithWebStorage<boolean>(
  "showSidebar",
  true,
);

export const desktopAsideAtom = atom<boolean>(false);

export type AsideStateType = {
  tab: AsideTabPreference;
  isAsideOpen: boolean;
};

export const asideStateAtom = atom<AsideStateType>({
  tab: "",
  isAsideOpen: false,
});

export const sidebarWidthAtom = atomWithWebStorage<number>('sidebarWidth', 300);
export const asideWidthAtom = atom<number>(400);
