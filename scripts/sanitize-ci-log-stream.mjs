import { createInterface } from "node:readline";

const canaries = (process.env.CI_LOG_CANARIES ?? "")
  .split(";")
  .map((value) => value.trim())
  .filter(Boolean);

export function sanitizeLogLine(input) {
  let output = input;
  for (const canary of canaries) {
    output = output.replaceAll(canary, "[REDACTED_EXACT]");
  }

  return output
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
      "[REDACTED_JWT]",
    )
    .replace(/\bBearer\s+[^\s"']+/giu, "Bearer [REDACTED]")
    .replace(
      /\b(authToken|csrfToken|sessionToken)=([^;\s]+)/giu,
      "$1=[REDACTED]",
    )
    .replace(
      /\b(postgres(?:ql)?|redis):\/\/[^\s/@:]+:[^\s/@]+@/giu,
      "$1://[REDACTED]@",
    )
    .replace(
      /([?&](?:token|key|secret|password|signature|jwt)=)[^&#\s]*/giu,
      "$1[REDACTED]",
    )
    .replace(
      /\b(api[_-]?key|password|secret|token)\s*[:=]\s*([^\s,;]+)/giu,
      "$1=[REDACTED]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED_EMAIL]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/gu, "[REDACTED_PRIVATE_KEY]");
}

if (process.argv[1]?.endsWith("sanitize-ci-log-stream.mjs")) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    process.stdout.write(`${sanitizeLogLine(line)}\n`);
  }
}
