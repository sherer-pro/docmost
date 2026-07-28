import { Extension, onAuthenticatePayload } from '@hocuspocus/server';
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

@Injectable()
export class AuthenticationExtension implements Extension {
  private readonly logger = new Logger(AuthenticationExtension.name);

  constructor(
    private tokenService: TokenService,
    private userRepo: UserRepo,
    private pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly userSessionRepo: UserSessionRepo,
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

    const session = await this.userSessionRepo.findActiveById(
      jwtPayload.sessionId,
    );

    if (
      !session ||
      session.userId !== userId ||
      session.workspaceId !== workspaceId
    ) {
      throw new UnauthorizedException('Collab token session is no longer active');
    }

    const user = await this.userRepo.findById(userId, workspaceId);

    if (!user) {
      throw new UnauthorizedException();
    }

    if (user.deactivatedAt || user.deletedAt) {
      throw new UnauthorizedException();
    }

    const page = await this.pageRepo.findById(pageId);
    if (!page) {
      this.logger.warn(`Page not found: ${pageId}`);
      throw new NotFoundException('Page not found');
    }

    const access = await this.pageAccessService.getEffectiveAccess(page, user);

    if (!access.capabilities.canRead) {
      this.logger.warn(`User not authorized to access page: ${pageId}`);
      throw new UnauthorizedException();
    }

    if (!access.capabilities.canWrite) {
      data.connectionConfig.readOnly = true;
      this.logger.debug(`User granted readonly access to page: ${pageId}`);
    }

    this.logger.debug(`Authenticated user ${user.id} on page ${pageId}`);

    return {
      user,
    };
  }
}
