async function hashFileContent(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function buildAiUploadIdempotencyPayload(
  conversationId: string,
  files: File[],
) {
  const descriptors = [];
  for (const file of files) {
    descriptors.push({
      name: file.name,
      mimeType: file.type || null,
      size: file.size,
      sha256: await hashFileContent(file),
    });
  }
  return { conversationId, files: descriptors };
}
