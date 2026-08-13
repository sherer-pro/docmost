abstract class StartupError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class StartupConfigurationError extends StartupError {
  constructor(public readonly issues: readonly string[]) {
    super(`Invalid runtime configuration: ${issues.join('; ')}`);
  }
}

export class DatabaseConnectionError extends StartupError {
  constructor(attempts: number) {
    super(`Failed to connect to the database after ${attempts} attempts`);
  }
}

export class DatabaseMigrationError extends StartupError {
  constructor() {
    super('Failed to apply database migrations');
  }
}

export class DatabasePreflightError extends StartupError {
  constructor(
    public readonly exitCode: number,
    public readonly issueCodes: readonly string[],
  ) {
    super(
      `Database preflight failed with exit code ${exitCode}: ${issueCodes.join(', ')}`,
    );
  }
}

const STARTUP_CLOSE_TIMEOUT_MS = 5_000;

type ClosableApplication = {
  close: () => Promise<unknown> | unknown;
};

type ExitProcess = (code: number) => never;

export async function closeApplicationOnStartupFailure(
  app: ClosableApplication | undefined,
  timeoutMs = STARTUP_CLOSE_TIMEOUT_MS,
): Promise<void> {
  if (!app) {
    return;
  }

  let timeout: NodeJS.Timeout | undefined;
  const close = Promise.resolve()
    .then(() => app.close())
    .catch(() => undefined);
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMs);
  });

  await Promise.race([close, deadline]);
  if (timeout) {
    clearTimeout(timeout);
  }
}

export function terminateStartup(
  error: unknown,
  exit: ExitProcess = process.exit,
): never {
  if (error instanceof StartupError) {
    console.error(error.message);
  } else {
    console.error('Application startup failed');
  }
  return exit(1);
}
