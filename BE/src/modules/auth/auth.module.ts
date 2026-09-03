import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleOAuthStrategy } from './google-oauth.strategy';
import parentAuthConfig from './auth.config';

@Module({
  imports: [ConfigModule.forFeature(parentAuthConfig)],
  controllers: [AuthController],
  providers: [AuthService, GoogleOAuthStrategy],
  exports: [AuthService],
})
export class AuthModule {}
