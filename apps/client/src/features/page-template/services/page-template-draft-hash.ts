import {
  formatTemplateDraftId,
  normalizeTemplateDraft,
  serializeTemplateDraftSeed,
  serializeTemplateInstanceContentForHash,
} from "@docmost/editor-ext";

export async function hashProseMirrorJson(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

export async function hashNormalizedTemplateDraft(
  value: unknown,
): Promise<string> {
  const seed = await sha256Hex(serializeTemplateDraftSeed(value));
  const topLevelCount =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { content?: unknown }).content)
      ? (value as { content: unknown[] }).content.length
      : 0;
  const generatedIds = await Promise.all(
    Array.from({ length: topLevelCount + 4 }, async (_, index) =>
      formatTemplateDraftId(await sha256Hex(`${seed}:${index}`)),
    ),
  );
  let generatedIndex = 0;
  const normalized = normalizeTemplateDraft(value, () => {
    const next = generatedIds[generatedIndex++];
    if (!next) throw new Error("template_draft_id_budget_exhausted");
    return next;
  });
  return hashProseMirrorJson(normalized);
}

export async function hashTemplateInstanceContent(
  value: unknown,
): Promise<string> {
  return sha256Hex(serializeTemplateInstanceContentForHash(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
