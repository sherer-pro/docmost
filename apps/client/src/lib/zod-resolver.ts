import { zod4Resolver } from "mantine-form-zod-resolver";
import { z } from "zod";

export function zodResolver(...args: Parameters<typeof zod4Resolver>) {
  const validate = zod4Resolver(...args);
  // Form interfaces need no index signature; Zod validates their input at runtime.
  return <Values extends object>(values: Values) =>
    validate(values as Record<string, unknown>);
}

export function requiredString(message: string) {
  return z.string({
    error: (issue) => (issue.input === undefined ? message : undefined),
  });
}
