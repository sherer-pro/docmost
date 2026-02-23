import { IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * DTO для инициализации настройки 2FA.
 * Сейчас поддерживается только TOTP-метод через приложения-аутентификаторы.
 */
export class MfaSetupDto {
  @IsString()
  method: 'totp';
}

/**
 * DTO для подтверждения и включения 2FA после сканирования QR-кода.
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
 * DTO для отключения 2FA.
 * Пароль обязателен только для пользователей с локальным паролем.
 */
export class MfaDisableDto {
  @IsOptional()
  @IsString()
  confirmPassword?: string;
}

/**
 * DTO для проверки кода 2FA на этапе логина.
 * Поддерживается либо 6-значный TOTP, либо 8-символьный backup-code.
 */
export class MfaVerifyDto {
  @IsString()
  @Matches(/^(\d{6}|[A-Za-z0-9]{8})$/)
  code: string;
}
