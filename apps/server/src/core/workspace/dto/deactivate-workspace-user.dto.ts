import { IsNotEmpty, IsUUID } from 'class-validator';

/**
 * DTO for deactivating a workspace member.
 *
 * Only `userId` is required because workspace context and authenticated user
 * are already resolved from JWT/decorators at the controller layer.
 */
export class DeactivateWorkspaceUserDto {
  @IsNotEmpty()
  @IsUUID()
  userId: string;
}
