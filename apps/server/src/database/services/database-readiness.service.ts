import { Injectable } from '@nestjs/common';

@Injectable()
export class DatabaseReadinessService {
  private ready = false;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.resolveReady();
  }

  async waitUntilReady(): Promise<void> {
    await this.readyPromise;
  }
}
