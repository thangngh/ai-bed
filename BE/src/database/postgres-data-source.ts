import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Tenant } from '../modules/tenant/entities/tenant.entity';
import { ChildProfile } from '../modules/child/entities/child-profile.entity';
import { Feedback } from '../modules/feedback/entities/feedback.entity';
import { AdminUser } from '../modules/admin/entities/admin-user.entity';
import { TenantSession } from '../modules/auth/entities/tenant-session.entity';
import { Story } from '../modules/story/entities/story.entity';
import { StorySection } from '../modules/story/entities/story-section.entity';
import { MemoryItem } from '../modules/memory/entities/memory-item.entity';
import {
  TrafficEvent,
  TrafficHourly,
  LlmUsageEvent,
  LlmUsageHourly,
  IpRule,
  IpState,
  Alert,
  AdminSetting,
} from '../modules/admin/dashboard/entities';

// Entry point for the migration CLI (`migration:run` / `migration:revert` /
// `migration:show` in package.json). The entity list mirrors app.module.ts's
// `core` TypeOrmModule.forRootAsync() registration.
const PostgresDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [
    Tenant, ChildProfile, Feedback, AdminUser, TenantSession,
    TrafficEvent, TrafficHourly, LlmUsageEvent, LlmUsageHourly,
    IpRule, IpState, Alert, AdminSetting,
    Story, StorySection, MemoryItem,
  ],
  migrations: [__dirname + '/migrations/*.ts'],
  synchronize: false,
});

export default PostgresDataSource;
