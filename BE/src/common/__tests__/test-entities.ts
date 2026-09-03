import { Tenant } from '../../modules/tenant/entities/tenant.entity';
import { ChildProfile } from '../../modules/child/entities/child-profile.entity';
import { Feedback } from '../../modules/feedback/entities/feedback.entity';
import { Story } from '../../modules/story/entities/story.entity';
import { StorySection } from '../../modules/story/entities/story-section.entity';
import { MemoryItem } from '../../modules/memory/entities/memory-item.entity';
import { AdminUser } from '../../modules/admin/entities/admin-user.entity';
import { TenantSession } from '../../modules/auth/entities/tenant-session.entity';
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

/**
 * Every spec file gets a database cloned from the same fully migrated
 * template, so there is no cost to registering all 16 entities everywhere.
 * Doing so removes a whole class of failures: a partial list breaks
 * TypeORM metadata building the moment one registered entity has a relation
 * to an unregistered one (Story -> StorySection is exactly that case).
 */
export const ALL_TEST_ENTITIES = [
  Tenant, ChildProfile, Feedback, AdminUser, TenantSession,
  TrafficEvent, TrafficHourly, LlmUsageEvent, LlmUsageHourly,
  IpRule, IpState, Alert, AdminSetting,
  Story, StorySection, MemoryItem,
];

/**
 * Lives here rather than in global-setup.ts so that importing it from a spec
 * file does not drag `@testcontainers/postgresql` into every worker.
 */
export const TEMPLATE_DB = 'tpl_ai_bed';
