import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import {
  JwtApiKeyPayload,
  JwtAttachmentPayload,
  JwtCollabPayload,
  JwtExchangePayload,
  JwtMfaTokenPayload,
  JwtPayload,
  JwtType,
} from '../dto/jwt-payload';
import { User } from '@docmost/db/types/entity.types';

/**
 * Shorter than the previous 24h so a leaked collab token has a bounded replay
 * window. Revocation is handled by the `sessionId` binding, not by this value.
 *
 * Keep the client-side `useCollabToken` staleTime below this, otherwise the
 * editor connects with a cached expired token and has to recover through a
 * failed authentication round trip.
 */
const COLLAB_TOKEN_EXPIRES_IN = '4h';

/** Must match the `signOptions` configured in `TokenModule`. */
export const JWT_ISSUER = 'Docmost';
export const JWT_ALGORITHM = 'HS256' as const;

@Injectable()
export class TokenService {
  constructor(
    private jwtService: JwtService,
    private environmentService: EnvironmentService,
  ) {}

  /**
   * `sessionId` is mandatory: it is the only handle that makes a token
   * revocable. A token without it would stay valid for its full lifetime
   * regardless of logout, session revocation, or a password reset.
   */
  async generateAccessToken(user: User, sessionId: string): Promise<string> {
    if (user.deactivatedAt || user.deletedAt) {
      throw new ForbiddenException();
    }

    if (!sessionId) {
      throw new UnauthorizedException('A session is required to issue a token');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      workspaceId: user.workspaceId,
      sessionId,
      type: JwtType.ACCESS,
    };
    return this.jwtService.sign(payload);
  }

  /**
   * Collab tokens carry the issuing `sessionId` so the collaboration server can
   * reject them once that session is revoked. They are also short-lived: the
   * client re-fetches a token whenever it reconnects.
   */
  async generateCollabToken(
    user: User,
    workspaceId: string,
    sessionId?: string,
    pageId?: string,
  ): Promise<string> {
    if (user.deactivatedAt || user.deletedAt) {
      throw new ForbiddenException();
    }

    const payload: JwtCollabPayload = {
      sub: user.id,
      workspaceId,
      sessionId,
      pageId,
      type: JwtType.COLLAB,
    };

    return this.jwtService.sign(payload, { expiresIn: COLLAB_TOKEN_EXPIRES_IN });
  }

  async generateExchangeToken(
    userId: string,
    workspaceId: string,
  ): Promise<string> {
    const payload: JwtExchangePayload = {
      sub: userId,
      workspaceId: workspaceId,
      type: JwtType.EXCHANGE,
    };
    return this.jwtService.sign(payload, { expiresIn: '10s' });
  }

  async generateAttachmentToken(opts: {
    attachmentId: string;
    pageId: string;
    workspaceId: string;
  }): Promise<string> {
    const { attachmentId, pageId, workspaceId } = opts;
    const payload: JwtAttachmentPayload = {
      attachmentId: attachmentId,
      pageId: pageId,
      workspaceId: workspaceId,
      type: JwtType.ATTACHMENT,
    };
    return this.jwtService.sign(payload, { expiresIn: '1h' });
  }

  async generateAttachmentPageToken(opts: {
    pageId: string;
    workspaceId: string;
  }): Promise<string> {
    const { pageId, workspaceId } = opts;
    const payload: JwtAttachmentPayload = {
      pageId,
      workspaceId,
      type: JwtType.ATTACHMENT,
    };

    return this.jwtService.sign(payload, { expiresIn: '1h' });
  }

  async generateAttachmentPageSetToken(opts: {
    pageIds: string[];
    workspaceId: string;
  }): Promise<string> {
    const pageIds = [...new Set(opts.pageIds)];
    if (pageIds.length === 0) {
      throw new Error('At least one attachment page is required');
    }
    const payload: JwtAttachmentPayload = {
      pageId: pageIds[0],
      pageIds,
      workspaceId: opts.workspaceId,
      type: JwtType.ATTACHMENT,
    };
    return this.jwtService.sign(payload, { expiresIn: '1h' });
  }

  async generateMfaToken(
    user: User,
    workspaceId: string,
    context: {
      ssoAuthProviderId?: string;
      targetSpaceId?: string;
    } = {},
  ): Promise<string> {
    if (user.deactivatedAt || user.deletedAt) {
      throw new ForbiddenException();
    }

    const payload: JwtMfaTokenPayload = {
      sub: user.id,
      workspaceId,
      ssoAuthProviderId: context.ssoAuthProviderId,
      targetSpaceId: context.targetSpaceId,
      type: JwtType.MFA_TOKEN,
    };
    return this.jwtService.sign(payload, { expiresIn: '5m' });
  }

  async generateApiToken(opts: {
    apiKeyId: string;
    user: User;
    workspaceId: string;
    spaceId: string;
    keyType?: 'rag' | 'mcp';
    expiresIn?: string | number;
  }): Promise<string> {
    const {
      apiKeyId,
      user,
      workspaceId,
      spaceId,
      keyType = 'rag',
      expiresIn,
    } = opts;
    if (user.deactivatedAt || user.deletedAt) {
      throw new ForbiddenException();
    }

    const payload: JwtApiKeyPayload = {
      sub: user.id,
      apiKeyId: apiKeyId,
      workspaceId,
      spaceId,
      keyType,
      type: JwtType.API_KEY,
    };

    return this.jwtService.sign(payload, expiresIn ? { expiresIn } : {});
  }

  async verifyJwt(token: string, tokenType: string) {
    const payload = await this.jwtService.verifyAsync(token, {
      secret: this.environmentService.getAppSecret(),
      // Pin the accepted algorithm and issuer explicitly rather than relying on
      // the library's implicit handling of a string secret.
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
    });

    if (payload.type !== tokenType) {
      throw new UnauthorizedException(
        'Invalid JWT token. Token type does not match.',
      );
    }

    return payload;
  }
}
