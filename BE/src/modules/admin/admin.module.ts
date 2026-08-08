import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminFeedbackController } from './admin-feedback.controller';
import { AdminFeedbackService } from './admin-feedback.service';
import { AdminGuard } from './auth/admin.guard';
import adminConfig from './admin.config';

@Module({
  imports: [ConfigModule.forFeature(adminConfig)],
  controllers: [AdminAuthController, AdminFeedbackController],
  providers: [AdminAuthService, AdminFeedbackService, AdminGuard],
})
export class AdminModule {}
