import {
  IsNotEmpty,
  IsOptional,
  Matches,
  IsString,
  ValidateIf,
} from 'class-validator';

/**
 * DTO для входящих websocket-сообщений типа `message`.
 *
 * Валидация выполняется на сервере до ретрансляции события:
 * - запрещает payload без целевой комнаты;
 * - разрешает только допустимые префиксы комнат (`workspace-*`, `space-*`, `user-*`);
 * - требует `spaceId` для `space-*` комнат;
 * - требует `workspaceId` для `workspace-*` комнат.
 */
export class WsMessageDto {
  /**
   * Тип операции, которую клиент хочет распространить внутри разрешённой комнаты.
   */
  @IsString()
  @IsNotEmpty()
  operation: string;

  /**
   * Явная целевая комната.
   * Глобальный broadcast не поддерживается: клиент обязан указать одну из разрешённых комнат.
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^(workspace|space|user)-.+$/, {
    message:
      'targetRoom должен начинаться с одного из префиксов: workspace-, space-, user-',
  })
  targetRoom: string;

  /**
   * Идентификатор пространства обязателен при отправке в комнату вида `space-*`.
   */
  @ValidateIf((dto: WsMessageDto) => dto.targetRoom?.startsWith('space-'))
  @IsString()
  @IsNotEmpty()
  spaceId?: string;

  /**
   * Идентификатор воркспейса обязателен при отправке в комнату вида `workspace-*`.
   */
  @ValidateIf((dto: WsMessageDto) => dto.targetRoom?.startsWith('workspace-'))
  @IsString()
  @IsNotEmpty()
  workspaceId?: string;

  /**
   * Свободный полезный payload события.
   * Явно оставляем опциональным, т.к. содержимое зависит от operation.
   */
  @IsOptional()
  data?: unknown;
}
