# Server Design — NestJS Backend (MVP)

> **Version:** 1.0  
> **Ngày:** 2026-07-27  
> **Framework:** NestJS 11+  
> **Language:** TypeScript (strict mode)

---

## 1. Module Structure

```
src/
├── main.ts
├── app.module.ts
│
├── common/                        # Shared utilities
│   ├── decorators/
│   │   ├── tenant.decorator.ts     # @Tenant() param decorator
│   │   └── public.decorator.ts     # @Public() skip auth
│   ├── guards/
│   │   └── tenant.guard.ts         # Validate + inject tenant
│   ├── interceptors/
│   │   ├── logging.interceptor.ts  # Structured request/response log
│   │   └── tenant.interceptor.ts   # Auto-create tenant if missing
│   ├── filters/
│   │   └── http-exception.filter.ts# Standardized error response
│   ├── middleware/
│   │   ├── rate-limiter.middleware.ts
│   │   └── tenant.middleware.ts
│   ├── pipes/
│   │   └── validation.pipe.ts      # Global validation pipe
│   └── dto/
│       ├── api-response.dto.ts     # Standard response wrapper
│       └── pagination.dto.ts       # Pagination params
│
├── modules/
│   ├── tenant/
│   │   ├── tenant.module.ts
│   │   ├── tenant.service.ts       # CRUD + lazy init
│   │   ├── tenant.controller.ts    # POST /tenant/init
│   │   └── entities/
│   │       └── tenant.entity.ts
│   │
│   ├── child/
│   │   ├── child.module.ts
│   │   ├── child.service.ts        # Profile CRUD + validation
│   │   ├── child.controller.ts     # GET/POST /child-profile
│   │   └── entities/
│   │       └── child-profile.entity.ts
│   │
│   ├── story/
│   │   ├── story.module.ts
│   │   ├── story.service.ts        # Core story orchestration
│   │   ├── story.controller.ts     # POST /story/create, GET /story/latest
│   │   ├── dto/
│   │   │   ├── create-story.dto.ts
│   │   │   └── story-response.dto.ts
│   │   └── entities/
│   │       ├── story.entity.ts
│   │       └── story-section.entity.ts
│   │
│   ├── feedback/
│   │   ├── feedback.module.ts
│   │   ├── feedback.service.ts     # Feedback + memory update
│   │   ├── feedback.controller.ts  # POST /story/feedback
│   │   └── entities/
│   │       └── feedback.entity.ts
│   │
│   ├── memory/
│   │   ├── memory.module.ts
│   │   ├── memory.service.ts       # Memory CRUD + context builder
│   │   ├── memory.controller.ts    # GET /memory
│   │   └── entities/
│   │       └── memory-item.entity.ts
│   │
│   └── engine-gateway/            # Bridge đến Engine Layer
│       ├── engine-gateway.module.ts
│       ├── engine-gateway.service.ts  # HTTP client → Python Engine
│       ├── dto/
│       │   ├── generate-story.dto.ts
│       │   └── engine-response.dto.ts
│       └── engine.config.ts       # Engine URL, timeout, retry
│
├── config/
│   ├── app.config.ts              # App configuration
│   ├── engine.config.ts           # Engine connection config
│   ├── rate-limit.config.ts       # Rate limit settings
│   └── validation.config.ts       # Validation rules
│
└── shared/
    ├── constants/
    │   ├── error-codes.ts
    │   ├── safety-rules.ts
    │   └── story-constraints.ts
    ├── types/
    │   ├── story.types.ts
    │   ├── memory.types.ts
    │   └── engine.types.ts
    └── utils/
        ├── sanitizer.ts           # HTML/input sanitizer
        └── validator.ts           # Custom validators
```

## 2. Dependency Injection Graph

```
AppModule
├── TenantModule
│   └── TenantService ─────────────────────────────┐
├── ChildModule                                     │
│   └── ChildService ───── uses TenantService ──────┤
├── StoryModule                                     │
│   └── StoryService ─── uses ChildService, ────────┤
│                      EngineGatewayService,        │
│                      MemoryService                │
├── FeedbackModule                                  │
│   └── FeedbackService ── uses StoryService, ──────┤
│                         MemoryService             │
├── MemoryModule                                    │
│   └── MemoryService ─── uses TenantService ───────┤
├── EngineGatewayModule ────────────────────────────┘
│   └── EngineGatewayService (standalone HTTP client)
└── CommonModule (global)
    ├── RateLimiterMiddleware
    ├── TenantMiddleware
    ├── LoggingInterceptor
    └── HttpExceptionFilter
```

## 3. API Specifications

### 3.1 POST /story/create

```
Request:
POST /story/create
Content-Type: application/json
X-Tenant-Id: <uuid>          # Required header
X-Request-Id: <uuid>         # Optional, auto-generated

{
  "child_name": "An",
  "age": 4,
  "theme": "công chúa và rồng",
  "goal": "học cách dũng cảm",      # optional
  "mood": "vui vẻ"                   # optional
}

Response (200):
{
  "request_id": "uuid",
  "story_id": "uuid",
  "data": {
    "title": "Công chúa An và chú rồng hiền",
    "sections": [
      { "type": "opening", "text": "...", "order": 0 },
      { "type": "context", "text": "...", "order": 1 },
      {
        "type": "interaction",
        "text": "...",
        "prompt": "Con nghĩ bạn rồng sẽ làm gì?",
        "options": [
          { "label": "Bay đi", "next_index": 3 },
          { "label": "Ở lại", "next_index": 3 }
        ],
        "order": 2
      },
      { "type": "resolution", "text": "...", "order": 3 }
    ],
    "interaction_count": 1,
    "word_count": 350,
    "safety_status": "APPROVED"
  },
  "meta": {
    "latency_ms": 4500,
    "llm_calls": 3
  }
}

Error (422):
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Tuổi không hợp lệ",
    "details": { "field": "age", "value": 2, "rule": "min:3" }
  },
  "request_id": "uuid"
}
```

### 3.2 POST /story/feedback

```
POST /story/feedback
X-Tenant-Id: <uuid>

{
  "story_id": "uuid",
  "child_name": "An",                  # để xác định child
  "listened_complete": true,
  "wants_more": false,
  "suitable": true,
  "rating": 4,
  "note": "Bé rất thích!"             # optional
}

Response (200):
{
  "feedback_id": "uuid",
  "message": "Cảm ơn phản hồi của bạn!"
}
```

### 3.3 GET /story/latest

```
GET /story/latest?child_name=An&limit=5
X-Tenant-Id: <uuid>

Response (200):
{
  "stories": [
    {
      "story_id": "uuid",
      "title": "Công chúa An dũng cảm",
      "theme": "...",
      "created_at": "ISO8601",
      "rating": 4
    }
  ]
}
```

### 3.4 GET /child-profile

```
GET /child-profile?child_name=An
X-Tenant-Id: <uuid>

Response (200):
{
  "child_id": "uuid",
  "child_name": "An",
  "age": 4,
  "interests": ["công chúa", "khủng long"],
  "preferred_characters": ["Elsa"],
  "bedtime_goal": "dũng cảm",
  "story_count": 12
}
```

### 3.5 POST /child-profile

```
POST /child-profile
X-Tenant-Id: <uuid>

{
  "child_name": "An",
  "age": 4,
  "interests": ["công chúa", "khủng long"],
  "preferred_characters": ["Elsa"],
  "bedtime_goal": "học cách dũng cảm"
}
```

### 3.6 GET /memory

```
GET /memory?child_name=An&type=interest,character
X-Tenant-Id: <uuid>

Response (200):
{
  "memories": [
    { "type": "interest", "key": "favorite_theme", "value": "công chúa", "confidence": 0.9 }
  ]
}
```

### 3.7 POST /tenant/init

```
POST /tenant/init

Response (200):
{
  "tenant_id": "uuid",
  "message": "Tenant initialized"
}
// Cũng set cookie tenant-id
```

---

## 4. Service Layer Detail

### 4.1 StoryService — Core Orchestration

```typescript
@Injectable()
export class StoryService {
  constructor(
    private readonly engineGateway: EngineGatewayService,
    private readonly childService: ChildService,
    private readonly memoryService: MemoryService,
    private readonly tenantService: TenantService,
    private readonly prisma: PrismaService,
  ) {}

  async createStory(dto: CreateStoryDto, tenantId: string): Promise<StoryResponse> {
    // 1. Validate input (class-validator decorators handle basic)
    // 2. Get/Create child profile
    const child = await this.childService.getOrCreate(tenantId, dto.childName, dto.age);

    // 3. Build context
    const memories = await this.memoryService.getRelevant(tenantId, child.childId);
    const recentStories = await this.getRecentStories(tenantId, child.childId, 2);

    // 4. Call Engine
    const engineResult = await this.engineGateway.generate({
      childName: child.childName,
      age: child.age,
      theme: dto.theme,
      goal: dto.goal,
      mood: dto.mood,
      memories,
      recentStories,
      tenantId,
    });

    // 5. Save story + memories
    const story = await this.prisma.story.create({
      data: {
        tenantId,
        childId: child.childId,
        title: engineResult.title,
        content: JSON.stringify(engineResult.content),
        structureJson: JSON.stringify(engineResult.structure),
        theme: dto.theme,
        goal: dto.goal,
        mood: dto.mood,
        safetyStatus: engineResult.safetyStatus,
        llmCalls: engineResult.llmCalls,
        retryCount: engineResult.retryCount,
        totalLatencyMs: engineResult.latencyMs,
        wordCount: engineResult.wordCount,
        isFallback: engineResult.isFallback,
      },
    });

    // 6. Save extracted memories
    if (engineResult.memories?.length) {
      await this.memoryService.bulkCreate(tenantId, child.childId, engineResult.memories, story.storyId);
    }

    // 7. Return
    return StoryResponse.from(story, engineResult);
  }
}
```

### 4.2 EngineGatewayService — Bridge to Engine

```typescript
@Injectable()
export class EngineGatewayService {
  private readonly httpService: HttpService;
  private readonly config: EngineConfig;

  constructor(httpService: HttpService, config: EngineConfig) {
    this.httpService = httpService;
    this.config = config;
  }

  async generate(dto: GenerateDto): Promise<EngineResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<EngineResponse>(
          `${this.config.baseUrl}/generate`,
          dto,
          {
            signal: controller.signal,
            headers: { 'X-Tenant-Id': dto.tenantId },
          }
        ).pipe(
          retry({
            count: this.config.retryCount,
            delay: this.config.retryDelayMs,
          })
        )
      );
      return data;
    } catch (err) {
      if (err instanceof TimeoutError) {
        throw new EngineTimeoutException();
      }
      throw new EngineErrorException(err.message);
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

### 4.3 MemoryService — Context Builder

```typescript
@Injectable()
export class MemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getRelevant(tenantId: string, childId: string): Promise<MemoryContext[]> {
    // Tier 1-4 priority loading with token budget
    const memories = await this.prisma.memoryItem.findMany({
      where: {
        tenantId,
        childId,
        isActive: true,
        createdAt: { gte: thirtyDaysAgo() },
      },
      orderBy: { confidence: 'desc' },
      take: 10,
    });

    // Token budget: max 200 tokens (~800 chars Vietnamese)
    let tokens = 0;
    const MAX_TOKENS = 200;
    const result: MemoryContext[] = [];

    for (const mem of memories) {
      const cost = Math.ceil(mem.memoryValue.length / 4);
      if (tokens + cost > MAX_TOKENS) break;
      result.push({
        type: mem.memoryType,
        key: mem.memoryKey,
        value: mem.memoryValue,
        confidence: mem.confidence,
      });
      tokens += cost;
    }

    return result;
  }
}
```

---

## 5. Middleware & Guards

### 5.1 Tenant Middleware

```typescript
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    let tenantId = req.headers['x-tenant-id'] as string;

    if (!tenantId) {
      tenantId = await this.tenantService.create(); // lazy init
      res.setHeader('X-Tenant-Id', tenantId);
    } else if (!isValidUUID(tenantId)) {
      throw new BadRequestException('INVALID_TENANT');
    }

    req['tenantId'] = tenantId;
    next();
  }
}
```

### 5.2 Rate Limiter Middleware

```typescript
@Injectable()
export class RateLimiterMiddleware implements NestMiddleware {
  private buckets = new Map<string, TokenBucket>();

  constructor(private readonly config: RateLimitConfig) {}

  use(req: Request, res: Response, next: NextFunction) {
    const tenantId = req['tenantId'];
    if (!tenantId) return next();

    let bucket = this.buckets.get(tenantId);
    if (!bucket) {
      bucket = new TokenBucket(
        this.config.capacity,    // 10
        this.config.refillRate,  // 1 token / 6s
      );
      this.buckets.set(tenantId, bucket);
    }

    if (!bucket.consume(1)) {
      res.setHeader('Retry-After', bucket.getWaitTime());
      throw new HttpException({
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Quá nhiều yêu cầu' }
      }, 429);
    }

    next();
  }
}
```

### 5.3 Tenant Guard

```typescript
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (!request.tenantId) {
      throw new UnauthorizedException('TENANT_REQUIRED');
    }
    return true;
  }
}
```

---

## 6. DTO Validation (class-validator)

```typescript
// create-story.dto.ts
export class CreateStoryDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  @Transform(({ value }) => value.trim())
  child_name!: string;

  @IsInt()
  @Min(3)
  @Max(6)
  age!: number;

  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  @Transform(({ value }) => value.trim().toLowerCase())
  theme!: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  goal?: string;

  // Implemented as a case-insensitive @IsIn over ALLOWED_MOODS: the SPA sends
  // the capitalised label its form shows ("Vui vẻ", "Hiếu động", ...), which an
  // exact-match enum 422'd. See create-story.dto.ts for the current list.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsIn(ALLOWED_MOODS)
  mood?: string;

  @IsOptional()
  @IsString()
  language?: string;
}
```

---

## 7. Error Filter

```typescript
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = 500;
    let body: ErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Đã có lỗi xảy ra',
      },
      request_id: request['requestId'] || uuid(),
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      body.error = typeof res === 'string'
        ? { code: 'HTTP_ERROR', message: res }
        : res as any;
    }

    // Never leak stack traces
    response.status(status).json(body);
  }
}
```

---

## 8. Configuration

```typescript
// app.config.ts
export default registerAs('app', () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
}));

// engine.config.ts
export default registerAs('engine', () => ({
  baseUrl: process.env.ENGINE_URL || 'http://localhost:8000',
  timeoutMs: parseInt(process.env.ENGINE_TIMEOUT, 10) || 60000,
  retryCount: parseInt(process.env.ENGINE_RETRY, 10) || 2,
  retryDelayMs: 1000,
}));

// rate-limit.config.ts
export default registerAs('rateLimit', () => ({
  capacity: parseInt(process.env.RATE_LIMIT_CAPACITY, 10) || 10,
  refillRate: parseInt(process.env.RATE_LIMIT_REFILL, 10) || 6,
}));
```

---

## 9. Engine Communication Contract

### DTOs

```typescript
// generate-story.dto.ts (→ Engine)
export class GenerateDto {
  childName!: string;
  age!: number;
  theme!: string;
  goal?: string;
  mood?: string;
  language?: string;
  memories?: MemoryContext[];
  recentStories?: StorySummary[];
  tenantId!: string;
}

// engine-response.dto.ts (← Engine)
export class EngineResponse {
  requestId!: string;
  title!: string;
  content!: StorySection[];
  structure?: StoryStructure;
  safetyStatus!: 'APPROVED' | 'REJECTED' | 'FLAGGED';
  memories?: ExtractedMemory[];
  llmCalls!: number;
  retryCount!: number;
  latencyMs!: number;
  wordCount!: number;
  isFallback!: boolean;
}
```

---

## 10. Logging Strategy

```typescript
// logging.interceptor.ts
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const start = Date.now();
    const logData = {
      request_id: req['requestId'],
      tenant_id: req['tenantId'],
      method: req.method,
      path: req.path,
      stage: 'request',
    };

    this.logger.log(JSON.stringify({ ...logData, event: 'start' }));

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(JSON.stringify({
            ...logData,
            event: 'end',
            latency_ms: Date.now() - start,
            status: context.switchToHttp().getResponse().statusCode,
          }));
        },
        error: (err) => {
          this.logger.error(JSON.stringify({
            ...logData,
            event: 'error',
            latency_ms: Date.now() - start,
            error_code: err?.response?.error?.code || 'UNKNOWN',
          }));
        },
      })
    );
  }
}
```
