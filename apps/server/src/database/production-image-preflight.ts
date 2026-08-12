const IMMUTABLE_IMAGE_REFERENCE = /^[^\s@]+@sha256:[0-9a-f]{64}$/u;

export function isImmutableImageReference(value: string | undefined): boolean {
  return IMMUTABLE_IMAGE_REFERENCE.test(value ?? '');
}

function main(): void {
  const valid = isImmutableImageReference(process.env.DOCMOST_IMAGE_REF);
  console.log(
    JSON.stringify({
      status: valid ? 'ok' : 'unsupported',
      exitCode: valid ? 0 : 30,
      issues: valid ? [] : ['application_image_not_immutable'],
    }),
  );
  process.exitCode = valid ? 0 : 30;
}

if (require.main === module) {
  main();
}
