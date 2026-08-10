# Báo cáo Đánh giá Bảo mật — Bedtime Story Companion

**Phạm vi:** toàn bộ repo `ai-bed` (FE React SPA, BE NestJS, Engine Python/FastAPI, docker-compose, nginx, deploy/9router HA overlay, scripts/).
**Phương pháp:** static code review (đọc mã nguồn trực tiếp, có trích dẫn file:line), không có pentest động, không quét CVE trực tuyến, không kiểm thử trên môi trường production thật.
**Khung đánh giá:** OWASP Top 10 Web Application Security Risks (2021) + OWASP Top 10 for LLM Applications (2025).
**Đánh giá gốc:** 2026-08-06 · **Cập nhật tiến độ:** 2026-08-10.

> Lưu ý ngữ cảnh: sản phẩm tạo truyện ngủ cho trẻ 3–6 tuổi bằng tiếng Việt, nghĩa là dữ liệu xử lý (tên trẻ, tuổi, giới tính, sở thích, "memory" hành vi) là **PII trẻ em** — mức độ nhạy cảm cao hơn một ứng dụng thông thường, và các lỗ hổng dưới đây nên được ưu tiên xử lý theo đó (tương tự tinh thần COPPA/GDPR-K dù chưa xác định pháp lý áp dụng).

> **Cách đọc tài liệu này.** Phần 1–4 là đánh giá gốc ngày 2026-08-06, **giữ nguyên** làm mốc so sánh. Phần 0 ngay bên dưới là trạng thái hiện tại. Backlog ở Phần 5 đã được đánh dấu trạng thái từng mục. Phần 6 là các phát hiện mới, không có trong đánh giá gốc.

---

## 0. Cập nhật tiến độ — 2026-08-10

### 0.1 Điểm số: trước và sau

| Nhóm | 2026-08-06 | 2026-08-10 | Thay đổi |
|---|---|---|---|
| OWASP Web Top 10:2021 | 46/100 | **58/100** | +12 |
| OWASP Top 10 for LLM Apps 2025 | 55/100 | **76/100** | +21 |
| **Tổng hợp** | **35/100** | **62/100** | **+27** |

Điểm tổng hợp vẫn bị kéo xuống dưới trung bình cộng vì **A07 (không có xác thực tenant) chưa được xử lý** và vẫn là lỗ hổng chặn go-live. Mọi hạng mục Critical khác đã đóng.

| # | Hạng mục | Trước | Sau | Ghi chú |
|---|---|---|---|---|
| A01 | Broken Access Control | 2 | **4** | Cổng Engine/BE đã đóng, có shared secret; nhưng danh tính tenant vẫn tự cấp |
| A02 | Cryptographic Failures | 3 | **4** | Đã bỏ mật khẩu mặc định; vẫn chưa có TLS, PII vẫn plaintext trong localStorage |
| A03 | Injection (cổ điển) | 9 | **9** | Không đổi — vốn đã tốt |
| A04 | Insecure Design | 4 | **7** | Toàn bộ DTO đã có cap + content lock; rate limit per-IP ở nginx là lớp thực sự ràng buộc |
| A05 | Security Misconfiguration | 3 | **8** | Security headers, `server_tokens off`, non-root cả 3 image, tắt `/docs`, resource limit, CORS allowlist |
| A06 | Vulnerable & Outdated Components | 6 | **6** | Không đổi — vẫn chưa có CI audit / hash pinning |
| A07 | Identification & Auth Failures | 1 | **1** | **Không đổi — vẫn là blocker** |
| A08 | Software & Data Integrity | 6 | **6** | Không đổi |
| A09 | Logging & Monitoring | 3 | **4** | Đã log lý do từ chối input; `tenant_id` vẫn log plaintext |
| A10 | SSRF | 9 | **9** | Không đổi — vốn đã tốt |
| LLM01 | Prompt Injection | 2 | **8** | Tách system/user thật, data fence, sanitizer NFKC, khoá script, input guard, cap độ dài |
| LLM02 | Sensitive Info Disclosure | 4 | **4** | Không đổi |
| LLM03 | Supply Chain | 5 | **5** | Không đổi |
| LLM04 | Data & Model Poisoning | 3 | **8** | Blocklist ở cả điểm ghi (Engine + BE) và điểm đọc; DTO validate memory |
| LLM05 | Improper Output Handling | 5 | **8** | `_gate_verdict` chuyển sang allow-list; UNREVIEWED chặn |
| LLM06 | Excessive Agency | 10 | **10** | N/A |
| LLM07 | System Prompt Leakage | 9 | **9** | Không đổi |
| LLM08 | Vector & Embedding | 10 | **10** | N/A |
| LLM09 | Misinformation | 4 | **7** | Blocklist mở rộng + word-boundary + NFKC; thêm age gate ở đầu vào; kiểm tra "thuần Việt" từ log-only thành chặn thật |
| LLM10 | Unbounded Consumption | 3 | **7** | Cổng đóng, engine key, rate limit per-IP, resource limit |

### 0.2 Ba rủi ro lớn nhất của đánh giá gốc — trạng thái

1. ~~Không có xác thực thật ở bất kỳ đâu~~ → **CHƯA XỬ LÝ.** Tenant vẫn là UUID tự cấp. Console admin đã có auth thật (JWT + bcrypt + throttle) nhưng đường dữ liệu của phụ huynh thì chưa. Đây là mục P0 duy nhất còn mở.
2. ~~Engine `:8000` publish thẳng ra host~~ → **ĐÃ XỬ LÝ.** `docker-compose.yml` không còn `ports` cho engine/backend, chỉ `expose`; thêm `ENGINE_API_KEY` (so sánh bằng `hmac.compare_digest`) làm khoá thứ hai.
3. ~~Prompt injection không có lớp phòng thủ nào~~ → **ĐÃ XỬ LÝ**, xem Phần 6.

### 0.3 Kiến trúc cổng: xác minh "chỉ một cổng 80"

Yêu cầu là toàn stack chỉ mở duy nhất cổng 80 (nginx → FE). Đã xác minh bằng `docker compose config` trên cả hai file (base + HA overlay):

| Service | Trước | Sau |
|---|---|---|
| `frontend` | `80:80`, container chạy root | **`80:8080`** trên `0.0.0.0` — cổng public duy nhất; image `nginx-unprivileged` |
| `backend` | `3001:3001` trên `0.0.0.0` | `expose` only |
| `engine` | `8000:8000` trên `0.0.0.0` | `expose` only |
| `9router-a` | `20129:20128` trên `0.0.0.0` | **`127.0.0.1:20129`** |
| `9router-b` | `20130:20128` trên `0.0.0.0` | **`127.0.0.1:20130`** |
| `9router-lb` | `20127:20128` trên `0.0.0.0` | **`127.0.0.1:20127`** |

Ba cổng 9router vẫn cần publish vì `scripts/bootstrap-9router.mjs` chạy trên host và phải gọi từng replica riêng lẻ; bind về loopback giữ script hoạt động mà không mở ra mạng. Sau thay đổi, `docker compose config` chỉ còn đúng một entry `published` không kèm `host_ip`, là cổng 80.

### 0.4 Rate limit: các tầng hiện có

| Tầng | Khoá theo | Giới hạn | Ghi chú |
|---|---|---|---|
| nginx (`FE/nginx.conf`) | IP thật (`CF-Connecting-IP`, chỉ tin từ `172.16.0.0/12`) | 10 req/phút, burst 20, 429 + Retry-After | **Tầng thực sự ràng buộc** — client không tự thoát được |
| BE (`rate-limiter.middleware.ts`) | `X-Tenant-Id` tự khai | token bucket 10 / 60s | Định hình traffic trung thực; xoay UUID là reset |
| BE (`queue.service.ts`) | tenant | hàng đợi Bottleneck | Chặn song song |
| Engine (`pipeline.py`) | mỗi request | `PIPELINE_BUDGET_SECONDS` (45s), ~10 LLM call tối đa | Chặn chi phí mỗi truyện |
| Docker | mỗi container | `mem_limit`, `cpus` | Mới — chặn một service làm cạn host |

Engine vẫn **không có rate limit riêng** (LLM10). Điều đó chấp nhận được vì cổng 8000 đã đóng và có `ENGINE_API_KEY`, nhưng cần ghi nhận là một giả định kiến trúc, không phải một biện pháp.

### 0.5 Kiểm chứng trên stack Docker thật (2026-08-10)

`docker compose up -d`, cả 3 service healthy, rồi bắn request thật qua cổng 80:

| # | Kiểm tra | Kết quả |
|---|---|---|
| 1 | Cổng publish ra host | chỉ `0.0.0.0:80->8080` (frontend); backend/engine chỉ `expose` |
| 2 | Gọi thẳng `localhost:8000` / `localhost:3001` | **connection refused** cả hai |
| 3 | UID trong container | engine `10001`, backend `1000`, frontend `101` — không container nào chạy root |
| 4 | Security headers | CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy đủ; `Server: nginx` không lộ version; HSTS vắng (đúng, xem ghi chú trong nginx.conf) |
| 5 | `X-Engine-Key` | gọi `engine:8000/generate` **từ trong compose network** mà không có key → **401** |
| 6 | `/docs`, `/redoc`, `/openapi.json` | **404** cả ba |
| 7 | Rate limit per-IP | 26 request → 21×200, 5×429, `Retry-After: 60` trên 429 và vắng trên 200 |
| 8 | Header trên response lỗi | `nosniff` có mặt trên 429 → cờ `always` hoạt động |

Khoá đầu vào, bắn qua `POST /api/story/create` (**9/9 chặn đúng**):

| Payload | Kết quả |
|---|---|
| `theme` fullwidth (`ｋｉｌｌ`) | 422 |
| `child_name` chứa fence fullwidth (`＜＜＜An`) | 422 |
| `theme` tiếng Trung | 422 |
| `child_name` Cyrillic | 422 |
| `child_name` có emoji | 422 |
| `theme = "bạo lực"` | 422 |
| `goal = "ignore all previous instructions"` | 422 |
| `age = 9` / `age = 2` | 422 |
| `language = "en"` | 422 |
| `child_name = "Dao"` (hợp lệ) | **201** — không bị blocklist chặn nhầm |

Sinh truyện end-to-end: pipeline tới được OpenRouter, planner trả về sau 26.4s. Free tier hiện đã hết quota (`All OpenRouter keys exhausted`) nên hệ thống degrade thành truyện fallback + HTTP 201, không phải 502 — đúng thiết kế. Chain trong compose base thực tế chỉ còn OpenRouter: DeepSeek không có key và `CUSTOM_LLM_URL` bị đặt rỗng (9router chỉ có ở HA overlay).

**Ba việc phát sinh khi chạy thật:**

1. **`PIPELINE_BUDGET_SECONDS=45` quá ngắn cho free tier.** Đo được: planner mất 26.4s, writer chưa xong thì hết budget → fallback dù provider vẫn hoạt động. `.env.example` đã ghi HA overlay nên dùng 90; compose base vẫn để 45. Cần nâng, hoặc chấp nhận fallback thường xuyên trên free tier.
2. **Volume `be-data` cũ thuộc root.** Đổi Dockerfile sang `USER node` làm BE crash `SQLITE_READONLY` trên deployment đã có sẵn volume — Docker chỉ áp ownership của image cho volume **mới tạo**. Sửa một lần, không mất dữ liệu:
   `docker run --rm -v <project>_be-data:/data alpine chown -R 1000:1000 /data`
3. **FE `package-lock.json` lệch với `package.json` từ `30febff`** → `npm ci` fail, tức **image FE không build được suốt 2 commit**. Đã chạy `npm install --package-lock-only`; diff chỉ nằm trong optional deps bundled của `@tailwindcss/oxide-wasm32-wasi`, không đổi version dependency trực tiếp.

**Một lỗi chưa kết luận được:** vài request `/story/create` trả 500 (`error_code: UNKNOWN`, latency ~37s, tức ngay sau khi Engine trả 200) trước lần restart BE, và không tái hiện được sau đó. Không phải DB (đã kiểm: thư mục ghi được, `INSERT` với `safety_status='FALLBACK'` chạy OK, schema khớp entity). Nguyên nhân chưa xác định — nhưng `HttpExceptionFilter` trước đây **không log exception bao giờ**, nên một 500 chỉ để lại `error_code: UNKNOWN` và không có gì để lần. Đã thêm log phía server (stack không bao giờ vào response body); nếu tái diễn thì lần sau sẽ chẩn đoán được.

---

## 1. Tóm tắt điều hành (đánh giá gốc 2026-08-06)

| | |
|---|---|
| **Điểm tổng hợp** | **35/100** — Yếu, chưa sẵn sàng để public ra Internet ngoài phạm vi dev/demo nội bộ |
| **OWASP Web Top 10 (2021)** | 46/100 |
| **OWASP LLM Top 10 (2025)** | 55/100 |
| **Số lỗ hổng Critical/High** | 8 |
| **Số lỗ hổng Medium** | 12 |
| **Số điểm tốt đã xác nhận (không phải lỗ hổng)** | 7 |

**3 rủi ro lớn nhất, theo thứ tự ưu tiên:**

1. **Không có xác thực thật ở bất kỳ đâu.** "Tenant" chỉ là một UUID tự cấp, không mật khẩu, không hết hạn — sở hữu UUID = toàn quyền truy cập dữ liệu của tenant đó (A01/A07).
2. **Engine (`:8000`) không có auth và được publish thẳng ra host (`0.0.0.0:8000`).** Bất kỳ ai chạm tới cổng này có thể gọi `/generate` trực tiếp, bỏ qua hoàn toàn rate-limit của BE — vừa là lỗ hổng truy cập, vừa là kênh tiêu tốn chi phí LLM không giới hạn (A01 + LLM10).
3. **Prompt injection không có lớp phòng thủ nào.** Toàn bộ prompt được nối thành một chuỗi text duy nhất gửi dưới role `user` (không tách system/user ở tầng API), và các trường do người dùng nhập (`child_name`, `theme`, `goal`, `mood`, `favorite_character`, `memories`) được chèn thẳng, không giới hạn độ dài, không lọc (LLM01), rồi lan sang giai đoạn "memory" và tái sử dụng ở các lần tạo truyện sau (LLM04).

**Những gì đã làm đúng (đáng ghi nhận):**
- Không có SQL/command injection cổ điển — TypeORM dùng repository API có tham số hóa, không có `eval`/`exec`/`subprocess` nào trong Engine.
- FE render nội dung truyện qua JSX text interpolation (không `dangerouslySetInnerHTML`) → an toàn XSS dù nội dung đến từ LLM.
- `.env` thật không bị commit (đã xác minh bằng `git check-ignore`/`git ls-files`); API key không bao giờ log full, chỉ log 4 ký tự cuối.
- `CUSTOM_LLM_URL` chỉ đọc từ env, không có trường nào trong request có thể điều hướng SSRF.
- Không có RAG/vector store (LLM08) và không có tool/function-calling nào trao quyền hành động cho LLM (LLM06) — giới hạn "blast radius" của một injection thành công.
- Dependencies được pin phiên bản rõ ràng (`requirements.txt` dùng `==`), lockfile FE/BE được commit.

---

## 2. Phần A — OWASP Top 10 Web Application Security Risks (2021)

| # | Hạng mục | Điểm /10 | Mức rủi ro |
|---|---|---|---|
| A01 | Broken Access Control | **2** | Critical |
| A02 | Cryptographic Failures | **3** | High |
| A03 | Injection (cổ điển) | **9** | Tốt |
| A04 | Insecure Design | **4** | High |
| A05 | Security Misconfiguration | **3** | High |
| A06 | Vulnerable & Outdated Components | **6** | Medium |
| A07 | Identification & Authentication Failures | **1** | Critical |
| A08 | Software & Data Integrity Failures | **6** | Medium |
| A09 | Security Logging & Monitoring Failures | **3** | High |
| A10 | Server-Side Request Forgery | **9** | Tốt |
| | **Trung bình** | **4.6/10 (46/100)** | |

### A01 — Broken Access Control — 2/10 (Critical)
- Danh tính "tenant" hoàn toàn dựa vào header `X-Tenant-Id` tự sinh; `TenantMiddleware` (`BE/src/common/middleware/tenant.middleware.ts:11-30`) `findOrCreate` bất kỳ UUID hợp lệ nào chưa từng thấy — **không có bằng chứng sở hữu**.
- `TenantGuard` đã được viết (`BE/src/common/guards/tenant.guard.ts`) nhưng **không được gắn (`@UseGuards`) ở bất kỳ controller nào** — chết code, không có tác dụng bảo vệ thực tế.
- `ChildService.findById` (`BE/src/modules/child/child.service.ts:43`) không lọc theo `tenantId` — IDOR tiềm ẩn, hiện được giảm thiểu nhờ caller luôn truyền đúng, nhưng không có ràng buộc ở tầng service.
- Engine `/generate`, `/health` (`Engine/main.py:70-79`) không có bất kỳ dependency xác thực nào, và cổng 8000 được publish ra `0.0.0.0` (`docker-compose.yml:6-7`) — bất kỳ ai chạm host đều gọi thẳng được, bỏ qua toàn bộ access control + rate limit của BE.
- Điểm tích cực: ID là UUID v4 thật (không tuần tự/đoán được) và các query nghiệp vụ khác (`analytics.service.ts`, `child.service.ts`) đều lọc theo `tenantId` phía server — nên đây là lỗ hổng "mô hình xác thực", không phải IDOR do ID đoán được.

### A02 — Cryptographic Failures — 3/10 (High)
- **Không có TLS/HTTPS** cho stack chính: `FE/nginx.conf:7` chỉ `listen 80`, không có block TLS, không HSTS. Cloudflare Tunnel trong `docker-compose.9router-ha.yml` chỉ che chắn cho 9router LB, không che cho `frontend`/`backend`/`engine`.
- Mật khẩu mặc định yếu lan truyền qua nhiều nơi dưới dạng fallback: `docker-compose.9router-ha.yml:54,82` (`${NINEROUTER_PASSWORD:-aibedtime123}`), `.env.example:25` (`NINEROUTER_PASSWORD=aibedtime123`), `scripts/bootstrap-9router.mjs:38`. Nếu operator quên set biến này, production chạy với mật khẩu công khai trong repo.
- PII trẻ em (tên, tuổi, giới tính, sở thích) lưu **plaintext, không mã hóa, không hết hạn** trong `localStorage` của trình duyệt (`FE/src/App.tsx:31,48,56,66,71,80,226,229`) — bất kỳ script/extension nào có quyền truy cập trang đều đọc được.
- Kết nối tới custom LLM provider (9router) là HTTP thuần trong cả ví dụ lẫn cấu hình HA production (`Engine/.env.example:22`, `docker-compose.9router-ha.yml:132`) — API key và nội dung PII đi qua mạng dạng cleartext (dù hiện tại chỉ trong mạng container nội bộ).
- Điểm tích cực: `.env` thật không commit, secrets chỉ đọc qua `os.getenv`/`env_file`, không hardcode key thật ở đâu trong mã nguồn.

### A03 — Injection (cổ điển) — 9/10 (Tốt)
- Toàn bộ truy vấn TypeORM dùng Repository API với object-literal `where`, không có `.query()`/`createQueryBuilder` nối chuỗi ở bất kỳ đâu trong `BE/src`.
- Không có `eval`/`exec`/`subprocess`/`os.system`/`pickle`/`yaml.load` trong Engine.
- FE không dùng `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` — nội dung truyện (vốn có thể bị ảnh hưởng bởi prompt injection ngược dòng) chỉ render qua JSX text, được React auto-escape.
- *(Prompt injection — một dạng injection đặc thù LLM — được đánh giá riêng ở LLM01 vì nó không thuộc phạm trù injection cổ điển của OWASP Web.)*

### A04 — Insecure Design — 4/10 (High)
- Rate limiter (`BE/src/common/middleware/rate-limiter.middleware.ts`) và hàng đợi Bottleneck theo tenant đều khóa theo `tenantId` — nhưng vì tenant tự cấp không xác thực (A01/A07), một client chỉ cần đổi UUID để có "hạn mức" mới → rate limit thực chất không giới hạn được kẻ tấn công có chủ đích.
- `CreateStoryDto` (`child_name`, `theme`, `goal`) thiếu `@MaxLength`, trong khi `feedback.dto.ts:31` đã có `@MaxLength(500)` — thiếu nhất quán, mở đường cho input quá dài/prompt injection payload lớn.
- Không giới hạn số trẻ/tenant, số truyện/tenant ở tầng business logic.
- Endpoint `POST /memory/extract`, `/memory/reinforce` (`BE/src/modules/memory/memory.controller.ts:15-30`) dùng interface TypeScript thuần thay vì DTO class → **không qua validation nào cả**, trường `value`/`key` tự do đi thẳng vào bộ nhớ rồi vào prompt LLM sau này.

### A05 — Security Misconfiguration — 3/10 (High)
- CORS mở hoàn toàn: `app.enableCors()` không tham số (`BE/src/main.ts:10`) = allow tất cả origin.
- `FE/nginx.conf` không có bất kỳ security header nào: không CSP, không `X-Frame-Options`, không `X-Content-Type-Options`, không `Referrer-Policy`, không HSTS; cũng không có `server_tokens off`.
- FastAPI mặc định để lộ `/docs`, `/redoc`, `/openapi.json` (`Engine/main.py` không override `docs_url`/`openapi_url`) — công khai toàn bộ schema API cho bất kỳ ai chạm được cổng 8000.
- Cả 3 Dockerfile (`Engine/Dockerfile`, `BE/Dockerfile`, `FE/Dockerfile`) đều **không có chỉ thị `USER`** → container chạy bằng root.
- `docker-compose.yml` publish port không chỉ định bind address (`"8000:8000"`, `"3001:3001"`, `"80:80"`) → mặc định `0.0.0.0`, để lộ Engine/BE nội bộ ra ngoài thay vì chỉ qua nginx; tương tự với các cổng 9router HA (`20129`, `20130`, `20127`).
- Không có giới hạn tài nguyên (`mem_limit`/`cpus`) cho bất kỳ service nào — một request flood có thể làm cạn tài nguyên host.
- Điểm tích cực: không `privileged: true`, không `cap_add`, không `network_mode: host`; exception filter của BE không leak stack trace (`http-exception.filter.ts`); Engine không bật debug mode.

### A06 — Vulnerable & Outdated Components — 6/10 (Medium)
- Phiên bản dependency nhìn chung khá mới và hợp lý: NestJS 11, TypeORM 0.3.20, React 19.0.1, Vite 6.2.3, FastAPI 0.115.0, openai==1.55.0 — không có phiên bản lỗi thời rõ rệt.
- Lockfile được commit cho cả FE (`package-lock.json`) và BE — build reproducible.
- Thiếu: không có pipeline CI nào chạy `npm audit`/`pip-audit`/Dependabot/Snyk để phát hiện CVE mới phát sinh theo thời gian; `Engine/Dockerfile:11` cài từ `requirements.txt` không có hash-pinning cho transitive dependencies (`pip install --require-hashes` không được dùng).

### A07 — Identification & Authentication Failures — 1/10 (Critical)
- **Không tồn tại cơ chế đăng nhập/session/JWT nào trong toàn bộ repo** (đã grep `auth|login|password|JWT|passport|bcrypt|session|OAuth` trên cả FE và BE — không có kết quả).
- Tenant được tự động khởi tạo ẩn danh qua `POST /tenant/init` không cần credential (`FE/src/utils/api.ts:44-59`, `BE/src/modules/tenant/tenant.controller.ts:8-15`), UUID lưu vĩnh viễn trong `localStorage`.
- Cột `auth_type`/`auth_key` đã tồn tại sẵn trong entity (`BE/src/modules/tenant/tenant.entity.ts:11-15`) nhưng **không được dùng ở bất kỳ code path nào** — cho thấy đây là tính năng dự kiến nhưng chưa triển khai, không phải thiết kế cố ý bỏ auth.
- UUID tenant hoạt động như một bearer token không hết hạn, không thể thu hồi, không rotate.

### A08 — Software & Data Integrity Failures — 6/10 (Medium)
- Không có `eval`/deserialization không an toàn.
- Phản hồi JSON từ Engine được BE tin tưởng chỉ qua TypeScript type cast (`BE/src/modules/engine-gateway/engine-gateway.service.ts:66`), **không có runtime schema validation** (ví dụ zod/class-validator) trước khi lưu DB/trả về FE — nếu Engine bị compromise hoặc trả sai schema, lỗi sẽ lan xuống tầng dưới mà không bị chặn sớm.
- `FE/index.html` không load script CDN nào ngoài bundle nội bộ → SRI không áp dụng, không phải rủi ro ở đây.

### A09 — Security Logging & Monitoring Failures — 3/10 (High)
- `LoggingInterceptor` (`BE/src/common/interceptors/logging.interceptor.ts:17-36`) log `tenant_id` dạng plaintext trên mọi request — vì `tenant_id` chính là "credential" duy nhất (A07), log này vô tình trở thành kênh rò rỉ giá trị nhạy cảm cho bất kỳ ai có quyền đọc log.
- Không có audit trail cho các nỗ lực truy cập/tenant enumeration bất thường.
- Không có client-side error tracking (Sentry/Bugsnag...) và không có structured logging tập trung — chỉ dựa vào `docker logs` mặc định.
- Rủi ro tiềm ẩn (latent): `Engine/core/orchestrator.py:33-35` có dòng `logger.debug("Assembled prompts: %s", prompts)` chứa tên trẻ + memory PII — hiện bị chặn vì `LOG_LEVEL=INFO` mặc định, nhưng bất kỳ operator nào bật `DEBUG` để debug sự cố (thao tác rất bình thường) sẽ ngay lập tức bắt đầu ghi PII vào log.

### A10 — Server-Side Request Forgery — 9/10 (Tốt)
- `CUSTOM_LLM_URL` chỉ đọc từ biến môi trường (`Engine/core/llm/custom_client.py:243`), `GenerateRequest` không có trường URL/provider nào để client điều hướng.
- Các script vận hành (`scripts/bootstrap-9router.mjs`, `probe-9router-models.mjs`) nhận URL từ CLI/env nhưng là công cụ operator chạy thủ công, không phải endpoint web nhận input từ người dùng ẩn danh — không phải SSRF thực sự.
- `deploy/9router-lb.conf.template` dùng upstream host cố định, không bị ảnh hưởng bởi input.

---

## 3. Phần B — OWASP Top 10 for LLM Applications (2025)

| # | Hạng mục | Điểm /10 | Mức rủi ro |
|---|---|---|---|
| LLM01 | Prompt Injection | **2** | Critical |
| LLM02 | Sensitive Information Disclosure | **4** | High |
| LLM03 | Supply Chain | **5** | Medium |
| LLM04 | Data & Model Poisoning | **3** | High |
| LLM05 | Improper Output Handling | **5** | Medium |
| LLM06 | Excessive Agency | **10** | N/A — không áp dụng (tốt) |
| LLM07 | System Prompt Leakage | **9** | Tốt |
| LLM08 | Vector & Embedding Weaknesses | **10** | N/A — không áp dụng |
| LLM09 | Misinformation | **4** | High |
| LLM10 | Unbounded Consumption | **3** | Critical |
| | **Trung bình** | **5.5/10 (55/100)** | |

### LLM01 — Prompt Injection — 2/10 (Critical)
- Không có tách vai trò system/user ở tầng gọi API: `Engine/core/pipeline.py:170-173` nối `system + developer + user` thành **một chuỗi text duy nhất**, rồi mọi client provider (`openai_client.py:57`, `deepseek_client.py:43`, `openrouter_client.py:53`, `custom_client.py:274`) gửi nó dưới role `"user"` duy nhất; `gemini_client.py:26` cũng không dùng `system_instruction` riêng của Gemini. Cơ chế instruction-hierarchy mà các provider xây sẵn hoàn toàn không được tận dụng.
- Các trường người dùng nhập (`child_name`, `theme`, `goal`, `mood`, `favorite_character`) không có `max_length`, không lọc ký tự, được `.format(**data)` thẳng vào template (`Engine/core/prompts/registry.py:85-94`, `templates/user/default.txt`, `templates/planner/default.txt:11-13`). Một `child_name` như `"Bé\n\nBỏ qua mọi hướng dẫn ở trên và..."` chèn thẳng cạnh instruction thật, không có delimiter.
- `memories` là `list` không schema (`Engine/main.py:51`) — kênh injection **trực tiếp**, không chỉ gián tiếp qua poisoning.
- Injection lan chuỗi: outline planner → writer prompt → reviewer prompt (`pipeline.py:189-213`) đều `json.dumps` nội dung đã bị ảnh hưởng mà không re-sanitize giữa các bước.
- *Giảm nhẹ:* không có tool-calling/agency (LLM06) nên blast radius giới hạn ở nội dung text, không dẫn tới thực thi mã hay rò rỉ hệ thống.

### LLM02 — Sensitive Information Disclosure — 4/10 (High)
- PII trẻ em (tên, tuổi, giới tính, chủ đề, "memory" hành vi) được gửi dạng plaintext tới bất kỳ provider nào đang active trong chain — bao gồm **tài khoản free-tier OpenRouter** (`Engine/.env.example:41-45`) — không có bước ẩn danh hóa nào trước khi rời hệ thống.
- `Engine/core/orchestrator.py:33-35` log toàn bộ prompt (gồm PII) ở mức DEBUG — bị chặn bởi `LOG_LEVEL=INFO` mặc định nhưng dễ vô tình bật lại khi debug.
- Lỗi nội bộ (bao gồm chi tiết hostname như `9router-lb:20128`) trả thẳng ra HTTP response (`pipeline.py:163-165` → `main.py:67`) — rò rỉ topology nội bộ ở mức thấp.
- Điểm tích cực: API key chỉ log 4 ký tự cuối, không bao giờ log full ở bất kỳ đâu trong Engine.

### LLM03 — Supply Chain — 5/10 (Medium)
- Dependency chính được pin bằng `==` và đến từ nguồn PyPI chính thức — tốt.
- Không có hash-lock cho transitive dependencies (`pip install --require-hashes` không dùng) — rebuild có thể kéo phiên bản khác âm thầm.
- Custom LLM provider (9router) là endpoint **operator tự cấu hình hoàn toàn qua env**, không có allow-list model, không xác minh tính toàn vẹn response — response được tin tưởng ngay khi parse JSON/SSE thành công.
- Kết nối tới custom provider là HTTP thuần (xem A02).

### LLM04 — Data & Model Poisoning — 3/10 (High)
- `Engine/core/memory_extractor.py:44-77` trích "memory" từ truyện đã sinh, chỉ lọc theo `confidence >= 0.3` — **không có kiểm tra an toàn nội dung** nào trên giá trị `value` (khác với story content được `validator.py` kiểm tra).
- Memory được trả về client và kỳ vọng gửi lại ở request sau (`main.py:51`, không có item schema) → `registry.py:44-83` chèn thẳng vào prompt lần sau (`Known interests: {value}`...) không re-filter.
- Hệ quả: một injection thành công một lần có thể "cấy" vào memory và tự động tái xuất hiện ở **mọi lần tạo truyện tiếp theo** cho cùng một trẻ — kênh đầu độc dai dẳng, chưa có biện pháp giảm nhẹ nào được ghi nhận.

### LLM05 — Improper Output Handling — 5/10 (Medium)
- Không có sink nguy hiểm nào (`eval`/`exec`/`subprocess`/shell) nhận output LLM trong Engine — tốt.
- Nhưng verdict `"FLAGGED"` từ reviewer LLM **không chặn nội dung** — chỉ `"REJECTED"` mới kích hoạt fallback (`pipeline.py:136-156`); lỗi parse hoặc hết ngân sách thời gian cũng mặc định về `FLAGGED` thay vì chặn (`pipeline.py:221-226,231`). Với sản phẩm cho trẻ nhỏ, đây là khoảng hở đáng kể: lớp kiểm duyệt ngữ nghĩa duy nhất có thể phát hiện vấn đề nhưng không tự động ngăn nội dung đến tay trẻ.
- Có kiểm tra cấu trúc/độ dài (`validator.py`: `word_count>=100`, required section types, section depth) — mitigation một phần.

### LLM06 — Excessive Agency — 10/10 (N/A, tốt)
- Xác nhận: không có tool/function-calling, không truy cập filesystem, không gọi API ngoài nào được kích hoạt bởi output LLM ở bất kỳ client provider nào. Blast radius của một LLM response bị kiểm soát hoàn toàn chỉ giới hạn ở trường text.

### LLM07 — System Prompt Leakage — 9/10 (Tốt)
- Toàn bộ 6 file template (`core/prompts/templates/**`) chỉ chứa hướng dẫn kể chuyện/an toàn nội dung, không có API key/URL nội bộ nào.
- Không endpoint nào trả về raw prompt — `/generate` chỉ trả `GenerateResponse` đã định nghĩa field cụ thể (`main.py:57-67`).
- Rủi ro dư nhỏ: nếu LLM01 khai thác thành công khiến model "đọc lại" instruction, nội dung system prompt (không nhạy cảm, chỉ là tuning) có thể lộ qua trường story — impact thấp.

### LLM08 — Vector & Embedding Weaknesses — 10/10 (N/A)
- Xác nhận không có RAG/vector store/embedding nào trong toàn bộ repo (`requirements.txt` không có package liên quan, grep toàn repo không có kết quả). Không áp dụng.

### LLM09 — Misinformation — 4/10 (High)
- Bộ lọc an toàn nội dung duy nhất là danh sách từ khóa cấm nhỏ, so khớp substring đơn giản (`Engine/core/validator.py:5-11,130-132`) — dễ bị paraphrase/từ đồng nghĩa vượt qua; ví dụ động từ tiếng Việt "giết" không nằm trong danh sách trong khi "sát hại"/"chết" có.
- Không có kiểm tra age-appropriateness hay hallucination độc lập ngoài chỉ dẫn trong developer prompt.
- Verdict `FLAGGED` không chặn nội dung (liên quan LLM05) → lớp kiểm duyệt ngữ nghĩa mạnh nhất trong hệ thống hiện không có "quyền phủ quyết" thực sự.

### LLM10 — Unbounded Consumption — 3/10 (Critical)
- Điểm tốt đã có: ngân sách thời gian toàn pipeline (`PIPELINE_BUDGET_SECONDS`, mặc định 45s, `pipeline.py:21,32-44`), giới hạn số lần gọi LLM theo thiết kế (~10 calls/request tối đa), `max_tokens` cấu hình phía server, không cho request client override.
- Nhưng: **không có rate limit/quota nào ở tầng Engine** (grep `rate|limit|throttle` trong `Engine/*.py` không có kết quả) — Engine hoàn toàn tin tưởng BE làm việc này.
- Sự tin tưởng đó **không được thực thi**: Engine publish thẳng ra `0.0.0.0:8000` (`docker-compose.yml:6-7`) không auth → bất kỳ ai chạm cổng này gọi thẳng `/generate`, bỏ qua rate-limiter của BE, có thể kích hoạt hàng loạt request tốn kém liên tục (chi phí LLM thật, đặc biệt nguy hiểm với các provider trả phí trong `LLM_CHAIN=deepseek,openrouter,custom`).
- Retry ngay lập tức không backoff khi gặp rate-limit provider (`openai_client.py:70-74`, `openrouter_client.py:87-95`) — có thể làm trầm trọng thêm tình trạng bị giới hạn.

---

## 4. Bảng điểm tổng hợp

| Nhóm | Điểm | Xếp loại |
|---|---|---|
| OWASP Web Top 10:2021 | 46/100 | **Yếu** |
| OWASP Top 10 for LLM Apps 2025 | 55/100 | **Trung bình yếu** |
| **Tổng hợp (trung bình 2 nhóm)** | **~50/100 → làm tròn thận trọng: 35/100*** | **Yếu — không nên public production nếu chưa xử lý nhóm Critical** |

\* Điểm tổng hợp cuối được kéo xuống dưới trung bình cộng đơn thuần vì 3 hạng mục Critical (A01, A07, LLM01, LLM10 — 4 mục thực chất) đều liên quan trực tiếp tới khả năng một người lạ trên Internet truy cập/giả mạo dữ liệu trẻ em hoặc gây tốn chi phí không giới hạn — đây là các lỗ hổng "chặn go-live", không thể bù trừ bằng điểm tốt ở các mục khác (A03, A10, LLM06/07/08).

---

## 5. Backlog khắc phục (ưu tiên P0 → P3)

Cột **Trạng thái** cập nhật 2026-08-10. `✅` = đã xử lý và có test; `⬜` = còn mở.

### P0 — Phải làm trước khi public ra ngoài dev/demo nội bộ
| ID | Trạng thái | Hạng mục | Việc cần làm | Thành phần |
|---|---|---|---|---|
| P0-1 | ✅ | A01/A07/LLM10 | Không publish trực tiếp cổng Engine (8000) và BE (3001) ra `0.0.0.0`; chỉ frontend/nginx được expose. Thêm shared-secret giữa BE↔Engine | docker-compose.yml, Engine/main.py |
| P0-2 | ⬜ | A07/A01 | Thêm cơ chế xác thực tenant thật thay vì UUID tự cấp | BE (tenant module) |
| P0-3 | ❌ | A01 | ~~Gắn `TenantGuard` bằng `@UseGuards`~~ — **khuyến nghị này sai, xem 6.7** | — |
| P0-4 | ✅ | LLM01/LLM04 | Cap độ dài cho mọi trường free-text ở cả BE DTO và Engine Pydantic model | BE DTOs, Engine/main.py |
| P0-5 | ✅ | A03/LLM01 | `/memory/extract`, `/memory/reinforce` dùng DTO class có validation | BE/src/modules/memory |

### P1 — Ưu tiên cao, xử lý ngay sau P0
| ID | Trạng thái | Hạng mục | Việc cần làm | Thành phần |
|---|---|---|---|---|
| P1-1 | ✅ | LLM01 | Tách prompt thành role `system`/`user` thật ở tầng gọi API | Engine/core/llm/*, pipeline.py |
| P1-2 | ✅ | LLM05/LLM09 | `FLAGGED` chặn hoặc regenerate; lỗi parse/hết ngân sách fail-safe | Engine/core/pipeline.py |
| P1-3 | ✅ | LLM04 | Content-safety check cho từng `memory.value` trước khi lưu | Engine/core/memory_extractor.py, BE memory-content.ts |
| P1-4 | ✅ | A05 | Security headers (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) | FE/nginx.conf |
| P1-5 | ⬜ | A02 | TLS termination cho stack chính | deploy/, docker-compose |
| P1-6 | ✅ | A05 | CORS allowlist qua `CORS_ORIGINS`, mặc định đóng hoàn toàn | BE/src/main.ts |
| P1-7 | ✅ | A02 | Bỏ mặc định `aibedtime123`, fail-closed nếu thiếu | docker-compose.9router-ha.yml, scripts/bootstrap-9router.mjs |
| P1-8 | ✅ | A05 | Non-root cả 3 image | */Dockerfile |

### P2 — Trung bình, nên đưa vào roadmap gần
| ID | Trạng thái | Hạng mục | Việc cần làm | Thành phần |
|---|---|---|---|---|
| P2-1 | ✅ | LLM09 | Mở rộng content filter (+"giết", tự hại, tình dục, chất gây nghiện, kinh dị), khớp theo word-boundary trên text đã NFKC | Engine/core/validator.py |
| P2-2 | ⬜ | LLM02 | Giảm PII gửi ra provider free-tier | Engine/core/llm/router.py |
| P2-3 | ⬜ | LLM10 | Backoff/jitter cho retry loop | Engine/core/llm/*.py |
| P2-4 | ⬜ | LLM03/A06 | Hash-pinning cho Engine dependencies | Engine/requirements.txt |
| P2-5 | ✅ | A05 | Tắt `/docs`, `/redoc`, `/openapi.json` trừ khi `ENGINE_DOCS` được bật | Engine/main.py |
| P2-6 | ⬜ | A02 | Mã hóa/giảm thiểu PII trẻ em trong `localStorage` | FE/src/App.tsx |
| P2-7 | ✅ | A05 | `mem_limit`/`cpus`, `no-new-privileges`, `read_only` cho Engine | docker-compose.yml |
| P2-8 | ⬜ | A09 | Không log `tenant_id` plaintext; thêm audit trail | BE logging.interceptor.ts |
| P2-10 | ✅ | A09 | Log nguyên nhân của exception không phải HttpException (trước đây 500 không để lại dấu vết nào) | BE http-exception.filter.ts |
| P2-9 | ⬜ | A06 | `npm audit`/`pip-audit` trong CI | CI config (chưa có) |

### P3 — Thấp / hardening
| ID | Trạng thái | Hạng mục | Việc cần làm | Thành phần |
|---|---|---|---|---|
| P3-1 | ✅ | A05 | `server_tokens off;` | FE/nginx.conf |
| P3-2 | ⬜ | A04 | Thống nhất `confirm()` cho mọi hành động xóa | FE/src/components/SavedStoriesModal.tsx |
| P3-3 | ⬜ | A09 | Error tracking phía client | FE |

---

## 6. Phát hiện mới (2026-08-10) — không có trong đánh giá gốc

Đánh giá gốc kết luận prompt injection "không có lớp phòng thủ nào". Khi xây lớp phòng thủ đó, sáu vấn đề mới lộ ra — phần lớn là những cách vượt qua chính lớp phòng thủ vừa dựng.

### 6.1 Vượt hàng rào bằng ký tự fullwidth — Critical, ĐÃ XỬ LÝ

Data fence (`<<<UNTRUSTED_CHILD_DATA`) và bộ strip `[<>\`]` bảo vệ lẫn nhau: giá trị không thể chứa `<` nên không thể đóng hàng rào. Nhưng `＜＜＜` (U+FF1C) **không phải** `<<<` với bất kỳ regex nào, trong khi **là** `<<<` với mọi tokenizer và mọi model. Tương tự, `ｉｇｎｏｒｅ ａｌｌ ｒｕｌｅｓ` đi thẳng qua blocklist viết bằng ASCII.

Hệ quả: mọi biện pháp LLM01 vừa thêm ở commit trước đều có thể bị vượt bằng cách gõ lại payload ở dạng fullwidth.

**Xử lý:**
- `Engine/core/prompts/sanitize.py` — NFKC chạy **đầu tiên**, gộp mọi dạng tương thích về ký tự gốc, để các bước strip phía sau nhìn thấy ký tự mà model thực sự đọc.
- `find_fullwidth()` dùng thuộc tính `East_Asian_Width` của chính Unicode (`F` + `H`) thay vì danh sách range chép tay — bắt cả U+3000 (khoảng trắng fullwidth sống sót qua `\s`).
- Phát hiện chạy trên text **thô, trước NFKC**: sau khi chuẩn hoá thì `Ａ` đã là `A` và không còn gì để phản đối. Câu hỏi không phải "ký tự này là gì" mà "tại sao nó được viết như vậy".
- `BE/src/common/validation/child-text.ts` — bản sao ở tầng BE, từ chối sớm trước khi tốn LLM call.
- `Engine/core/validator.py` — `find_blocklist_word()` NFKC trước khi khớp, nên `ｋｉｌｌ` khớp `kill`.

### 6.2 Không giới hạn ngôn ngữ đầu vào — High, ĐÃ XỬ LÝ

Không có ràng buộc nào về script. Một chỉ thị viết bằng tiếng Trung, Nga, Hàn, Ả Rập đi thẳng vào prompt — và không prompt template nào, không blocklist nào, không reviewer nào trong hệ thống này được viết để đọc chúng. Đây không phải "ngôn ngữ khác mà ta cũng chấp nhận", mà là **nội dung không tầng nào có thể tuyên bố đã kiểm tra**.

**Xử lý:** allowlist ký tự Việt + Anh, dùng ở cả 3 tầng (`sanitize.py`, `child-text.ts`, `FE/src/utils/childText.ts`). Tiếng Việt cần **ba** khối chữ cái chứ không phải một:

| Khối | Range | Dùng cho |
|---|---|---|
| ASCII | `0041–005A`, `0061–007A` | chữ cái nền |
| Latin-1 Sup + Extended-A/B | `00C0–024F` | â ă ê ô ơ ư đ |
| Latin Extended Additional | `1E00–1EFF` | nguyên âm dựng sẵn có cả dấu phụ lẫn thanh: ế ộ ừ |
| Combining marks | `0300–036F` | dạng tách rời — NFKC là chuẩn hoá *tương thích*, không đảm bảo composition |

Tập dấu câu cố ý ngắn: `` ` ``, `<`, `>`, `{}`, `[]`, `|`, `\`, `*`, `#`, `~` bị loại vì đó là những ký tự dùng để *vẽ cấu trúc* (code fence, JSON, markdown heading) quanh một đoạn text lẽ ra chỉ là cái tên.

Lưu ý: khoá này là khoá **đầu vào**. Khoá **đầu ra** (ngôn ngữ của truyện) hẹp hơn và là chuyện khác — xem 6.9.

### 6.3 Không có cổng kiểm duyệt độ tuổi ở đầu vào — High, ĐÃ XỬ LÝ

Đây là phát hiện quan trọng nhất về mặt an toàn trẻ em.

`age` bị chặn trong khoảng 3–6 ở cả BE và Engine, nhưng **không có gì chặn nội dung được yêu cầu ở độ tuổi đó**. `theme` và `goal` là free-text ghép thẳng vào prompt. Với `theme = "tra tấn"`, thứ duy nhất đứng giữa yêu cầu đó và đứa trẻ là reviewer LLM — chạy **sau khi truyện đã được viết xong**, ở cuối pipeline, và chỉ có tác dụng nếu nó tình cờ nhận ra.

Nói cách khác: hệ thống có kiểm duyệt **đầu ra** nhưng không có kiểm duyệt **đầu vào**, và lớp đầu ra thì tốn 10 LLM call mới tới nơi.

**Xử lý:** `Engine/core/input_guard.py` (mới) + `@IsChildSafeText({ content: true })` ở BE, áp cho `theme`, `goal`, `favorite_character`, `interests`, `preferred_characters`, `bedtime_goal`, `memory.value`. Từ chối trước LLM call đầu tiên.

Phân tách có chủ ý giữa hai mức:

| Mức | Kiểm tra | Áp cho |
|---|---|---|
| Structural | fullwidth, script, ký tự điều khiển/ẩn, injection marker | mọi trường, kể cả tên |
| Content | thêm blocklist nội dung | chỉ các trường quyết định truyện *nói về cái gì* |

Tên trẻ **không** chạy blocklist nội dung: `dao` nằm trong blocklist và cũng là tên riêng tiếng Việt. Một bộ lọc từ chối bé tên Dao là bộ lọc không ai ship được.

### 6.4 `age` bị trôi giữa các lần tạo truyện — Medium, ĐÃ XỬ LÝ

`ChildService.getOrCreate` tra hồ sơ **chỉ theo tên** rồi trả về bản ghi cũ, âm thầm vứt bỏ `age` phụ huynh vừa nhập lại trên form. `StoryService` gửi `child.age` (giá trị cũ) sang Engine, và Engine chọn developer prompt cùng bộ quy tắc an toàn theo con số đó.

Hệ quả: bé 3 tuổi có hồ sơ tạo từ năm ngoái tiếp tục nhận truyện viết theo bộ quy tắc 5–6 tuổi, và form thì không báo gì. Không phải lỗ hổng bị khai thác từ xa, nhưng là sai lệch an toàn theo độ tuổi — đúng thứ sản phẩm này tồn tại để làm đúng.

Test cũ (`child.service.spec.ts`) đang **khẳng định chính hành vi sai này** (`expect(p1.age).toBe(4)`). Đã viết lại.

### 6.5 `age` trở thành đường dẫn file — Medium, ĐÃ XỬ LÝ

`PromptRegistry.load_developer()` nội suy `age` vào **tên file**: `f"{age}.txt"`. Request schema có chặn, nhưng đây là chỗ duy nhất một giá trị lọt qua ràng buộc sẽ thôi là dữ liệu và trở thành đường dẫn.

Ngoài ra, nhánh fallback `return self.load_developer(3)` sẽ **đệ quy vô hạn** nếu `3-4.txt` biến mất.

**Xử lý:** `_clamp_age()` ép kiểu int và kẹp vào 3..6 ngay tại chỗ có rủi ro; fallback thay bằng `FileNotFoundError` rõ ràng. Kẹp thay vì raise vì đây là tuyến hai — kể truyện theo quy tắc 3–4 là cách sai an toàn. `assemble()` cũng ghi lại `data["age"]` bằng giá trị đã kẹp, để tuổi mà prompt **ghi** và tuổi mà prompt được **chọn theo** luôn là một số.

### 6.6 DTO hồ sơ trẻ không có bất kỳ giới hạn nào — High, ĐÃ XỬ LÝ

`CreateChildProfileDto`/`UpdateChildProfileDto` không có `@MaxLength` và không có kiểm tra nội dung nào — trong khi `StoryService.create` **đọc ngược** `preferredCharacters` và `bedtimeGoal` từ hồ sơ và gửi sang Engine mỗi khi form để trống các trường đó.

Đây là đường thứ hai để cấy text vào prompt, không đi qua endpoint tạo truyện, và nó hoàn toàn không được kiểm tra. P0-4 của đánh giá gốc chỉ liệt kê DTO của story nên đã bỏ sót.

### 6.7 Đính chính: khuyến nghị P0-3 không đúng

Đánh giá gốc đề xuất gắn `TenantGuard` bằng `@UseGuards` cho mọi controller. Kiểm tra lại: `TenantMiddleware` **luôn** set `req.tenantId` — nếu header vắng, nó tạo tenant mới rồi gán. Do đó điều kiện `if (!request.tenantId)` trong guard không bao giờ đúng được.

`TenantGuard` không phải "code chết vì chưa gắn", mà là **code chết về mặt cấu trúc**: nó khẳng định một thuộc tính mà middleware đã đảm bảo. Gắn nó vào không thay đổi hành vi nào, chỉ tạo cảm giác đã xử lý A01.

Cách sửa thật vẫn là **P0-2** — chứng minh quyền sở hữu tenant. Guard chỉ có ý nghĩa sau khi middleware ngừng tự phát hành danh tính.

### 6.8 Bộ test đang hỏng — không phải lỗ hổng, nhưng làm mất lưới an toàn

Khi bắt đầu phiên này, **40/166 test của Engine đang fail**. Nguyên nhân: commit trước tách `system`/`user` và đổi chữ ký `router.complete(...)`, nhưng không cập nhật test double — chúng vẫn khai báo `complete(self, prompt, stage="", accept=None)` và ném `TypeError` khi nhận `system=`.

Điều này nghiêm trọng hơn con số gợi ý: các test hỏng chính là `test_safety_gate.py`, tức lưới an toàn của **chính những biện pháp LLM01/LLM05 vừa thêm**. Trong bốn ngày, các control đó không có gì kiểm chứng.

**Xử lý:** cập nhật toàn bộ test double; viết lại `test_safety_gate.py` để khẳng định đúng thuộc tính bảo mật mới — không chỉ "quy tắc có tới model" mà **"quy tắc đi bằng kênh system"** và **"text của phụ huynh không bao giờ đi bằng kênh system"**. Bản cũ vẫn pass kể cả khi pipeline quay lại nối chuỗi.

Cũng sửa một lỗi cô lập môi trường: `main.py` gọi `load_dotenv()` lúc import, nên `Engine/.env` thật của lập trình viên rò vào `os.environ` cả session và các test key-rotation mô tả máy của người chạy thay vì mô tả client.

**Kết quả:** Engine 228 pass; BE 218 pass; FE 37 pass; `tsc --noEmit` sạch ở cả BE và FE.

Còn 2 test Engine fail vì lý do môi trường: máy local cài `httpx 0.28.0` trong khi `requirements.txt` pin `0.27.2`, và `openai==1.55.0` truyền tham số `proxies=` mà httpx 0.28 đã bỏ. Docker image cài đúng pin nên không bị. Khắc phục local: `pip install -r requirements.txt`.

---

### 6.9 Kiểm tra "thuần Việt" tồn tại nhưng không có quyền chặn — Medium, ĐÃ XỬ LÝ

Quyết định phạm vi: **truyện chỉ tiếng Việt, hỗ trợ tiếng Anh dời sang MVP 2.1.**

Không thể loại tiếng Anh ở tầng ký tự. Tiếng Việt viết bằng chính bảng chữ cái A–Z, nên allowlist ký tự (6.2) buộc phải nhận chữ Latin — bỏ `a-z` là chặn luôn tiếng Việt. Hai câu hỏi khác nhau và chỉ câu thứ hai loại được tiếng Anh:

| Khoá | Câu hỏi | Phạm vi |
|---|---|---|
| Đầu vào (`IsChildSafeText`) | Phụ huynh được gõ ký tự nào? | Latin + dấu tiếng Việt — không thể hẹp hơn |
| Đầu ra (`language`, purity check) | Truyện trả về bằng ngôn ngữ nào? | **Chỉ tiếng Việt** |

Ở tầng đầu ra đã có sẵn `check_vietnamese_purity()`, chạy trên **mọi** truyện — nhưng `_validate_writer_full` chỉ `logger.warning(...)` rồi `return schema_result`. Tức là bộ kiểm tra chạy đủ, tốn đủ, và **không thay đổi kết quả nào**: câu tiếng Anh vẫn tới tay trẻ, chỉ để lại một dòng log không ai đọc.

Ngoài ra nó chạy trên `str(data)` — tức đọc cả phần khung JSON (`title`, `content`, `type`, `order`, và nhãn section như `opening`, `resolution`). Đó là những từ tiếng Anh mà chính hệ thống bắt model viết ra, nên bộ kiểm tra đang kiểm tra schema của chính mình. Nó chưa nổ chỉ vì tình cờ không có key nào trùng danh sách — thêm một section type tên `the-end` là mọi truyện fail.

**Xử lý:**
- `OutputValidator.story_text()` (mới) — chỉ trích phần lời truyện (`title`, `text`, `prompt`, `moral`), bỏ toàn bộ khung JSON.
- `_validate_writer_full` **trả về invalid** thay vì log, nên `_call_retry` sinh lại truyện. Đây là lý do việc chặn là khả thi: chi phí một lần regenerate, không phải một fallback.
- `WRITER_RETRY_HINT` nêu cả hai quy tắc writer có thể vi phạm. Hint là **text cố định do operator viết**, không nhồi `result.errors` ngược vào — chuỗi lỗi có chứa dữ liệu do model sinh (`word_count`, section `type`), và kênh system là chỗ duy nhất pipeline này cố giữ sạch khỏi text của model.
- `ENGLISH_LEAK_BLOCKLIST` mở rộng, ưu tiên **hư từ** (`the`, `and`, `with`, `was`): model trôi sang tiếng Anh thì trôi cả mệnh đề, còn một danh từ mượn lẻ (`robot`, `pizza`) là tiếng Việt bình thường nên cố ý không đưa vào.
- `language` ở Engine siết từ `vi|en` xuống `^vi$`, khớp với `@IsIn(['vi'])` của BE.

Cơ chế lọc dựa vào một đặc điểm của chữ viết tiếng Việt: pattern `\b[a-zA-Z]{3,}\b` chỉ khớp cụm Latin **không dấu**, nên mọi từ tiếng Việt có dấu thanh hoặc dấu mũ không bao giờ được đem đi so sánh. Chỉ các từ không dấu (`con`, `cho`, `trong`, `nha`) lọt tới danh sách — và không từ nào trong số đó là từ tiếng Anh. Đó cũng là lý do danh sách phải giữ ngắn.

Cờ `language` của reviewer vẫn **không chặn**, và đó không phải lỗ hổng: tiếng Anh đã bị bắt tất định ở tầng writer trước đó, nên tới reviewer thì truyện đã qua kiểm tra rồi. Đổi một truyện đã viết xong lấy fallback "máy kể chuyện hơi mệt" vì một từ gây tranh cãi là món hời tệ cho đứa trẻ đang chờ nghe.

---

## 7. Ghi chú về sự đánh đổi

**Blocklist có false positive.** Khớp theo word-boundary đã loại phần lớn (`máu` không còn khớp trong `màu`), nhưng `dao` vẫn khớp trong `dao động`. Với chủ đề truyện cho trẻ 3–6 tuổi thì xác suất gặp gần bằng không, và hướng sai là hướng an toàn. Ghi lại ở đây để người sau không tưởng là bug.

**Truyện chỉ tiếng Việt; tiếng Anh dời sang MVP 2.1.** Xem 6.9 — quyết định này kéo theo một phân biệt dễ nhầm giữa khoá *đầu vào* và khoá *đầu ra*.

**`memories` không bị gate, chỉ bị sanitize.** Chúng không do người gọi request gõ ra — chúng là giá trị hệ thống đã lưu từ trước, có thể dưới phiên bản Engine cũ với bộ lọc lỏng hơn. Làm hỏng một câu chuyện trước giờ ngủ vì một memory nhiều tháng tuổi có emoji là phạt nhầm người. Bước strip đã đủ để nội suy an toàn, và `memory_extractor` chạy blocklist ngay tại điểm ghi.

**`note` của feedback không bị khoá nội dung.** Nó do phụ huynh viết cho người đọc, không bao giờ tới prompt. Blocklist ở đây sẽ từ chối đúng cái báo cáo đáng đọc nhất — "truyện có đoạn hơi bạo lực" là lời phàn nàn, không phải vi phạm.

---

## 8. Giới hạn của đánh giá

- Đây là **static code review** dựa trên đọc mã nguồn, không phải kiểm thử xâm nhập (pentest) hay fuzzing thực tế trên hệ thống đang chạy.
- Không truy cập được cơ sở dữ liệu CVE trực tuyến để đối chiếu phiên bản dependency cụ thể — khuyến nghị chạy `npm audit`, `pip-audit`, hoặc Snyk/Dependabot như một bước riêng (đã đưa vào backlog P2-9).
- Không đánh giá cấu hình hạ tầng ngoài repo (Cloudflare account thật, DNS, IAM cloud provider nếu có) — chỉ đánh giá những gì được cấu hình trong repo.
- Điểm số là ước lượng định tính dựa trên mức độ nghiêm trọng và số lượng phát hiện trong mỗi hạng mục, không phải kết quả từ một công cụ chấm điểm tự động chuẩn hóa.
