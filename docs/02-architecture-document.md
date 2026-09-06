# Architecture Document — Bedtime Story Companion

> **Version:** 1.0  
> **Ngày:** 2026-07-27  
> **Status:** Draft — MVP Core

---

## 1. Tổng quan kiến trúc

Hệ thống gồm **3 lớp (layers)** với ranh giới rõ ràng:

```
┌──────────────────────────────┐
│         FE Layer             │  React/NextJS (thin client)
│  Form + Story display + UI   │
├──────────────────────────────┤
│         BE Layer             │  NestJS (BFF + orchestration)
│  Validation + routing +      │
│  tenant isolation            │
├──────────────────────────────┤
│       Engine Layer           │  Python FastAPI / Mastra
│  LLM pipeline + prompts +    │
│  memory extraction           │
└──────────────────────────────┘
```

## 2. Nguyên tắc kiến trúc

1. **Tách trách nhiệm tuyệt đối** — FE không biết business logic, Engine không biết routing
2. **Pipeline có kỷ luật** — mỗi stage một việc, không làm hộ stage khác
3. **Fail fast** — validation tầng nào fail tầng đó, không chờ đến cuối
4. **Stateless BE** — NestJS không giữ state LLM, chỉ điều phối
5. **Tenant-first** — mọi request, DB, log đều gắn tenant_id
6. **Output contract** — mọi output từ LLM phải parse được theo schema

## 3. Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (Browser)                      │
│  ┌─────────────────────┐   ┌────────────────────────────┐   │
│  │   Story Form        │   │   Story Reader UI          │   │
│  │   (validation sơ bộ)│   │   (render + feedback)      │   │
│  └────────┬────────────┘   └─────────────┬──────────────┘   │
└───────────┼──────────────────────────────┼──────────────────┘
            │ HTTP (REST)                  │
            │ tenant-id header              │
            ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     NestJS BE Server                        │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌────────┐  │
│  │ Controller│→│ Service  │→│ Engine      │→│ DB     │  │
│  │ (route)   │  │ (logic)  │  │ Gateway     │  │Postgres│  │
│  └──────────┘  └──────────┘  └─────┬───────┘  └────────┘  │
│  ┌──────────┐  ┌──────────┐        │                        │
│  │ Validation│  │ Middleware│       │                        │
│  │ (class-   │  │ (tenant, │       │                        │
│  │  validator)│  │  rate-limit)     │                        │
│  └──────────┘  └──────────┘        │                        │
└────────────────────────────────────┼────────────────────────┘
                                     │ HTTP / gRPC
                                     ▼
┌─────────────────────────────────────────────────────────────┐
│               Engine Layer (Python/Mastra)                  │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ Planner  │→│  Writer  │→│ Reviewer │→│ Memory Ext │ │
│  │ Stage    │  │  Stage   │  │  Stage   │  │  Stage     │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Prompt Templates (system / dev / user)              │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Output Validator (schema check + safety filter)     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 4. Data Flow (Story Creation)

```
FE                    BE (NestJS)                    Engine (Python)              LLM
│                       │                               │                         │
│ POST /story/create    │                               │                         │
│──────────────────────→│                               │                         │
│                       │                               │                         │
│                       │ Validate input                │                         │
│                       │ · schema check                │                         │
│                       │ · safety check                │                         │
│                       │ · tenant check                │                         │
│                       │                               │                         │
│                       │ GET tenant context            │                         │
│                       │──────────────────────────────→│                         │
│                       │←── tenant + memory ───────────│                         │
│                       │                               │                         │
│                       │ POST /engine/generate          │                         │
│                       │──────────────────────────────→│                         │
│                       │                               │                         │
│                       │                               │ POST chat completion     │
│                       │                               │─────────────────────────→│
│                       │                               │←── outline ─────────────│ (Planner)
│                       │                               │                         │
│                       │                               │ POST chat completion     │
│                       │                               │─────────────────────────→│
│                       │                               │←── story ───────────────│ (Writer)
│                       │                               │                         │
│                       │                               │ POST chat completion     │
│                       │                               │─────────────────────────→│
│                       │                               │←── review ──────────────│ (Reviewer)
│                       │                               │                         │
│                       │                               │→ Validate output schema │
│                       │                               │→ Extract memory          │
│                       │                               │                         │
│                       │←── story response ────────────│                         │
│                       │                               │                         │
│                       │ Save story + memory            │                         │
│                       │                                                                    
│←── story JSON ────────│                               │                         │
│                       │                               │                         │
```

## 5. Pipeline Stage Decomposition

| Stage | Owner | Input | Output | Fail behavior |
|---|---|---|---|---|
| Input Normalization | NestJS | Raw FE request | Normalized DTO | 400 Bad Request |
| Rule Check | NestJS | Normalized DTO | Validated context | 422 Unprocessable |
| Prompt Assembly | Engine | Context + Memory | 3 prompt tầng | Internal error |
| Planner | Engine → LLM | Prompts | Story outline và cấu trúc | Retry 2x |
| Writer | Engine → LLM | Outline | Story content | Retry 2x |
| Reviewer | Engine → LLM | Story | Review verdict | Retry 1x |
| Post-processing | Engine | Story + Review | Final story + memory | Fallback response |

## 6. Multi-tenant Architecture

### Tenant Identity Flow — No Login

```
App khởi chạy lần đầu
  │
  ├─ Kiểm tra local storage có tenant-id?
  │    ├─ Có → reuse
  │    └─ Không → generate UUID v4 → lưu local storage / cookie
  │
  ▼
Mọi request gửi header X-Tenant-Id
BE dùng tenant-id để filter/scoped data
Không cần login. Không OAuth. Không auth middleware.
```

**Tenant = device UUID tự sinh. Zero friction. MVP chỉ có vậy.**

### DB — Một database Postgres trên CÙNG HOST

```
┌─────────────────────────────────────────────────────────┐
│              NESTJS SERVER (single host)                 │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Postgres 16 — một datasource `core`            │   │
│  │                                                 │   │
│  │  ├── tenants, child_profiles, feedbacks,        │   │
│  │  │   admin_users, tenant_sessions               │   │
│  │  ├── stories, story_sections, memory_items      │   │
│  │  └── traffic_event, llm_usage_event, ip_rules,  │   │
│  │      ip_states, alerts, admin_settings, và      │   │
│  │      2 bảng hourly rollup                        │   │
│  │                                                 │   │
│  │  → Schema owned bởi 5 TypeORM migrations         │   │
│  │  → Chỉ BE services đọc/ghi qua TypeORM           │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Container Postgres riêng (docker compose), không       │
│  sync cloud. Tenant vẫn là device UUID, không cần        │
│  login — Google sign-in cho phụ huynh (`tenant_sessions`, │
│  §3.5 của docs/04) là một cơ chế auth riêng, tách biệt.  │
└─────────────────────────────────────────────────────────┘
```

**Lịch sử:** bản MVP (2026-07) chạy 2 file SQLite riêng, `core.db` (private
schema, giấu thiết kế business) và `local.db` (public schema, sẵn sàng
expose). Đây chỉ là namespacing schema trên cùng một ổ đĩa/BE, **không phải**
client-side hay browser storage — `local.db` không liên quan đến
`localStorage` mà FE dùng để cache tenant-id ở trình duyệt, hai thứ đó luôn
tách biệt. Từ 2026-09, cả 6 bảng của 2 file cũ (`tenants`, `child_profiles`,
`feedbacks`, `stories`, `story_sections`, `memory_items`) sống chung trong
một schema Postgres duy nhất; sự tách biệt private/public không còn tồn tại
ở tầng DB — xem `docs/04-schema-db-document.md` cho chi tiết bảng và
migration.

### Data Flow

```
Story Create:
  FE POST /story/create (X-Tenant-Id)
  → BE: validate tenant (Postgres)
  → BE: get/create child (Postgres)
  → BE → Engine → LLM Pipeline
  → BE: save story (Postgres)
  → BE: save memory (Postgres)
  → Return story JSON

Story Read:
  FE GET /story/latest (X-Tenant-Id)
  → BE: read stories (Postgres) WHERE tenant_id
  → Return list

Feedback:
  FE POST /story/feedback (X-Tenant-Id)
  → BE: save (Postgres)
  → BE: update memory (Postgres)
  → Return OK
```

## 7. Technology Stack

| Layer | Technology | Lý do |
|---|---|---|
| FE | React / NextJS | Phổ biến, dễ hire |
| BE | NestJS | Opinionated, module hóa, validation built-in |
| Engine | Python (FastAPI) / Mastra | Hệ sinh thái LLM mạnh, async support |
| Database | PostgreSQL 16, một datasource `core` | Schema owned bởi TypeORM migrations, chạy tự động khi boot |
| LLM | OpenAI / Claude compatible API | Abstraction qua Engine |
| Validation | class-validator (NestJS) + Pydantic (Python) | Cả 2 tầng |
| Logging | Structured JSON log | Dễ debug |

## 8. Deployment Architecture (MVP)

```
┌───────────────────────────────────────────────────────────┐
│                    Single Host / Docker                    │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  FE      │→ │  BE      │→ │  Engine  │  │ Postgres │   │
│  │ (NextJS) │  │ (NestJS) │  │ (Python) │  │   16     │   │
│  └──────────┘  └────┬─────┘  └──────────┘  └────▲─────┘   │
│                      └───────────────────────────┘         │
└───────────────────────────────────────────────────────────┘
```

- **Tất cả 1 host** — BE + FE + Engine + Postgres, mỗi service một container
  (docker compose)
- Schema Postgres được tạo tự động khi BE boot (`migrationsRun: true`); dữ
  liệu sống trong Docker volume, không còn thư mục `data/` trên host
- **Không login endpoint cho tenant** — tenant-id từ local storage FE;
  Google sign-in cho phụ huynh (bảng `tenant_sessions`, docs/04 §3.5) là một
  cơ chế auth riêng, tách biệt
- **Không sync cloud** — zero ops cho MVP

## 9. Security Architecture

```
Request
  │
  ├─ Rate Limiter (token bucket)
  │   └─ 10 req/min/tenant (MVP)
  │
  ├─ Input Sanitizer
  │   └─ Strip XSS, SQL injection patterns
  │
  ├─ Safety Checker
  │   └─ Content policy rules
  │
  ▼
Response
  ├─ Output Safety Filter
  └─ Structured error (no stack trace leak)
```

## 10. Cross-cutting Concerns

### Logging Strategy
```
{
  "timestamp": "ISO8601",
  "level": "info|warn|error",
  "tenant_id": "uuid",
  "request_id": "uuid",
  "stage": "planner|writer|reviewer",
  "llm_calls": 2,
  "latency_ms": 1500
}
```

### Error Response Format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Tuổi phải từ 3 đến 6",
    "details": { "field": "age", "value": 10 }
  },
  "request_id": "uuid"
}
```

### Rate Limit Configuration
- **Per tenant:** 10 requests/minute
- **Per endpoint:** 5 requests/minute cho story/create
- **LLM retry:** tối đa 3 lần/request
- **Timeout mỗi LLM call:** 30s
- **Tổng request timeout:** 120s
