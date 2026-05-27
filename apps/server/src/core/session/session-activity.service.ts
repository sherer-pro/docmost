import { Injectable } from '@nestjs/common';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';

const THROTTLE_MS = 15 * 60 * 1000;

@Injectable()
export class SessionActivityService {
  private readonly trackedAt = new Map<string, number>();

  constructor(
    private readonly userSessionRepo: UserSessionRepo,
    private readonly userRepo: UserRepo,
  ) {}

  trackActivity(sessionId: string, userId: string, workspaceId: string): void {
    const now = Date.now();
    const previous = this.trackedAt.get(sessionId);

    if (previous && now - previous < THROTTLE_MS) {
      return;
    }

    this.trackedAt.set(sessionId, now);
    this.pruneTracker(now);

    this.userSessionRepo.updateLastActiveAt(sessionId).catch(() => {});
    this.userRepo
      .updateUser({ lastActiveAt: new Date() }, userId, workspaceId)
      .catch(() => {});
  }

  private pruneTracker(now: number): void {
    for (const [sessionId, timestamp] of this.trackedAt.entries()) {
      if (now - timestamp > THROTTLE_MS * 2) {
        this.trackedAt.delete(sessionId);
      }
    }
  }
}
