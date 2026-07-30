import { useEffect } from "react";

interface RootAccessibilityState {
  ariaHidden: string | null;
  inert: boolean;
}

let activeModalCount = 0;
let initialRootState: RootAccessibilityState | null = null;

function setRootInert(root: HTMLElement) {
  if (activeModalCount === 0) {
    initialRootState = {
      ariaHidden: root.getAttribute("aria-hidden"),
      inert: root.hasAttribute("inert"),
    };
  }

  activeModalCount += 1;
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("inert", "");
}

function restoreRoot(root: HTMLElement) {
  activeModalCount = Math.max(0, activeModalCount - 1);
  if (activeModalCount > 0 || !initialRootState) {
    return;
  }

  if (initialRootState.ariaHidden === null) {
    root.removeAttribute("aria-hidden");
  } else {
    root.setAttribute("aria-hidden", initialRootState.ariaHidden);
  }

  if (!initialRootState.inert) {
    root.removeAttribute("inert");
  }

  initialRootState = null;
}

export function useModalBackgroundInert(opened: boolean) {
  useEffect(() => {
    if (!opened) {
      return;
    }

    const root = document.getElementById("root");
    if (!root) {
      return;
    }

    setRootInert(root);
    return () => restoreRoot(root);
  }, [opened]);
}
