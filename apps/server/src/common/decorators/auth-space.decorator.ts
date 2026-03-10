import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

export const AuthSpace = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const space = request?.user?.space;

    if (!space) {
      throw new BadRequestException('Invalid space');
    }

    return space;
  },
);
