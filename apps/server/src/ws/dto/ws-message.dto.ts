import {
  IsNotEmpty,
  IsOptional,
  Matches,
  IsString,
  ValidateIf,
} from 'class-validator';

/**
 * DTO for incoming `message` WebSocket events.
 *
 * Validation happens server-side before rebroadcasting:
 * - rejects payloads without an explicit target room;
 * - allows only supported room prefixes (`workspace-*`, `space-*`, `user-*`);
 * - requires `spaceId` for `space-*` rooms;
 * - requires `workspaceId` for `workspace-*` rooms.
 */
export class WsMessageDto {
  /**
   * Operation name the client wants to broadcast inside an authorized room.
   */
  @IsString()
  @IsNotEmpty()
  operation: string;

  /**
   * Explicit target room.
   * Global broadcast is not supported: clients must target one authorized room.
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^(workspace|space|user)-.+$/, {
    message:
      'targetRoom must start with one of the prefixes: workspace-, space-, user-',
  })
  targetRoom: string;

  /**
   * Space identifier, required when the target room uses the `space-*` prefix.
   */
  @ValidateIf((dto: WsMessageDto) => dto.targetRoom?.startsWith('space-'))
  @IsString()
  @IsNotEmpty()
  spaceId?: string;

  /**
   * Workspace identifier, required when the target room uses `workspace-*`.
   */
  @ValidateIf((dto: WsMessageDto) => dto.targetRoom?.startsWith('workspace-'))
  @IsString()
  @IsNotEmpty()
  workspaceId?: string;

  /**
   * Free-form event payload.
   * Kept optional because the structure depends on `operation`.
   */
  @IsOptional()
  data?: unknown;
}
