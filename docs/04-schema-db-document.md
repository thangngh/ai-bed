# Schema / DB Document — Bedtime Story Companion (MVP)

> **Version:** 2.0  
> **Ngày:** 2026-07-27  
> **DB Engine:** SQLite × 2 — Core (server) + Local (device)  
> **ORM:** Prisma (NestJS) dual datasource

---

## 1. DB Split Overview

```
┌──────────────────────────────────────────────────────────┐
│                    CORE DB (private)                      │
│  tenants · child_profiles · feedbacks                    │
│  → Schema ẩn — không expose raw qua API                  │
│  → BE services-only access                               │
├──────────────────────────────────────────────────────────┤
│                    LOCAL DB (user-visible)                │
│  stories · story_sections · memory_items                 │
│  → Schema public — sẵn sàng API GET                     │
│  → Chứa generated content, không lộ thiết kế            │
└──────────────────────────────────────────────────────────┘

Cả 2 DB đều là SQLite file trên cùng host. Không sync cloud.
Không cần login. Tenant-id = device UUID.
```

---

## 2. Core DB (Private Schema)

### Entity Relationship

```
┌──────────┐     ┌──────────────────┐
│  Tenant  │──1:N→│  ChildProfile    │
└──────────┘     └──────────────────┘
      │                  │
      │1:N               │1:N
      ▼                  ▼
┌──────────┐     ┌──────────┐
│ Feedback │     │ Feedback │
└──────────┘     └──────────┘
```

### 2.1 Tenant

```sql
-- core.db: private schema
CREATE TABLE tenants (
    tenant_id   TEXT PRIMARY KEY,      -- UUID v4
    name        TEXT NOT NULL DEFAULT 'anonymous',
    auth_type   TEXT NOT NULL DEFAULT 'local',  -- 'local' | 'google_oauth'
    auth_key    TEXT,                    -- nullable, OAuth mapping
    metadata    TEXT,                    -- JSON, internal only
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tenants_auth_key ON tenants(auth_key);
```

### 2.2 ChildProfile

```sql
-- core.db: private schema
CREATE TABLE child_profiles (
    child_id             TEXT PRIMARY KEY,  -- UUID v4
    tenant_id            TEXT NOT NULL,
    child_name           TEXT NOT NULL,
    age                  INTEGER NOT NULL CHECK(age >= 3 AND age <= 6),
    interests            TEXT,               -- JSON array
    preferred_characters TEXT,               -- JSON array
    bedtime_goal         TEXT,
    language             TEXT NOT NULL DEFAULT 'vi',
    is_active            INTEGER NOT NULL DEFAULT 1,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
    CONSTRAINT unique_child_per_tenant UNIQUE (tenant_id, child_name)
);

CREATE INDEX idx_child_profiles_tenant ON child_profiles(tenant_id);
```

### 2.3 Feedback

```sql
-- core.db: private analytics data
CREATE TABLE feedbacks (
    feedback_id      TEXT PRIMARY KEY,   -- UUID v4
    tenant_id        TEXT NOT NULL,
    story_id         TEXT NOT NULL,      -- ref đến Local DB stories.story_id
    child_id         TEXT,

    listened_complete INTEGER,           -- boolean 0/1
    wants_more       INTEGER,            -- boolean 0/1
    suitable          INTEGER,           -- boolean 0/1
    rating           INTEGER CHECK(rating >= 1 AND rating <= 5),
    note             TEXT,

    created_at       TEXT NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
    FOREIGN KEY (child_id) REFERENCES child_profiles(child_id)
);

CREATE INDEX idx_feedbacks_tenant ON feedbacks(tenant_id);
CREATE INDEX idx_feedbacks_story ON feedbacks(story_id);
```

---

## 3. Local DB (User-visible Schema)

### Entity Relationship

```
┌──────────┐     ┌────────────────┐
│  Story   │──1:N→│  StorySection  │
└──────────┘     └────────────────┘
      │
      │1:N
      ▼
┌────────────┐
│ MemoryItem │
└────────────┘
```

### 3.1 Story

```sql
-- local.db: user-owned content
CREATE TABLE stories (
    story_id       TEXT PRIMARY KEY,    -- UUID v4
    tenant_id      TEXT NOT NULL,       -- ref Core DB tenant
    child_id       TEXT,                -- ref Core DB child_profile
    request_id     TEXT UNIQUE,

    title          TEXT NOT NULL,
    content        TEXT NOT NULL,        -- JSON: array of sections
    structure_json TEXT,                 -- JSON: outline, interaction_points
    theme          TEXT NOT NULL,
    goal           TEXT,
    mood           TEXT,
    language       TEXT NOT NULL DEFAULT 'vi',

    safety_status  TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK(safety_status IN ('PENDING','APPROVED','REJECTED','FLAGGED','FALLBACK')),

    llm_calls      INTEGER NOT NULL DEFAULT 0,
    retry_count    INTEGER NOT NULL DEFAULT 0,
    total_latency_ms INTEGER,

    word_count     INTEGER,
    is_fallback    INTEGER NOT NULL DEFAULT 0,

    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_local_stories_tenant ON stories(tenant_id);
CREATE INDEX idx_local_stories_child ON stories(child_id);
CREATE INDEX idx_local_stories_created ON stories(created_at DESC);
```

### 3.2 StorySection

```sql
-- local.db: story sections
CREATE TABLE story_sections (
    section_id   TEXT PRIMARY KEY,
    story_id     TEXT NOT NULL,
    tenant_id    TEXT NOT NULL,

    section_type TEXT NOT NULL
                    CHECK(section_type IN ('opening','context','conflict','interaction','resolution')),
    content      TEXT NOT NULL,
    order_index  INTEGER NOT NULL,
    interaction_prompt  TEXT,            -- nullable, cho type='interaction'
    interaction_options TEXT,            -- JSON array

    FOREIGN KEY (story_id) REFERENCES stories(story_id)
);

CREATE INDEX idx_local_sections_story ON story_sections(story_id, order_index);
```

### 3.3 MemoryItem

```sql
-- local.db: personalization memory
CREATE TABLE memory_items (
    memory_id    TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    child_id     TEXT,
    story_id     TEXT,

    memory_type  TEXT NOT NULL
                    CHECK(memory_type IN ('child_name','interest','character','theme','behavior','feedback')),
    memory_key   TEXT NOT NULL,
    memory_value TEXT NOT NULL,
    confidence   REAL NOT NULL DEFAULT 0.5 CHECK(confidence >= 0 AND confidence <= 1.0),
    source_text  TEXT,

    is_active    INTEGER NOT NULL DEFAULT 1,
    expires_at   TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (story_id) REFERENCES stories(story_id)
);

CREATE INDEX idx_local_memory_tenant ON memory_items(tenant_id);
CREATE INDEX idx_local_memory_lookup ON memory_items(tenant_id, child_id, memory_type, memory_key);
CREATE INDEX idx_local_memory_active ON memory_items(tenant_id, is_active);
```

---

## 4. Connection Management

```typescript
// NestJS — dual data sources
@Module({
  imports: [
    TypeOrmModule.forRoot({
      name: 'core',              // core.db — private schema
      type: 'sqlite',
      database: 'data/core.db',
      entities: [Tenant, ChildProfile, Feedback],
      synchronize: process.env.NODE_ENV === 'development',
    }),
    TypeOrmModule.forRoot({
      name: 'local',             // local.db — user-visible
      type: 'sqlite',
      database: 'data/local.db',
      entities: [Story, StorySection, MemoryItem],
      synchronize: process.env.NODE_ENV === 'development',
    }),
  ],
})
export class AppModule {}
```

---

## 5. Data Access Patterns

### 5.1 Story Creation (write to Local DB)

```typescript
// BE receives request → Engine generates → save to Local DB
async createStory(dto: CreateStoryDto, tenantId: string) {
  // 1. Validate tenant + child → Core DB
  const child = await this.coreDb.childProfiles.findFirst({
    where: { tenantId, childName: dto.childName }
  });

  // 2. Engine generates story (no DB involved)

  // 3. Save result → Local DB (user-visible)
  const story = await this.localDb.story.create({
    data: {
      tenantId,
      childId: child.childId,
      title: engineResult.title,
      content: JSON.stringify(engineResult.content),
      // ...
    }
  });

  return story;
}
```

### 5.2 Get Latest Stories (read from Local DB)

```typescript
// FE requests stories → BE reads from Local DB
async getLatestStories(tenantId: string, childName?: string) {
  const where: any = { tenantId };
  if (childName) {
    const child = await this.coreDb.childProfiles.findFirst({
      where: { tenantId, childName }
    });
    if (child) where.childId = child.childId;
  }

  return this.localDb.story.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
}
```

### 5.3 Memory Retrieval (read from Local DB)

```typescript
// Read from Local DB — user's personalization data
async getRelevantMemories(tenantId: string, childId: string) {
  return this.localDb.memoryItem.findMany({
    where: {
      tenantId,
      childId,
      isActive: true,
      createdAt: { gte: thirtyDaysAgo() },
    },
    orderBy: { confidence: 'desc' },
    take: 5,
  });
}
```

### 5.4 Submit Feedback (write to Core DB)

```typescript
// Feedback = analytics data → core.db (private schema)
async submitFeedback(dto: FeedbackDto, tenantId: string) {
  // Validate tenant exists → Core DB
  const tenant = await this.coreDb.tenant.findUnique({
    where: { tenantId }
  });
  if (!tenant) throw new NotFoundException('Tenant not found');

  // Save feedback → Core DB
  return this.coreDb.feedback.create({
    data: {
      tenantId,
      storyId: dto.storyId,
      rating: dto.rating,
      // ...
    }
  });
}
```

---

## 6. Indexing Strategy

### Core DB Indexes
| Index | Table | Purpose |
|---|---|---|
| `idx_tenants_auth_key` | tenants | OAuth lookup |
| `idx_child_profiles_tenant` | child_profiles | Find children per tenant |
| `idx_feedbacks_tenant` | feedbacks | Analytics queries |
| `idx_feedbacks_story` | feedbacks | Feedback per story |

### Local DB Indexes
| Index | Table | Purpose |
|---|---|---|
| `idx_local_stories_tenant_created` | stories | Paginate stories |
| `idx_local_memory_lookup` | memory_items | Context building |
| `idx_local_sections_story` | story_sections | Load sections |
| `idx_local_memory_active` | memory_items | Active memory filter |

---

## 7. Security & Privacy

### core.db (Private)
- **Location:** `data/core.db` — cùng host với BE
- **Access:** NestJS services only — không có API GET thẳng entity này
- **Backup:** File copy, periodic
- **Data:** `tenants`, `child_profiles`, `feedbacks` — schema internal, không expose

### local.db (User-visible)
- **Location:** `data/local.db` — cùng host với BE
- **Access:** NestJS services đọc/ghi, API GET /story/latest public
- **Backup:** Tùy chọn (user)
- **Data:** `stories`, `story_sections`, `memory_items` — generated content, có thể public

### Cross-DB References
```
core.db:
  tenants.tenant_id       ←── stories.tenant_id (local.db, logical FK)
  child_profiles.child_id ←── stories.child_id  (local.db, logical FK)
  feedbacks.story_id      ←── stories.story_id  (local.db, logical FK)
  
No hard foreign keys across DB files — use application-level integrity.
```

---

## 8. Prisma Schema (Dual Sources)

### schema.core.prisma
```prisma
generator client {
  provider = "prisma-client-js"
  output   = "./generated/core"
}

datasource db {
  provider = "sqlite"
  url      = env("CORE_DATABASE_URL")  // file:./data/core.db
}

model Tenant { /* ... fields as above ... */ }
model ChildProfile { /* ... fields as above ... */ }
model Feedback { /* ... fields as above ... */ }
```

### schema.local.prisma
```prisma
generator client {
  provider = "prisma-client-js"
  output   = "./generated/local"
}

datasource db {
  provider = "sqlite"
  url      = env("LOCAL_DATABASE_URL")  // file:./data/local.db
}

model Story { /* ... fields as above ... */ }
model StorySection { /* ... fields as above ... */ }
model MemoryItem { /* ... fields as above ... */ }
```

---

## 9. Constraints & Business Rules

| Rule | DB | Implementation |
|---|---|---|
| Age 3-6 | Core | CHECK constraint + validation layer |
| Rating 1-5 | Core | CHECK constraint |
| Unique child name per tenant | Core | UNIQUE(tenant_id, child_name) |
| Memory confidence 0-1 | Local | CHECK constraint |
| Safety status enum | Local | CHECK constraint |
| Section type enum | Local | CHECK constraint |
| No cross-DB cascade | — | Application-level cleanup |
