import { createSpotlight } from "@mantine/spotlight";
import { atom } from "jotai";
import type { BuiltInTagValue } from "@docmost/editor-ext";

export interface SearchSpotlightIntent {
  spaceId: string;
  tags: BuiltInTagValue[];
}

export const searchSpotlightIntentAtom = atom<{
  intent: SearchSpotlightIntent | null;
}>({ intent: null });

export const [searchSpotlightStore, searchSpotlight] = createSpotlight();

export const [shareSearchSpotlightStore, shareSearchSpotlight] =
  createSpotlight();
