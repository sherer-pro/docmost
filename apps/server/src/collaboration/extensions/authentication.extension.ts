import {
  beforeHandleMessagePayload,
  Extension,
  onAuthenticatePayload,
} from '@hocuspocus/server';
import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from '../../core/auth/services/token.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { getPageId } from '../collaboration.util';
import { JwtCollabPayload, JwtType } from '../../core/auth/dto/jwt-payload';
import { PageAccessService } from '../../core/page-access/page-access.service';
import { SpacePolicyService } from '../../core/space-policy/space-policy.service';

interface CollabAuthenticationContext {
  userId: string;
  workspaceId: string;
  sessionId: string;
  pageId: string;
  user?: Awaited<ReturnType<UserRepo['findById']>>;
}

@Injectable()
export class AuthenticationExtension implements Extension {
  private readonly logger = new Logger(AuthenticationExtension.name);

  constructor(
    private tokenService: TokenService,
    private userRepo: UserRepo,
    private pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly userSessionRepo: UserSessionRepo,
    private readonly spacePolicy: SpacePolicyService,
  ) {}

  async onAuthenticate(data: onAuthenticatePayload) {
    const { documentName, token } = data;
    const pageId = getPageId(documentName);

    let jwtPayload: JwtCollabPayload;

    try {
      jwtPayload = await this.tokenService.verifyJwt(token, JwtType.COLLAB);
    } catch (error) {
      throw new UnauthorizedException('Invalid collab token');
    }

    const userId = jwtPayload.sub;
    const workspaceId = jwtPayload.workspaceId;

    // Without a session check, a collab token would keep granting read and write
    // access over the websocket after logout, "revoke all sessions", or a
    // password reset — precisely the actions used to recover from a compromise.
    if (!jwtPayload.sessionId) {
      throw new UnauthorizedException('Collab token is not bound to a session');
    }

    if (jwtPayload.pageId && jwtPayload.pageId !== pageId) {
      throw new UnauthorizedException(
        'Collab token is bound to a different page',
      );
    }

    const context: CollabAuthenticationContext = {
      userId,
      workspaceId,
      sessionId: jwtPayload.sessionId,
      pageId,
    };
    const { user, canWrite } = await this.authorizeConnection(context);

    if (!canWrite) {
      data.connectionConfig.readOnly = true;
      this.logger.debug(`User granted readonly access to page: ${pageId}`);
    }

    this.logger.debug(`Authenticated user ${user.id} on page ${pageId}`);

    return {
      ...context,
      user,
    };
  }

  async beforeHandleMessage(data: beforeHandleMessagePayload): Promise<void> {
    for (const connection of data.document.getConnections()) {
      try {
        const authorization = await this.authorizeConnection(
          connection.context as CollabAuthenticationContext,
        );
        connection.context.user = authorization.user;
        connection.readOnly = !authorization.canWrite;
      } catch {
        connection.close();
        if (connection === data.connection) {
          throw new UnauthorizedException(
            'Collaboration authorization is no longer valid',
          );
        }
      }
    }
  }

  private async authorizeConnection(context: CollabAuthenticationContext) {
    if (
      !context?.userId ||
      !context.workspaceId ||
      !context.sessionId ||
      !context.pageId
    ) {
      throw new UnauthorizedException('Invalid collaboration context');
    }

    const session = await this.userSessionRepo.findActiveById(context.sessionId);
    if (
      !session ||
      session.userId !== context.userId ||
      session.workspaceId !== context.workspaceId
    ) {
      throw new UnauthorizedException('Collab token session is no longer active');
    }

    const user = await this.userRepo.findById(
      context.userId,
      context.workspaceId,
    );
    if (!user || user.deactivatedAt || user.deletedAt) {
      throw new UnauthorizedException();
    }

    const page = await this.pageRepo.findById(context.pageId);
    if (!page || page.workspaceId !== context.workspaceId) {
      this.logger.warn(`Page not found: ${context.pageId}`);
      throw new NotFoundException('Page not found');
    }

    const policy = await this.spacePolicy.resolve(
      context.workspaceId,
      page.spaceId,
    );
    const assurance = policy
      ? this.spacePolicy.evaluateAuthentication(policy.effective, session)
      : null;
    if (!assurance?.satisfied) {
      throw new UnauthorizedException('Additional authentication is required');
    }

    const access = await this.pageAccessService.getEffectiveAccess(page, user);
    if (!access.capabilities.canRead) {
      this.logger.warn(
        `User not authorized to access page: ${context.pageId}`,
      );
      throw new UnauthorizedException();
    }

    return { user, canWrite: access.capabilities.canWrite };
  }
}
