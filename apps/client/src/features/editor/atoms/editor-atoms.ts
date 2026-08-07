import { atom, type PrimitiveAtom } from "jotai";
import { Editor } from "@tiptap/core";

export interface IActivePageUser {
  id: string;
  name: string;
  avatarUrl: string;
}

export const pageEditorAtom = atom<Editor | null>(
  null,
) as PrimitiveAtom<Editor | null>;

export const titleEditorAtom = atom<Editor | null>(
  null,
) as PrimitiveAtom<Editor | null>;

export const readOnlyEditorAtom = atom<Editor | null>(
  null,
) as PrimitiveAtom<Editor | null>;

export const yjsConnectionStatusAtom = atom<string>("");

export const pageEditorUnsyncedChangesAtom = atom<number>(0);

export const activePageUsersAtom = atom<IActivePageUser[]>([]);
