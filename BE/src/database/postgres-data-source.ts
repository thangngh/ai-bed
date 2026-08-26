import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Tenant } from '../modules/tenant/entities/tenant.entity';
import { ChildProfile } from '../modules/child/entities/child-profile.entity';
import { Feedback } from '../modules/feedback/entities/feedback.entity';
import { AdminUser } from '../modules/admin/entities/admin-user.entity';
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

// Covers all 15 tables (core + dashboard + local) even though, until the
// follow-up plan lands, only the core+dashboard 12 are actually read/written
// via Postgres at runtime — the `local` tables' schema needs to exist ahead
// of their own per-tenant data cutover (spec §4 Phase 0).
export const PostgresDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [
    Tenant, ChildProfile, Feedback, AdminUser,
    TrafficEvent, TrafficHourly, LlmUsageEvent, LlmUsageHourly,
    IpRule, IpState, Alert, AdminSetting,
    Story, StorySection, MemoryItem,
  ],
  migrations: [__dirname + '/migrations/*.ts'],
  synchronize: false,
});

export default PostgresDataSource;
