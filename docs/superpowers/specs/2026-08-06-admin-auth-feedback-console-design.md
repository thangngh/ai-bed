# Admin Auth & Feedback Console — Design

> **Ngày:** 2026-08-06
> **Phạm vi:** bảng `admin_users` + đăng nhập admin + console xem feedback
> **Trạng thái:** đã duyệt, chờ lập plan

---

## 1. Vấn đề

Feedback của phụ huynh đang chảy vào `core.db` mà không có đường nào đọc ra. `POST /story/feedback` chỉ ghi; không có endpoint đọc, không có màn hình xem. Muốn biết người dùng nói gì phải mở file SQLite bằng tay.

Đồng thời hệ thống chưa có khái niệm "người dùng đăng nhập". `TenantMiddleware` sinh tenant ẩn danh từ header `x-tenant-id` — đủ cho phụ huynh, nhưng không dùng được để bảo vệ dữ liệu toàn hệ thống.

Việc cần làm: thêm một loại tài khoản riêng cho quản trị, một trang đăng nhập, và một console chỉ hiển thị danh sách feedback toàn hệ thống.

## 2. Quyết định nền

| Quyết định | Chọn | Lý do |
|---|---|---|
| Tài khoản admin | Bảng `admin_users` riêng trong `core.db` | Kiến trúc tenant hiện tại là tenant ẩn danh theo thiết bị; nhét vai trò admin vào đó sẽ trộn hai khái niệm khác hẳn nhau |
| Tạo tài khoản | Script seed CLI | Không có API tạo user thì không có bề mặt tấn công |
| Duyệt tài khoản | Không có | Chỉ admin được tạo sẵn mới đăng nhập được; không có đăng ký tự do nên không cần duyệt |
| Phiên đăng nhập | JWT HS256 trong `localStorage` | CORS đang mở toàn bộ (`main.ts:10`); cookie sẽ buộc phải siết CORS + chống CSRF + thêm bảng session |
| Thư viện crypto | `node:crypto` (scrypt + HMAC), không thêm dependency | Cả hai thứ cần đều có trong stdlib; BE hiện chỉ có 9 dependency và không có cái nào thừa |
| Vị trí FE | `react-router-dom` trong app hiện tại, chunk admin lazy | Một build, một deploy; `App.tsx` không phải sửa |
| Phạm vi console | Danh sách + lọc + phân trang | Không đánh dấu đã xử lý (khỏi sửa bảng `feedbacks`), không xem chi tiết truyện |

### Rủi ro đã chấp nhận

- **JWT trong `localStorage` đọc được bởi XSS.** Chấp nhận: console chỉ hiển thị, không có thao tác phá hoại; đổi sang cookie httpOnly là việc về sau nếu console có thêm hành động ghi.
- **Crypto tự viết.** Rủi ro thật nằm ở `verify()`; giảm thiểu bằng bảng test bắt buộc ở §7.

## 3. Kiến trúc

Admin là một thế giới tách rời: không tenant, không `x-tenant-id`, không đụng vào luồng phụ huynh. Toàn bộ nằm dưới prefix `/admin`.

```
BE/src/modules/admin/
  entities/admin-user.entity.ts
  auth/password.ts              hash/verify scrypt — hàm thuần, không import NestJS
  auth/jwt.ts                   sign/verify HS256 — hàm thuần, không import NestJS
  auth/admin.guard.ts           đọc Authorization, gắn req.admin
  auth/login-throttle.ts        đếm lần sai theo username
  admin-auth.controller.ts      POST /admin/login
  admin-auth.service.ts
  admin-feedback.controller.ts  GET /admin/feedbacks
  admin-feedback.service.ts
  dto/login.dto.ts
  dto/list-feedback.dto.ts
BE/scripts/create-admin.ts      seed CLI

FE/src/admin/
  AdminApp.tsx                  route con, nạp lazy từ main.tsx
  AdminLoginScreen.tsx
  AdminFeedbackScreen.tsx
  FeedbackFilters.tsx
  FeedbackTable.tsx
  RequireAdmin.tsx
  adminClient.ts
  adminSession.ts
```

`password.ts` và `jwt.ts` không import gì từ NestJS. Đây là phần crypto tự viết, nên nó phải gọi trực tiếp được trong test — không dựng module, không mock.

`FeedbackFilters` và `FeedbackTable` tách khỏi màn hình để test riêng. `App.tsx` đã 400 dòng vì gộp mọi thứ vào một chỗ; không lặp lại.

### Sửa trong code hiện có

1. **`app.module.ts:66`** — `TenantMiddleware` đang `forRoutes('*')`. Không loại trừ thì mỗi request `/admin/*` đẻ một tenant rác vào `core.db`. Đổi thành `.exclude('health', 'admin/(.*)')`.
2. **`app.module.ts:46`** — thêm `AdminUser` vào `entities` của datasource `core`.
3. **`common/pipes/validation.pipe.ts:20`** — bỏ `details.value` khi trường nằm trong danh sách nhạy cảm (`password`, `token`, `secret`, `authorization`). Xem §6.

Hệ quả của (1): `RateLimiterMiddleware` no-op khi không có `tenantId` (`rate-limiter.middleware.ts:25`), nên `/admin` mất rate limit của app. Vì thế `POST /admin/login` có bộ đếm riêng — xem §5.4.

## 4. Data model

Bảng mới trong `core.db`, cạnh `tenants` / `child_profiles` / `feedbacks`. Đây là dữ liệu private, không bao giờ expose qua API.

```sql
CREATE TABLE admin_users (
    admin_id      TEXT PRIMARY KEY,        -- UUID v4
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,           -- "scrypt$N$r$p$<salt_b64url>$<hash_b64url>"
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
);
```

Năm cột. Không `role` (chỉ một loại admin), không `is_active` (xoá bằng CLI), không `display_name` (username đủ hiển thị). `last_login_at` giữ lại vì đó là dấu vết rẻ nhất để phát hiện có người lạ đăng nhập được.

Tham số scrypt nhúng trong chuỗi hash để sau này tăng `N` mà không làm hỏng hash cũ.

### Đọc feedback qua hai DB

`feedbacks` ở `core.db`, `stories` ở `local.db` — SQLite không join qua hai file. `AdminFeedbackService` làm hai bước:

1. Lấy một trang `feedbacks` từ `core.db`, `LEFT JOIN child_profiles` (cùng DB) để có `child_name`.
2. Gom `story_id` của trang đó, một câu `WHERE story_id IN (...)` sang `local.db` để lấy `title`, rồi map vào.

Hai query cho mỗi trang 20 dòng — không N+1.

Không dùng lại `FeedbackService`: nó phụ thuộc `ChildService` + `MemoryService` cho luồng ghi, kéo vào đây là thừa. `AdminFeedbackService` tự mở repository trên entity `Feedback` dùng chung.

## 5. API

**Quy ước response của repo này:** controller trả **object trần**, không bọc `{ data: ... }` — xem `story.controller.ts:30`, `tenant.controller.ts:11`, `analytics.controller.ts`. Interface `SuccessResponse<T>` trong `common/dto/api-response.dto.ts` được khai báo nhưng chưa endpoint nào dùng. Admin theo đúng quy ước đang chạy, không tự dựng envelope mới.

Lỗi thì ngược lại — `HttpExceptionFilter` bọc mọi `HttpException` thành `{ error: { code, message }, request_id }`, và admin dùng nguyên.

### 5.1 `POST /admin/login`

```
Body: { "username": "thang", "password": "..." }

200 { "token": "<jwt>",
      "expires_at": "2026-08-06T20:00:00.000Z",
      "admin": { "admin_id": "...", "username": "thang" } }
401 { "error": { "code": "INVALID_CREDENTIALS", "message": "Sai tài khoản hoặc mật khẩu" } }
429 { "error": { "code": "LOGIN_THROTTLED", "message": "...", "retry_after": 840 } }
```

Sai username và sai mật khẩu trả **cùng một body** — không lộ username nào tồn tại. Khi username không tồn tại, service vẫn chạy một lần `verifyPassword` trên một hằng số hash dựng sẵn (hash của một chuỗi ngẫu nhiên, nhúng trong `password.ts`, cùng tham số scrypt) rồi bỏ kết quả, để thời gian phản hồi không tố cáo điều đó.

Thành công thì cập nhật `last_login_at`.

**Không có `GET /admin/me`.** FE tự đọc `exp` trong token để biết còn hạn; token bị thu hồi hoặc secret bị đổi thì call thật đầu tiên trả 401 và FE đá về login. Thêm một endpoint chỉ để hỏi "tôi còn hợp lệ không" là thừa khi console chỉ có đúng một endpoint dữ liệu.

### 5.2 `GET /admin/feedbacks`

Cần `Authorization: Bearer <token>`.

```
?limit=20&offset=0&rating=5&has_note=1&from=2026-08-01&to=2026-08-06

200 { "items": [...], "total": 137, "limit": 20, "offset": 0 }
401 { "error": { "code": "UNAUTHORIZED", "message": "Phiên không hợp lệ hoặc đã hết hạn" } }
```

Body chính là `PaginatedResponse<T>` (`common/dto/pagination.dto.ts`) — `limit`/`offset`, không phải `page`.

| Tham số | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `limit` | int ≥ 1 | 20 | **kẹp** về 100 nếu lớn hơn, không trả 422 |
| `offset` | int ≥ 0 | 0 | |
| `rating` | int 1–5 | — | lọc bằng đúng giá trị |
| `has_note` | `0` \| `1` | — | `1` = chỉ dòng có `note` khác rỗng; `0` = chỉ dòng không có; vắng mặt = tất cả |
| `from` | `YYYY-MM-DD` | — | `created_at >= '<from> 00:00:00'` |
| `to` | `YYYY-MM-DD` | — | `created_at <= '<to> 23:59:59'` — tính cả ngày đó |

`limit` vượt trần thì **kẹp**, không từ chối: DTO chỉ `@IsInt() @Min(1)`, việc kẹp nằm trong service. Một console lỡ gửi `limit=500` nên nhận 100 dòng, không nên nhận 422.

Sai kiểu (`rating=abc`, `from=hôm qua`) thì `ValidationPipe` trả 422 `VALIDATION_ERROR` như mọi endpoint khác.

Sắp xếp cố định `created_at DESC`. Client không được chọn cột sort — khỏi mở đường SQL injection qua tên cột.

**Múi giờ:** `created_at` do SQLite sinh bằng `datetime('now')`, tức **UTC**, dạng `YYYY-MM-DD HH:MM:SS`. `from`/`to` so sánh thẳng với chuỗi đó, nên chúng cũng là mốc UTC — lọc "ngày 06-08" sẽ lệch 7 giờ so với ngày ở Việt Nam. Chấp nhận ở phiên bản này; đổi sang giờ địa phương là việc riêng, đụng cả cách hiển thị. FE ghi rõ "(UTC)" cạnh ô chọn ngày để người dùng không hiểu nhầm.

`created_at` trả về nguyên văn từ SQLite (`"2026-08-06 14:22:01"`, không phải ISO 8601) — FE phải tự parse, không ném thẳng vào `new Date()` mà không xử lý.

Một dòng:

```json
{
  "feedback_id": "...", "created_at": "2026-08-06 14:22:01",
  "rating": 5, "listened_complete": 1, "wants_more": 1, "suitable": 1,
  "note": "bé đòi nghe lại 2 lần",
  "story_id": "...", "story_title": "Chú thỏ ngủ quên",
  "child_name": "Bống", "tenant_id": "..."
}
```

`story_title` là `null` khi truyện đã bị xoá khỏi `local.db`; `child_name` là `null` khi feedback không gắn bé. Cả hai là trạng thái hợp lệ, không phải lỗi — FE phải hiển thị được.

### 5.3 JWT

Payload `{ sub: admin_id, username, iat, exp }`. TTL 8 giờ (`ADMIN_JWT_TTL_SECONDS`, mặc định `28800`). Ký HS256 bằng `ADMIN_JWT_SECRET`.

**BE từ chối khởi động nếu `ADMIN_JWT_SECRET` trống hoặc ngắn hơn 32 ký tự.** Một secret có giá trị mặc định chính là cách tạo ra token admin giả được. `.env.example` thêm biến này kèm chú thích cách sinh.

`verify()` là chỗ dễ sai nhất:

| Phải chặn | Cách |
|---|---|
| `alg: "none"`, `alg: "RS256"` | so sánh cứng `alg === "HS256"`, khác là loại |
| Chữ ký tính trên JSON re-serialize | HMAC trên đúng chuỗi `header.payload` nhận được, không parse rồi ký lại |
| So sánh chữ ký lộ thời gian | `timingSafeEqual`, kiểm độ dài trước (nó ném lỗi khi lệch độ dài) |
| base64url biến thể | loại token chứa `+`, `/`, `=` |
| Token không hạn | thiếu `exp` là loại, không phải "coi như vĩnh viễn" |
| Token cắt xén | phải đúng 3 đoạn |

### 5.4 scrypt và chống dò mật khẩu

`N=32768, r=8, p=1, keylen=64`, salt 16 byte ngẫu nhiên, dùng `crypto.scrypt` bản async để không chẹn event loop.

Bẫy cụ thể: `N=32768, r=8` cần đúng `128 × N × r = 32MB`, mà `maxmem` mặc định của Node cũng là 32MB — gọi trần sẽ ném `ERR_CRYPTO_INVALID_SCRYPT_PARAM`. Phải truyền `maxmem: 64 * 1024 * 1024`.

Chống dò: bộ đếm in-memory (`Map`, cùng kiểu `RateLimiterMiddleware`) — **10 lần sai trong 15 phút cho mỗi username** → 429, reset khi đăng nhập thành công.

Khoá theo *username* chứ không theo IP vì BE nằm sau Cloudflare Tunnel + nginx: `req.ip` là IP của proxy, mọi request trông như cùng một nguồn. Giới hạn "theo IP" ở đó thực chất là giới hạn toàn cục — một kẻ dò sẽ khoá luôn admin thật. Thêm lớp theo IP đòi cấu hình `trust proxy` và đọc `CF-Connecting-IP`; để ngoài phạm vi.

### 5.5 Seed CLI

```
npm run admin:create -- --username thang
# mật khẩu đọc từ biến môi trường ADMIN_PASSWORD
```

Mật khẩu truyền qua `--password` sẽ nằm lại trong lịch sử shell, nên script chỉ đọc từ `ADMIN_PASSWORD` và báo lỗi nếu trống. Từ chối mật khẩu dưới 12 ký tự.

Script tự chạy `CREATE TABLE IF NOT EXISTS admin_users (...)` trước khi ghi — `synchronize` chỉ bật ở `NODE_ENV=development` (`app.module.ts:47`) nên trên production bảng không tự sinh.

Username đã tồn tại thì script **cập nhật mật khẩu** thay vì báo lỗi, và in ra nó vừa tạo mới hay vừa đặt lại. Quên mật khẩu admin không phải mở SQL sửa tay.

## 6. Frontend

`FE/nginx.conf:42` đã có `try_files $uri $uri/ /index.html`, nên `BrowserRouter` chạy được ở production không cần sửa gì. Vite dev cũng tự fallback.

### 6.1 Routing

Thêm `react-router-dom` — dependency FE duy nhất. `main.tsx` trở thành gốc router; **`App.tsx` không sửa một dòng nào**, nó chỉ trở thành element của route `/`.

```tsx
<BrowserRouter>
  <Routes>
    <Route path="/" element={<App />} />
    <Route path="/admin/*" element={
      <Suspense fallback={<p>Đang tải…</p>}><AdminApp /></Suspense>
    } />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
</BrowserRouter>
```

`AdminApp` nạp bằng `React.lazy` → toàn bộ code admin nằm trong một chunk riêng, phụ huynh không bao giờ tải về. Bên trong: `/admin/login`, `/admin/feedback`, và `/admin` chuyển hướng sang `/admin/feedback`.

### 6.2 `adminClient.ts` — không dùng lại `apiClient`

Điểm dễ sai nhất ở FE. `apiClient` gọi `ensureTenantId()` (`utils/api.ts:75`), mà hàm đó `POST /tenant/init`. Nếu màn admin dùng `apiClient`, mỗi lần mở console sẽ đẻ một tenant rác — đúng thứ vừa chặn ở BE bằng `.exclude()`.

`adminClient` là hàm fetch mỏng riêng: gắn `Authorization: Bearer`, **không** gắn `X-Tenant-Id`, **không** gọi `/tenant/init`. Dùng lại class `ApiError` sẵn có để cách bắt lỗi vẫn đồng nhất với phần còn lại của app.

Gặp 401 → xoá token rồi ném `ApiError('UNAUTHORIZED')`. Chỉ một chỗ xử lý; màn hình bắt được thì `navigate('/admin/login')`.

### 6.3 `adminSession.ts`

`getToken()` đọc `localStorage['bsc_admin_token']`, decode đoạn payload để xem `exp`, trả `null` nếu hết hạn hoặc token méo mó. Decode này **không xác thực chữ ký** — nó chỉ để khỏi bắn một request chắc chắn hỏng. BE mới là nơi quyết định.

`RequireAdmin` bọc route feedback: không có token hợp lệ → `<Navigate to="/admin/login" replace />`.

### 6.4 Màn đăng nhập

Form username + password, `autoComplete="username"` / `"current-password"`, nút khoá khi đang gửi.

| code | hiển thị |
|---|---|
| `INVALID_CREDENTIALS` | Sai tài khoản hoặc mật khẩu |
| `LOGIN_THROTTLED` | Sai quá nhiều lần. Thử lại sau N phút |
| `NETWORK_ERROR`, `TIMEOUT` | Không kết nối được máy chủ |

### 6.5 Màn feedback

Filter (rating: tất cả/1–5; chỉ dòng có ghi chú; từ ngày – đến ngày) đồng bộ vào query string bằng `useSearchParams`. Reload hay bấm Back giữ nguyên bộ lọc, và link gửi cho người khác mở ra đúng cảnh đó — gần như miễn phí một khi đã có router.

Bảng: thời gian · rating · bé · truyện · nghe hết · muốn thêm · ghi chú. `story_title` hoặc `child_name` `null` thì hiện `—`, không phải chữ "null". Bọc `overflow-x-auto` cho màn hình hẹp.

Ô chọn ngày ghi rõ nhãn "(UTC)" — xem ghi chú múi giờ ở §5.2.

Phân trang `limit=20`, nút Trước/Sau + "21–40 / 137". Bốn trạng thái đều phải có: đang tải, rỗng ("Chưa có feedback nào khớp bộ lọc"), lỗi (kèm nút Thử lại), có dữ liệu.

Console dùng giao diện sáng, gọn, **không nhận `isNightMode`**. Đây là công cụ nội bộ, không phải màn hình đọc truyện lúc đi ngủ; theme ấm áp kia làm bảng số liệu khó đọc.

## 7. Xử lý lỗi

### 7.1 Rò mật khẩu qua ValidationPipe — phải vá trước

`common/pipes/validation.pipe.ts:20` trả **giá trị người dùng gửi lên** ngược lại trong `details.value`. Với `POST /admin/login`, chỉ cần một validator trên trường `password` không khớp là mật khẩu vừa nhập bị trả về nguyên văn trong response 422.

Hiện chưa ai gửi mật khẩu lên BE nên nó chưa gây hại; thêm màn login là nó thành hại thật.

Vá: bỏ `details.value` khi tên trường nằm trong danh sách nhạy cảm (`password`, `token`, `secret`, `authorization`). Sửa một lần cho mọi endpoint về sau.

`LoggingInterceptor` đã kiểm — nó không log body, nên chỉ rò qua response.

### 7.2 Quy ước

Chỉ dùng **401**, không dùng 403: chưa có phân quyền, mọi admin ngang nhau. Thiếu token, token hỏng, token hết hạn — cùng một `UNAUTHORIZED`, không nói rõ hỏng ở đâu.

**Suy giảm chứ không sập:** query sang `local.db` lấy tiêu đề truyện lỗi thì danh sách vẫn trả 200 với `story_title: null` và ghi một dòng log. Feedback nằm ở `core.db`; hỏng ở DB phụ không được giết cả trang.

**Lỗi lúc boot:** `ADMIN_JWT_SECRET` thiếu hoặc quá ngắn → BE ném lỗi và dừng; thông báo nói *tên biến* và cách sinh, không in giá trị đang có.

**Log đăng nhập sai:** một dòng `event: 'admin_login_failed'` kèm username và `request_id`, không kèm mật khẩu. Không có dấu vết này thì brute-force diễn ra hoàn toàn im lặng.

## 8. Test

Viết từ trong ra ngoài, mỗi lớp đỏ trước rồi mới xanh: `password` → `jwt` → `guard` → `throttle` → service → controller → FE.

### 8.1 Unit (jest) — hàm thuần, gọi trực tiếp, không dựng module

- **`password.ts`** — hash khác plaintext; verify đúng/sai; hash cùng một mật khẩu hai lần ra hai chuỗi khác nhau (chứng minh salt hoạt động); verify trả `false` chứ không ném lỗi khi chuỗi hash méo mó.
- **`jwt.ts`** — mỗi dòng trong bảng §5.3 là một test: `alg: "none"`, `alg: "RS256"`, sửa payload, sửa chữ ký, thiếu `exp`, `exp` quá khứ, sai số đoạn, base64 thường thay base64url, sai secret. Đây là phần crypto tự viết nên phải được test dày nhất.
- **`login-throttle.ts`** — 10 lần sai thì chặn; đăng nhập đúng thì reset; hết cửa sổ 15 phút thì mở lại (tiêm clock, không `setTimeout` thật).
- **`admin.guard.ts`** — thiếu header, sai scheme, token hợp lệ gắn `req.admin`.

### 8.2 Integration (supertest + SQLite tạm, dùng `common/__tests__/test-db.ts`)

- Login đúng trả token; sai mật khẩu và username không tồn tại trả **response giống hệt nhau**; quá số lần trả 429.
- `/admin/feedbacks` không token → 401; có token → 200.
- Từng bộ lọc (`rating`, `has_note=1`, `has_note=0`, `from`/`to`) thu hẹp đúng tập kết quả; `to` tính cả feedback tạo lúc `23:59:59` ngày đó; `limit=500` trả về 100 dòng chứ không 422.
- Phân trang: `total` không đổi giữa các trang; hai trang liền nhau không trùng dòng.
- `story_title` là `null` khi truyện không còn trong `local.db`, endpoint vẫn trả 200.
- **Hồi quy quan trọng nhất:** đếm số dòng `tenants` trước và sau khi gọi `/admin/feedbacks` — phải bằng nhau. Test này khoá chặt `.exclude()` ở `app.module.ts` không bị ai gỡ về sau.

### 8.3 FE (vitest + testing-library)

- **`adminSession`** — token hết hạn trả `null`; token méo mó trả `null` chứ không ném lỗi làm trắng màn hình.
- **`adminClient`** — có gửi `Authorization`; không gửi `X-Tenant-Id`; không gọi `/tenant/init`. Cặp với test đếm tenant ở BE: hai đầu cùng khoá một cái bẫy.
- **`AdminLoginScreen`** — mỗi mã lỗi hiện đúng câu tiếng Việt; nút khoá khi đang gửi; thành công thì lưu token và điều hướng.
- **`FeedbackTable`** — `story_title`/`child_name` `null` hiện `—`.
- **`RequireAdmin`** — không token thì chuyển hướng về login.

### 8.4 Không test

Class Tailwind cụ thể. Seed CLI chạy đầu-cuối — nó là vỏ mỏng quanh `password.ts` vốn đã được test kỹ; test nó chỉ là test `sqlite3`.

## 9. Biến môi trường mới

| Biến | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|
| `ADMIN_JWT_SECRET` | có | — | ≥ 32 ký tự; thiếu thì BE không khởi động |
| `ADMIN_JWT_TTL_SECONDS` | không | `28800` | 8 giờ |
| `ADMIN_PASSWORD` | chỉ khi chạy seed CLI | — | không commit, không để trong `.env` production |

## 10. Ngoài phạm vi

- Phân quyền / nhiều vai trò admin.
- Đăng ký tài khoản, luồng duyệt, mời qua email.
- API tạo admin và màn quản lý user.
- Đánh dấu feedback đã xử lý, ghi chú nội bộ.
- Xem chi tiết truyện gốc từ dòng feedback.
- Xuất CSV, biểu đồ, số liệu tổng quan.
- Thu hồi token trước hạn (đổi `ADMIN_JWT_SECRET` sẽ vô hiệu toàn bộ token — đó là cách thu hồi duy nhất hiện có).
- Rate limit theo IP thật (cần `trust proxy` + `CF-Connecting-IP`).

### Hạn chế đã biết

`nginx.conf:4` giới hạn `/api/` ở 10 request/phút mỗi IP, burst 20. Người dùng console bấm đổi filter và lật trang liên tục có thể chạm trần và ăn 429 giữa chừng. Burst 20 đủ cho thao tác bình thường. Cách sửa khi cần: thêm `location /api/admin/` với zone riêng, rate cao hơn — việc lúc deploy, không thuộc task này.
