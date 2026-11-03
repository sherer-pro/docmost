import { useLayoutEffect, useRef, useState } from "react";

interface HandoffState<ModalName extends string> {
  scope: string | undefined;
  menuOpened: boolean;
  modal: ModalName | null;
  suppressMenuReturn: boolean;
  revision: number;
}

interface ModalTransition<ModalName extends string> {
  scope: string;
  modal: ModalName;
  revision: number;
}

/** Wait for the owning menu to leave before activating a modal's focus trap. */
export function useMenuModalHandoff<ModalName extends string>(
  scope: string | undefined,
  getReturnTarget?: (modal: ModalName) => HTMLElement | null,
) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scopeRef = useRef(scope);
  const revisionRef = useRef(0);
  const menuOpenedRef = useRef(false);
  const activeModalRef = useRef<ModalName | null>(null);
  const pendingRef = useRef<ModalTransition<ModalName> | null>(null);
  const restoreRef = useRef<ModalTransition<ModalName> | null>(null);
  const returnTargetRef = useRef(getReturnTarget);
  returnTargetRef.current = getReturnTarget;
  const [state, setState] = useState<HandoffState<ModalName>>({
    scope,
    menuOpened: false,
    modal: null,
    suppressMenuReturn: false,
    revision: 0,
  });

  useLayoutEffect(() => {
    const changedScope = scopeRef.current !== scope;
    scopeRef.current = scope;
    revisionRef.current += 1;
    pendingRef.current = null;
    restoreRef.current = null;
    menuOpenedRef.current = false;
    activeModalRef.current = null;
    setState({
      scope,
      menuOpened: false,
      modal: null,
      suppressMenuReturn: changedScope,
      revision: revisionRef.current,
    });
    return () => {
      scopeRef.current = undefined;
      revisionRef.current += 1;
      pendingRef.current = null;
      restoreRef.current = null;
    };
  }, [scope]);

  const current = state.scope === scope ? state : undefined;

  const changeMenu = (opened: boolean) => {
    if (!scope || scopeRef.current !== scope) return;
    menuOpenedRef.current = opened;
    if (opened) {
      revisionRef.current += 1;
      pendingRef.current = null;
      restoreRef.current = null;
      activeModalRef.current = null;
    }
    setState((previous) => ({
      ...previous,
      menuOpened: opened,
      ...(opened
        ? {
            modal: null,
            suppressMenuReturn: false,
            revision: revisionRef.current,
          }
        : {}),
    }));
  };

  const openModal = (modal: ModalName) => {
    if (!scope || scopeRef.current !== scope) return;
    const fromMenu = menuOpenedRef.current;
    const revision = ++revisionRef.current;
    pendingRef.current = fromMenu ? { scope, modal, revision } : null;
    restoreRef.current = null;
    menuOpenedRef.current = false;
    activeModalRef.current = fromMenu ? null : modal;
    setState({
      scope,
      menuOpened: false,
      modal: fromMenu ? null : modal,
      suppressMenuReturn: fromMenu,
      revision,
    });
  };

  const completeMenuExit = (revision: number | undefined) => {
    const pending = pendingRef.current;
    if (
      !pending ||
      pending.scope !== scopeRef.current ||
      pending.revision !== revision ||
      pending.revision !== revisionRef.current ||
      menuOpenedRef.current
    )
      return;
    pendingRef.current = null;
    activeModalRef.current = pending.modal;
    setState((previous) => ({ ...previous, modal: pending.modal }));
  };

  const closeModal = (modal: ModalName) => {
    if (
      !scope ||
      scope !== scopeRef.current ||
      activeModalRef.current !== modal
    )
      return;
    activeModalRef.current = null;
    restoreRef.current = { scope, modal, revision: revisionRef.current };
    setState((previous) => ({ ...previous, modal: null }));
  };

  const completeModalExit = (
    modal: ModalName,
    revision: number | undefined,
  ) => {
    const restore = restoreRef.current;
    if (
      !restore ||
      restore.scope !== scopeRef.current ||
      restore.modal !== modal ||
      restore.revision !== revision ||
      restore.revision !== revisionRef.current ||
      activeModalRef.current ||
      pendingRef.current ||
      menuOpenedRef.current
    )
      return;
    restoreRef.current = null;
    const preferred = returnTargetRef.current?.(modal);
    const target =
      preferred?.isConnected && preferred.getClientRects().length
        ? preferred
        : triggerRef.current;
    if (target?.isConnected && target.getClientRects().length) {
      target.focus({ preventScroll: true });
    }
  };

  return {
    triggerRef,
    openModal,
    menuProps: {
      opened: current?.menuOpened ?? false,
      onChange: changeMenu,
      returnFocus: current ? !current.suppressMenuReturn : false,
      onExitTransitionEnd: () => completeMenuExit(current?.revision),
    },
    getModalProps: (modal: ModalName) => ({
      open: current?.modal === modal,
      onClose: () => closeModal(modal),
      returnFocus: false,
      onExitTransitionEnd: () => completeModalExit(modal, current?.revision),
    }),
  };
}

export type MenuModalHandoff<ModalName extends string> = ReturnType<
  typeof useMenuModalHandoff<ModalName>
>;
