import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username!: string;

  /**
   * Deliberately no MinLength here. A length rule on the login form only tells
   * an attacker the shape of valid passwords, and the rejected value would ride
   * back in the 422 body if ValidationPipe's redaction ever regressed. Length
   * is enforced where passwords are set: scripts/create-admin.ts.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}
