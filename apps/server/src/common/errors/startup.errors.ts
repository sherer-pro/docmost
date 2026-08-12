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

export function terminateStartup(error: unknown): void {
  if (error instanceof StartupError) {
    console.error(error.message);
  } else {
    console.error('Application startup failed');
  }
  process.exitCode = 1;
}
