import {
  DEFAULT_PAGE_AI_ROLE,
  PAGE_AI_ROLE,
  type PageAiRole,
} from "@docmost/api-contract";

export interface AiRoleOption {
  value: PageAiRole;
  label: string;
  tooltip: string;
  color: string;
  palette: "gray" | "green" | "cyan" | "blue" | "red";
}

export const DEFAULT_AI_ROLE = DEFAULT_PAGE_AI_ROLE;

export const AI_ROLE_OPTIONS: AiRoleOption[] = [
  {
    value: PAGE_AI_ROLE.NONE,
    label: "None",
    tooltip: "AI was not used to create or edit this document.",
    color: "gray.4",
    palette: "gray",
  },
  {
    value: PAGE_AI_ROLE.EDITOR,
    label: "Editor",
    tooltip: "AI was used only to edit and improve text written by a person.",
    color: "green.6",
    palette: "green",
  },
  {
    value: PAGE_AI_ROLE.COAUTHOR,
    label: "Coauthor",
    tooltip: "A person and AI contributed about equally.",
    color: "cyan.5",
    palette: "cyan",
  },
  {
    value: PAGE_AI_ROLE.COAUTHOR_PLUS,
    label: "Coauthor+",
    tooltip:
      "AI created most of the content; a person guided, reviewed, and refined it.",
    color: "blue.9",
    palette: "blue",
  },
  {
    value: PAGE_AI_ROLE.AUTHOR,
    label: "Author",
    tooltip: "AI created the document without meaningful human contribution.",
    color: "red.6",
    palette: "red",
  },
];
