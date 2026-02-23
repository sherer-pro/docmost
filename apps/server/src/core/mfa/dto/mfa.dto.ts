import { IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * DTO for initializing 2FA setup.
 * Currently only the TOTP method via authenticator apps is supported.
 */
export class MfaSetupDto {
  @IsString()
  method: 'totp';
}

/**
 * DTO for verifying and enabling 2FA after scanning a QR code.
 */
export class MfaEnableDto {
  @IsString()
  secret: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  verificationCode: string;
}

/**
 * DTO for disabling 2FA.
 * Password is required only for users with a local password.
 */
export class MfaDisableDto {
  @IsOptional()
  @IsString()
  confirmPassword?: string;
}

/**
 * DTO for validating a 2FA code during login.
 * Supports either a 6-digit TOTP or an 8-character backup code.
 */
export class MfaVerifyDto {
  @IsString()
  @Matches(/^(\d{6}|[A-Za-z0-9]{8})$/)
  code: string;
}
