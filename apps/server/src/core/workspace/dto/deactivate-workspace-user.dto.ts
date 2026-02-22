import { IsNotEmpty, IsUUID } from 'class-validator';

/**
 * DTO для деактивации участника workspace.
 *
 * Передаём только `userId`, так как контекст workspace и авторизованный пользователь
 * уже извлекаются из JWT/декораторов на уровне контроллера.
 */
export class DeactivateWorkspaceUserDto {
  @IsNotEmpty()
  @IsUUID()
  userId: string;
}
