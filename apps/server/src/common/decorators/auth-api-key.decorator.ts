import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

export const AuthApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    if (!request?.user?.apiKey) {
      throw new BadRequestException('Invalid API key');
    }
    return request.user.apiKey;
  },
);
