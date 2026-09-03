import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './modules/tenant/entities/tenant.entity';
import { ChildProfile } from './modules/child/entities/child-profile.entity';
import { Feedback } from './modules/feedback/entities/feedback.entity';
import { Story } from './modules/story/entities/story.entity';
import { StorySection } from './modules/story/entities/story-section.entity';
import { MemoryItem } from './modules/memory/entities/memory-item.entity';
import { TenantModule } from './modules/tenant/tenant.module';
import { ChildModule } from './modules/child/child.module';
import { StoryModule } from './modules/story/story.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { MemoryModule } from './modules/memory/memory.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { EngineGatewayModule } from './modules/engine-gateway/engine-gateway.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantSession } from './modules/auth/entities/tenant-session.entity';
import { AdminUser } from './modules/admin/entities/admin-user.entity';
import {
  TrafficEvent,
  TrafficHourly,
  LlmUsageEvent,
  LlmUsageHourly,
  IpRule,
  IpState,
  Alert,
  AdminSetting,
} from './modules/admin/dashboard/entities';
import adminConfig from './modules/admin/admin.config';
import parentAuthConfig from './modules/auth/auth.config';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { RateLimiterMiddleware } from './common/middleware/rate-limiter.middleware';
import { HealthController } from './common/health.controller';
import appConfig from './config/app.config';
import memoryConfig from './config/memory.config';
import rateLimitConfig from './config/rate-limit.config';

@Module({
  imports: [
    // `load` was empty, so every `config.get('rateLimit...')` / `('memory...')`
    // silently fell back to the code default and the matching .env entries did
    // nothing. (`engine.*` is registered by EngineGatewayModule.forFeature.)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [appConfig, memoryConfig, rateLimitConfig, adminConfig, parentAuthConfig],
    }),
    TenantModule,
    ChildModule,
    StoryModule,
    FeedbackModule,
    MemoryModule,
    AnalyticsModule,
    EngineGatewayModule,
    AdminModule,
    AuthModule,
    TypeOrmModule.forRootAsync({
      name: 'core',
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        entities: [Tenant, ChildProfile, Feedback, AdminUser, TenantSession,
          TrafficEvent, TrafficHourly, LlmUsageEvent, LlmUsageHourly,
          IpRule, IpState, Alert, AdminSetting],
        synchronize: false,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forRootAsync({
      name: 'local',
      useFactory: (config: ConfigService) => ({
        type: 'sqlite',
        database: config.get('LOCAL_DB_PATH', 'data/local.db'),
        entities: [Story, StorySection, MemoryItem],
        synchronize: config.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware, RateLimiterMiddleware)
      // /admin has no tenant. Without this the middleware would create one
      // anonymous tenant row per admin request.
            // /auth is pre-login: without the exclusion every redirect through the
      // OAuth flow would mint a throwaway anonymous tenant row.
      .exclude('health', 'admin/(.*)', 'auth/(.*)')
      .forRoutes('*');
  }
}
