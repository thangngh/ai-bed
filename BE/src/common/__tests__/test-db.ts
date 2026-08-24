import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Tenant } from '../../modules/tenant/entities/tenant.entity';
import { ChildProfile } from '../../modules/child/entities/child-profile.entity';
import { Feedback } from '../../modules/feedback/entities/feedback.entity';
import { Story } from '../../modules/story/entities/story.entity';
import { StorySection } from '../../modules/story/entities/story-section.entity';
import { MemoryItem } from '../../modules/memory/entities/memory-item.entity';
import { AdminUser } from '../../modules/admin/entities/admin-user.entity';
import {
  TrafficEvent,
  TrafficHourly,
  LlmUsageEvent,
  LlmUsageHourly,
  IpRule,
  IpState,
  Alert,
  AdminSetting,
} from '../../modules/admin/dashboard/entities';

export function makeDataSource(entities: any[]): DataSource {
  return new DataSource({
    type: 'sqlite' as const,
    database: ':memory:',
    entities,
    synchronize: true,
  });
}

export async function openTestDataSources() {
  // Must mirror the 'core' connection's entity list in app.module.ts exactly,
  // or DashboardModule's repositories cannot resolve once CORE_TOKEN is
  // overridden with this DataSource in integration tests.
  const core = makeDataSource([
    Tenant, ChildProfile, Feedback, AdminUser,
    TrafficEvent, TrafficHourly, LlmUsageEvent, LlmUsageHourly,
    IpRule, IpState, Alert, AdminSetting,
  ]);
  const local = makeDataSource([Story, StorySection, MemoryItem]);
  await core.initialize();
  await local.initialize();
  return { core, local };
}

export async function closeTestDataSources(core: DataSource, local: DataSource) {
  await core.destroy();
  await local.destroy();
}

export const CORE_TOKEN = getDataSourceToken('core');
export const LOCAL_TOKEN = getDataSourceToken('local');
