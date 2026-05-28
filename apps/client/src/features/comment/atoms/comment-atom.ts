import { atom } from 'jotai';

export type DraftCommentRange = { from: number; to: number };

const initialDraftCommentRange: DraftCommentRange | null = null;

export const showCommentPopupAtom = atom<boolean>(false);
export const activeCommentIdAtom = atom<string | null>('');
export const draftCommentIdAtom = atom<string>('');
export const draftCommentRangeAtom = atom(initialDraftCommentRange);
