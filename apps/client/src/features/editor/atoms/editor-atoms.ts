import { atom } from "jotai";
import { Editor } from "@tiptap/core";

export interface IActivePageUser {
  id: string;
  name: string;
  avatarUrl: string;
}

export const pageEditorAtom = atom<Editor | null>(null);

export const titleEditorAtom = atom<Editor | null>(null);

export const readOnlyEditorAtom = atom<Editor | null>(null);

export const yjsConnectionStatusAtom = atom<string>("");

export const activePageUsersAtom = atom<IActivePageUser[]>([]);

export const showAiMenuAtom = atom(false);
