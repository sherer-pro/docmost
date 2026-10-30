import { atom } from "jotai";
import type { AiDatabaseContext } from "@docmost/api-contract";

export const databaseAiContextAtom = atom<Record<string, AiDatabaseContext>>(
  {},
);
