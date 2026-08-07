import { IsString, MinLength } from 'class-validator';
import { ArgumentMetadata } from '@nestjs/common';
import { ValidationPipe, isSensitiveField } from '../pipes/validation.pipe';

class SecretDto {
  @IsString()
  @MinLength(12)
  password!: string;
}

class TokenDto {
  @IsString()
  @MinLength(12)
  refreshToken!: string;
}

class PlainDto {
  @IsString()
  @MinLength(3)
  title!: string;
}

const meta = (metatype: any): ArgumentMetadata => ({ type: 'body', metatype, data: undefined });

describe('ValidationPipe redaction', () => {
  const pipe = new ValidationPipe();

  it('omits details.value when the failing field is a password', async () => {
    const err = await pipe.transform({ password: 'short' }, meta(SecretDto)).catch((e) => e);

    expect(err.getStatus()).toBe(422);
    expect(err.getResponse().error.code).toBe('VALIDATION_ERROR');
    expect(err.getResponse().error.details).toEqual({ field: 'password' });
    expect(err.getResponse().error.details).not.toHaveProperty('value');
    // The submitted secret must not appear anywhere in the response body.
    expect(JSON.stringify(err.getResponse())).not.toContain('short');
  });

  it('omits details.value for a token-shaped field name', async () => {
    const err = await pipe.transform({ refreshToken: 'abc' }, meta(TokenDto)).catch((e) => e);
    expect(err.getResponse().error.details).toEqual({ field: 'refreshToken' });
    expect(JSON.stringify(err.getResponse())).not.toContain('abc');
  });

  it('still reports the value for non-sensitive fields', async () => {
    const err = await pipe.transform({ title: 'ab' }, meta(PlainDto)).catch((e) => e);
    expect(err.getResponse().error.details).toEqual({ field: 'title', value: 'ab' });
  });

  it('passes a valid payload straight through', async () => {
    await expect(pipe.transform({ title: 'a valid title' }, meta(PlainDto)))
      .resolves.toMatchObject({ title: 'a valid title' });
  });

  it('treats password, token, secret and authorization as sensitive', () => {
    expect(isSensitiveField('password')).toBe(true);
    expect(isSensitiveField('token')).toBe(true);
    expect(isSensitiveField('secret')).toBe(true);
    expect(isSensitiveField('authorization')).toBe(true);
    expect(isSensitiveField('Password')).toBe(true);
    expect(isSensitiveField('currentPassword')).toBe(true);
    expect(isSensitiveField('apiToken')).toBe(true);
    expect(isSensitiveField('title')).toBe(false);
    expect(isSensitiveField('note')).toBe(false);
  });
});
