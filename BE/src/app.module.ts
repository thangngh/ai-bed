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
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { RateLimiterMiddleware } from './common/middleware/rate-limiter.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env', load: [] }),
    TenantModule,
    ChildModule,
    StoryModule,
    FeedbackModule,
    MemoryModule,
    AnalyticsModule,
    EngineGatewayModule,
    TypeOrmModule.forRootAsync({
      name: 'core',
      useFactory: (config: ConfigService) => ({
        type: 'sqlite',
        database: config.get('CORE_DB_PATH', 'data/core.db'),
        entities: [Tenant, ChildProfile, Feedback],
        synchronize: config.get('NODE_ENV') === 'development',
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
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware, RateLimiterMiddleware)
      .forRoutes('*');
  }
}
