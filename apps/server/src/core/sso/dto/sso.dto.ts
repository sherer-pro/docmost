import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export const SSO_PROVIDER_TYPES = ['saml', 'oidc', 'ldap'] as const;
export type SsoProviderType = (typeof SSO_PROVIDER_TYPES)[number];

export class SsoProviderIdDto {
  @IsUUID()
  providerId: string;
}

export class CreateSsoProviderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  name: string;

  @IsIn(SSO_PROVIDER_TYPES)
  type: SsoProviderType;
}

export class UpdateSsoProviderDto extends SsoProviderIdDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  name?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(2048)
  oidcIssuer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  oidcClientId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  oidcClientSecret?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(2048)
  samlUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32768)
  samlCertificate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  ldapUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  ldapBindDn?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  ldapBindPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  ldapBaseDn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  ldapUserSearchFilter?: string;

  @IsOptional()
  @IsObject()
  ldapUserAttributes?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  ldapTlsEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32768)
  ldapTlsCaCert?: string;

  @IsOptional()
  @IsBoolean()
  allowSignup?: boolean;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  groupSync?: boolean;
}

export class SsoGroupMappingIdDto {
  @IsUUID()
  mappingId: string;
}

export class CreateSsoGroupMappingDto extends SsoProviderIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  externalGroupId: string;

  @IsUUID()
  groupId: string;
}

export class UpdateSsoGroupMappingDto extends SsoGroupMappingIdDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  externalGroupId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;
}

export class LdapLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  spaceSlug?: string;
}

export class SsoLoginContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  spaceSlug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  returnTo?: string;
}

export class LdapStepUpDto extends LdapLoginDto {}
