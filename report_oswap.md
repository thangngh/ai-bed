# Báo cáo Đánh giá Bảo mật — Bedtime Story Companion

**Phạm vi:** toàn bộ repo `ai-bed` (FE React SPA, BE NestJS, Engine Python/FastAPI, docker-compose, nginx, deploy/9router HA overlay, scripts/).
**Phương pháp:** static code review (đọc mã nguồn trực tiếp, có trích dẫn file:line), không có pentest động, không quét CVE trực tuyến, không kiểm thử trên môi trường production thật.
**Khung đánh giá:** OWASP Top 10 Web Application Security Risks (2021) + OWASP Top 10 for LLM Applications (2025).
**Ngày:** 2026-08-06.

> Lưu ý ngữ cảnh: sản phẩm tạo truyện ngủ cho trẻ 3–6 tuổi bằng tiếng Việt, nghĩa là dữ liệu xử lý (tên trẻ, tuổi, giới tính, sở thích, "memory" hành vi) là **PII trẻ em** — mức độ nhạy cảm cao hơn một ứng dụng thông thường, và các lỗ hổng dưới đây nên được ưu tiên xử lý theo đó (tương tự tinh thần COPPA/GDPR-K dù chưa xác định pháp lý áp dụng).

---

## 1. Tóm tắt điều hành

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

### P0 — Phải làm trước khi public ra ngoài dev/demo nội bộ
| ID | Hạng mục | Việc cần làm | Thành phần | Effort |
|---|---|---|---|---|
| P0-1 | A01/A07/LLM10 | Không publish trực tiếp cổng Engine (8000) và BE (3001) ra `0.0.0.0`; chỉ frontend/nginx được expose. Thêm shared-secret/internal-only network giữa BE↔Engine | docker-compose.yml, Engine/main.py | M |
| P0-2 | A07/A01 | Thêm cơ chế xác thực tenant thật (JWT/session có hạn, hoặc tối thiểu API key cấp qua kênh xác thực) thay vì UUID tự cấp không cần chứng minh | BE (tenant module) | L |
| P0-3 | A01 | Gắn `TenantGuard` (đã viết sẵn nhưng chưa dùng) bằng `@UseGuards` cho toàn bộ controller tenant/child/story/feedback/memory | BE/src/modules/**/*.controller.ts | S |
| P0-4 | LLM01/LLM04 | Thêm ràng buộc `@MaxLength`/schema cho `child_name`, `theme`, `goal`, `mood`, `favorite_character` (BE DTO) và `GenerateRequest`/`memories` (Engine Pydantic model) | BE DTOs, Engine/main.py | S |
| P0-5 | A03/LLM01 | Chuyển `/memory/extract`, `/memory/reinforce` sang dùng DTO class có validation thay vì interface thuần (hiện bỏ qua `ValidationPipe` hoàn toàn) | BE/src/modules/memory | S |

### P1 — Ưu tiên cao, xử lý ngay sau P0
| ID | Hạng mục | Việc cần làm | Thành phần | Effort |
|---|---|---|---|---|
| P1-1 | LLM01 | Tách prompt thành role `system`/`developer`/`user` thật ở tầng gọi API (dùng `system_instruction` của Gemini, role `system` của OpenAI-compatible), không nối chuỗi thành một message | Engine/core/llm/*, pipeline.py | M |
| P1-2 | LLM05/LLM09 | Verdict `FLAGGED` phải chặn hoặc buộc regenerate, không tự động trả về người dùng; lỗi parse/hết ngân sách nên fail-safe về fallback thay vì `FLAGGED` mặc định | Engine/core/pipeline.py | S |
| P1-3 | LLM04 | Áp dụng lại content-safety check (blocklist + reviewer) cho từng `memory.value` trước khi lưu/tái sử dụng | Engine/core/memory_extractor.py | S |
| P1-4 | A05 | Thêm security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) vào nginx; thêm HSTS khi có TLS | FE/nginx.conf | S |
| P1-5 | A02 | Thêm TLS termination cho stack chính (không chỉ 9router LB) | deploy/, docker-compose | M |
| P1-6 | A05 | Giới hạn CORS ở BE bằng allowlist origin cụ thể thay vì `enableCors()` mặc định | BE/src/main.ts | S |
| P1-7 | A02 | Bỏ giá trị mặc định `aibedtime123` cho `NINEROUTER_PASSWORD` — bắt buộc set qua env, fail-closed nếu thiếu | docker-compose.9router-ha.yml, scripts/bootstrap-9router.mjs | S |
| P1-8 | A05 | Thêm `USER` non-root vào cả 3 Dockerfile | */Dockerfile | S |

### P2 — Trung bình, nên đưa vào roadmap gần
| ID | Hạng mục | Việc cần làm | Thành phần | Effort |
|---|---|---|---|---|
| P2-1 | LLM09 | Mở rộng/cải thiện content filter (thêm từ khóa tiếng Việt còn thiếu như "giết", cân nhắc semantic classifier thay vì substring match) | Engine/core/validator.py | M |
| P2-2 | LLM02 | Xem xét giảm PII gửi ra provider free-tier, hoặc giới hạn chain provider dùng cho dữ liệu trẻ em chỉ với provider có cam kết xử lý dữ liệu rõ ràng | Engine/core/llm/router.py | M |
| P2-3 | LLM10 | Thêm backoff/jitter cho retry loop khi gặp rate-limit provider | Engine/core/llm/openai_client.py, openrouter_client.py | S |
| P2-4 | LLM03/A06 | Thêm hash-pinning (`pip-compile --generate-hashes`) cho Engine dependencies | Engine/requirements.txt | S |
| P2-5 | A05 | Tắt hoặc gate `/docs`, `/redoc`, `/openapi.json` của FastAPI sau auth | Engine/main.py | S |
| P2-6 | A02 | Mã hóa hoặc giảm thiểu PII trẻ em lưu trong `localStorage`; thêm cơ chế hết hạn/dọn dẹp | FE/src/App.tsx | M |
| P2-7 | A05 | Thêm `mem_limit`/`cpus` cho các service trong compose | docker-compose*.yml | S |
| P2-8 | A09 | Không log `tenant_id` như một giá trị công khai (coi log access = truy cập dữ liệu nhạy cảm), thêm audit trail cho hành vi bất thường | BE/src/common/interceptors/logging.interceptor.ts | S |
| P2-9 | A06 | Thêm `npm audit`/`pip-audit` vào CI hoặc bật Dependabot | CI config (chưa có) | S |

### P3 — Thấp / hardening
| ID | Hạng mục | Việc cần làm | Thành phần | Effort |
|---|---|---|---|---|
| P3-1 | A05 | Thêm `server_tokens off;` trong nginx | FE/nginx.conf | S |
| P3-2 | A04 | Thống nhất `confirm()` cho mọi hành động xóa (hiện xóa truyện không hỏi xác nhận trong khi xóa hồ sơ trẻ có hỏi) | FE/src/components/SavedStoriesModal.tsx | S |
| P3-3 | A09 | Cân nhắc thêm error tracking phía client (đánh đổi với việc gửi thêm dữ liệu ra bên thứ 3 — cần review privacy trước khi bật) | FE | S |

---

## 6. Giới hạn của đánh giá

- Đây là **static code review** dựa trên đọc mã nguồn, không phải kiểm thử xâm nhập (pentest) hay fuzzing thực tế trên hệ thống đang chạy.
- Không truy cập được cơ sở dữ liệu CVE trực tuyến để đối chiếu phiên bản dependency cụ thể — khuyến nghị chạy `npm audit`, `pip-audit`, hoặc Snyk/Dependabot như một bước riêng (đã đưa vào backlog P2-9).
- Không đánh giá cấu hình hạ tầng ngoài repo (Cloudflare account thật, DNS, IAM cloud provider nếu có) — chỉ đánh giá những gì được cấu hình trong repo.
- Điểm số là ước lượng định tính dựa trên mức độ nghiêm trọng và số lượng phát hiện trong mỗi hạng mục, không phải kết quả từ một công cụ chấm điểm tự động chuẩn hóa.
