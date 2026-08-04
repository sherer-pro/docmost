import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Reflector } from '@nestjs/core';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { addDays } from 'date-fns';
import { CsrfService } from '../security/csrf.service';
import {
  AUTH_POLICY_SCOPE_KEY,
  AuthPolicyScopeMetadata,
} from '../decorators/auth-policy-scope.decorator';
import { AuthenticationAssuranceService } from '../../core/space-policy/authentication-assurance.service';
import { isObservable, lastValueFrom } from 'rxjs';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private environmentService: EnvironmentService,
    private csrfService: CsrfService,
    private readonly authenticationAssurance: AuthenticationAssuranceService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const activation = super.canActivate(context);
    const activated = isObservable(activation)
      ? await lastValueFrom(activation)
      : await activation;

    if (activated) {
      const metadata =
        this.reflector.getAllAndOverride<AuthPolicyScopeMetadata>(
          AUTH_POLICY_SCOPE_KEY,
          [context.getHandler(), context.getClass()],
        );
      await this.authenticationAssurance.assertRequestScope(
        metadata,
        context.switchToHttp().getRequest(),
      );
    }

    return Boolean(activated);
  }

  handleRequest(err: any, user: any, info: any, ctx: ExecutionContext) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    this.setJoinedWorkspacesCookie(user, ctx);
    this.ensureCsrfCookie(ctx);
    return user;
  }

  /**
   * Ensures that an authenticated user always has a CSRF cookie.
   * This lets the client automatically send the token in `x-csrf-token`.
   */
  ensureCsrfCookie(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();

    if (req.cookies?.[CsrfService.COOKIE_NAME]) {
      return;
    }

    this.csrfService.setCsrfCookie(res, this.csrfService.generateToken());
  }

  setJoinedWorkspacesCookie(user: any, ctx: ExecutionContext) {
    if (this.environmentService.isCloud()) {
      const req = ctx.switchToHttp().getRequest();
      const res = ctx.switchToHttp().getResponse();

      const workspaceId = user?.workspace?.id;
      let workspaceIds = [];
      try {
        workspaceIds = req.cookies.joinedWorkspaces
          ? JSON.parse(req.cookies.joinedWorkspaces)
          : [];
      } catch (err) {
        /* empty */
      }

      if (!workspaceIds.includes(workspaceId)) {
        workspaceIds.push(workspaceId);
      }

      res.setCookie('joinedWorkspaces', JSON.stringify(workspaceIds), {
        httpOnly: false,
        domain: '.' + this.environmentService.getSubdomainHost(),
        path: '/',
        expires: addDays(new Date(), 365),
        secure: this.environmentService.isHttps(),
      });
    }
  }
}
