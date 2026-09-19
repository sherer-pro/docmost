import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router-dom";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

const DraftContext = createContext<(id: string, dirty: boolean) => void>(
  () => {},
);

export function SettingsDraftProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const drafts = useRef(new Set<string>());
  const [dirty, setDirty] = useState(false);
  const register = useCallback((id: string, changed: boolean) => {
    if (changed) drafts.current.add(id);
    else drafts.current.delete(id);
    setDirty(drafts.current.size > 0);
  }, []);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      drafts.current.size > 0 &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (!drafts.current.size) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  return (
    <DraftContext.Provider value={register}>
      {dirty && (
        <Text size="sm" c="dimmed" role="status" mb="sm">
          {t("spaceAdmin.unsaved")}
        </Text>
      )}
      {children}
      <Modal
        opened={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        title={t("spaceAdmin.leaveTitle")}
        closeButtonProps={{ "aria-label": t("Close") }}
      >
        <Stack>
          <Text>{t("spaceAdmin.leaveDescription")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => blocker.reset?.()}>
              {t("spaceAdmin.keepEditing")}
            </Button>
            <Button
              color="orange"
              onClick={() => {
                drafts.current.clear();
                setDirty(false);
                blocker.proceed?.();
              }}
            >
              {t("spaceAdmin.discardAndLeave")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </DraftContext.Provider>
  );
}

export function useSettingsDirty(dirty: boolean) {
  const id = useId();
  const register = useContext(DraftContext);
  useEffect(() => {
    register(id, dirty);
    return () => register(id, false);
  }, [id, register, dirty]);
  return useCallback(() => register(id, false), [id, register]);
}

export function useSettingsDraft<T>(source: T) {
  const [initial, setInitial] = useState(source);
  const [value, setValue] = useState(source);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const dirty = JSON.stringify(initial) !== JSON.stringify(value);
  const release = useSettingsDirty(dirty);
  const sourceKey = JSON.stringify(source);
  const lastSource = useRef(sourceKey);
  useEffect(() => {
    if (lastSource.current !== sourceKey && !dirty && !pending) {
      setInitial(source);
      setValue(source);
    }
    lastSource.current = sourceKey;
  }, [sourceKey, dirty, pending]);
  const reset = (next = source) => {
    setInitial(next);
    setValue(next);
    setError(false);
    release();
  };
  const save = async (
    submit: (value: T, initial: T) => Promise<T>,
    onSaved?: () => void,
  ) => {
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      const saved = await submit(value, initial);
      setInitial(saved);
      setValue(saved);
      release();
      onSaved?.();
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setPending(false);
    }
  };
  return { value, setValue, initial, dirty, pending, error, reset, save };
}

export function SettingsSaveBar({
  dirty,
  pending,
  error,
  onCancel,
}: {
  dirty: boolean;
  pending: boolean;
  error: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack gap="xs" mt="md">
      {error && (
        <Alert color="red" role="alert">
          {t("spaceAdmin.saveFailed")}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button
          variant="default"
          disabled={!dirty || pending}
          onClick={() => onCancel()}
        >
          {t("Cancel")}
        </Button>
        <Button type="submit" disabled={!dirty} loading={pending}>
          {t("Save")}
        </Button>
      </Group>
    </Stack>
  );
}
