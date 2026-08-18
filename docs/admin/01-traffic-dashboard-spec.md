# Dashboard quản lý traffic — Design Spec

> **Ngày:** 2026-08-14
> **Phạm vi:** Theo dõi traffic ingress, LLM input/output, IP accept, kiểm soát DDoS
> **Trạng thái:** BE hoàn tất & xanh test — FE chưa làm

## 1. Vấn đề

Hệ thống hiện có 3 lớp: nginx (edge), BE (NestJS), Engine (FastAPI → LLM). Ba lớp này sinh ra dữ liệu hoạt động — access log, số lần gọi LLM, token, latency — nhưng không có màn hình nào đọc ra. Admin mở SQLite bằng tay.

Cần dashboard:
1. Thống kê traffic — request, bytes in/out, latency, status code, unique IP, top route
2. Thống kê LLM input/output — gọi, prompt/completion tokens, chi phí, latency, fallback rate
3. Thống kê IP accept — IP active, block, throttle
4. Kiểm soát DDoS — IP rules, state lifecycle, alert

## 2. Quyết định thiết kế

| Quyết định | Chọn | Lý do |
|---|---|---|
| Cơ sở dữ liệu | core.db | Operational/admin data, không tenant-scoped. Đã chứa admin_users, feedback. |
| Traffic ingest | Endpoint admin + CLI script | Demo dùng endpoint, prod dùng cron script. |
| LLM usage capture | BE EngineGatewayService ghi event | BE biết tenant_id; Engine không có. |
| Token estimation | Dựa trên word_count + request size | Engine chưa báo token usage, ướp lượng tạm thời. |
| DDoS detection | Trigger trong traffic ingest | Ingest batch → IP vượt ngưỡng → state + alert. |
| Thư viện biểu đồ | CSS bars thuần | Trùng khớp với Phase 4C pattern. |
| Auth | AdminGuard (JWT HS256) | Tái sử dụng cơ chế đã có. |

## 3. Screen design → Schema mapping

### 3.1 Traffic Overview Screen

KPI: requests, bytes in, bytes out, p95 latency, unique IPs, 5xx count
Hourly trend bars, status code distribution, top routes table.

| UI | Entity.Column |
|---|---|
| requests | traffic_hourly.SUM(req_count) |
| bytes in | traffic_hourly.SUM(bytes_in) |
| bytes out | traffic_hourly.SUM(bytes_out) |
| p95 latency (thực chất là max, xem nợ kỹ thuật #1) | traffic_hourly.AVG(lat_p95_max_ms) |
| unique IPs | traffic_event.COUNT(DISTINCT ip) |
| 5xx | traffic_hourly SUM where status_class=5xx |
| hourly bars | traffic_hourly.hour_bucket, SUM(req_count) |
| status dist | traffic_hourly.status_class, SUM(req_count) |
| top routes | traffic_hourly.route, SUM(req_count), SUM(bytes_out) |

### 3.2 LLM Usage Screen

KPI: calls, prompt tokens, completion tokens, est cost, avg latency, fallback rate
Provider breakdown bars, model table.

| UI | Entity.Column |
|---|---|
| calls | llm_usage_event.COUNT / llm_usage_hourly.SUM(requests) |
| prompt tokens | llm_usage_event.SUM(prompt_tokens) |
| completion tokens | llm_usage_event.SUM(completion_tokens) |
| est cost | llm_usage_event.SUM(est_cost_usd) |
| avg latency | llm_usage_event.AVG(latency_ms) |
| fallback rate | llm_usage_event.SUM(is_fallback)/COUNT |
| provider breakdown | llm_usage_hourly.provider, SUM(requests), SUM(est_cost_usd) |
| model table | llm_usage_event.provider, model, COUNT, SUM(prompt_tokens), SUM(completion_tokens), SUM(est_cost_usd) |

### 3.3 IP Management Screen

IP Rules table → ip_rule(pattern, action, tier, created_at, enabled)
Active IPs → ip_state(ip, status, score, blocked_until, auto_blocked)
unblock → ip_state(status=ok, score=0, blocked_until=null)
toggle enable → ip_rule.enabled

### 3.4 Alerts Screen

Alerts list → alert(severity, type, ip, detail_json, created_at)
resolve → alert(resolved=true, resolved_at=now)

## 4. Schema (đã tạo)

Bảng tại BE/src/modules/admin/dashboard/entities/, toàn bộ trong core.db:

- admin_settings — key/value config (JSON text value)
- alerts — operational alerts (severity, type, ip, detail_json, resolved)
- ip_rules — allow/deny patterns (type, action, pattern, tier, enabled)
- ip_states — runtime IP status (ip, status, score, blocked_until, auto_blocked)
- traffic_event — raw nginx log (ip, route, method, status, bytes_in/out, lat_ms, ts)
- traffic_hourly — hourly rollup (ip+route+status_class+hour_bucket PK, req_count, bytes, lat)
- llm_usage_event — per-Engine-call (provider, model, tenant, tokens, cost, latency)
- llm_usage_hourly — hourly rollup (provider+model+hour_bucket PK, tokens, requests, cost, lat)

### 4.1 Định dạng thời gian (canonical)

Toàn bộ cột thời gian của dashboard dùng **một** định dạng duy nhất:

- Timestamp: `YYYY-MM-DDTHH:mm:ss` (UTC, không hậu tố zone) — `traffic_event.ts`,
  `llm_usage_event.ts`, `alerts.created_at`, `alerts.resolved_at`,
  `ip_states.blocked_until`, `ip_states.updated_at`, `admin_settings.updated_at`
- Hour bucket: `YYYY-MM-DDTHH` (13 ký tự) — `traffic_hourly.hour_bucket`,
  `llm_usage_hourly.hour_bucket`

Query param `from`/`to` nhận hour bucket. Khi lọc bảng event, `to` được nới
tới `:59:59` của giờ đó để hai mức granularity khớp nhau.

Không dùng dạng ngăn cách bằng dấu cách (`'2026-08-14 10:30:00'`) ở bất kỳ đâu.

### IP State lifecycle

IP request → check ip_rule → ip_state.score += 1
  score >= THRESHOLD → throttled → block window
  score >= PERM_THRESHOLD → perm_blocked → alert critical
  THRESHOLD, PERM_THRESHOLD lưu trong admin_settings.

## 5. API contract — /admin/dashboard/ (AdminGuard)

### Traffic
- GET /traffic/overview — tổng hợp traffic
- GET /traffic/events — raw events (paginated, filter by IP/route/status/date)
- POST /traffic/ingest — ingest nginx log (TrafficIngestDto)

### LLM Usage
- GET /llm/overview — tổng hợp LLM
- GET /llm/events — raw LLM events (paginated)

### IP Management
- GET /ip/rules — danh sách rules
- POST /ip/rules — tạo rule
- PATCH /ip/rules/:id — cập nhật
- DELETE /ip/rules/:id — xóa
- POST /ip/rules/apply — áp dụng rules, tính lại ip_state + alert
- GET /ip/states — danh sách IP states
- GET /ip/states/:ip — chi tiết 1 IP
- DELETE /ip/states/:ip — unblock IP

### Alerts
- GET /alerts — danh sách alerts (lọc resolved)
- PATCH /alerts/:id/resolve — đánh dấu đã xử lý

### Settings
- GET /settings — đọc settings
- PATCH /settings/:key — cập nhật 1 setting

## 6. Data flow

### Traffic ingest
nginx access.log → POST /admin/dashboard/traffic/ingest
  → parse từng dòng → traffic_event (raw, giữ drill-down)
  → cộng dồn traffic_hourly (khóa ip+route+status_class+hour)
  → cộng batch count vào ip_states.score
  → toàn bộ chạy trong 1 transaction

Ingest **không** khử trùng lặp theo tuple. Một đợt flood là rất nhiều request
giống hệt nhau trong cùng một giây — bỏ chúng đi là bỏ đúng tín hiệu cần phát
hiện. `skipped` chỉ đếm dòng không parse được. Chống replay là trách nhiệm của
cron ingestor (tail log, không đọc lại phần đã đọc).

### LLM usage capture
FE → POST /story/create → BE EngineGatewayService.generate()
  → gọi Engine /generate → EngineResponse
  → ghi LlmUsageEvent (provider từ config, tokens ướp lượng, cost ướp lượng)
  → trả về FE

### DDoS detection
`evaluateIp()` là nơi duy nhất quyết định status khi ingest. Leo thang một
chiều: ok → throttled → perm_blocked, không bao giờ tự hạ cấp.

  score >= ddos.throttle_threshold  → throttled     + alert warning
  score >= ddos.perm_threshold      → perm_blocked  + alert critical

Chỉ hạ cấp qua `DELETE /ip/states/:ip` (unblock) hoặc `POST /ip/rules/apply`.

## 7. Nợ kỹ thuật đã biết (chấp nhận có chủ đích)

| # | Vấn đề | Lý do hoãn |
|---|---|---|
| 1 | `traffic_hourly.lat_p95_max_ms` (trước đây `lat_p95_ms`) thực chất là **max**, không phải p95 | Đã đổi tên cột và mọi tham chiếu để tên không còn mô tả sai thống kê. Vẫn còn thiếu: tính p95 thật cần giữ toàn bộ mẫu latency theo giờ (per-bucket samples), việc đó bị hoãn tới khi có nhu cầu thật. |
| 2 | `trafficOverview.p95_latency_max_ms` (trước đây `p95_latency_ms`) là trung bình có trọng số của các max theo hàng | Hệ quả của (1), tên đã sửa cho khớp. Spec §3.1 nay ghi `AVG(lat_p95_max_ms)`. Việc còn thiếu là như trên: cần per-bucket latency samples để tính percentile thật thay vì max. |
| 3 | nginx `log_format` chưa được chốt trong config vận hành | Regex ingest hiện khớp `$remote_addr … "$request" $status $body_bytes_sent $request_length $request_time`, với `$request_time` là số thập phân giây (vd `0.123`) và được quy đổi sang mili-giây khi ghi `traffic_event.lat_ms`. Combined format mặc định **không** khớp. Phải chốt `log_format` trong nginx conf trước khi bật cron ingest. |
| 4 | `DASHBOARD_NGINX_LOG_FORMAT` khác `'auto'` → `parseLogLine` trả null cho mọi dòng | Chỉ có một format được hỗ trợ. Thêm format khi thực sự cần. |
| 5 | Token của LLM là ước lượng (`ký tự/4`, `word_count × 1.3`) | Engine chưa trả token usage thật. Cột `est_cost_usd` vì thế cũng là ước lượng. |
| 6 | Không có index trên `traffic_hourly.hour_bucket`, `ip_states.status`, `llm_usage_event.provider` | Chưa có dữ liệu đủ lớn để đo. Thêm khi thấy chậm thật. |
| 7 | `provider`/`model` ghi vào `llm_usage_event` là giá trị **cấu hình**, không phải provider thực sự đã trả lời | Engine chưa báo ngược provider của fallback chain. Đã ghi chú trong `engine.config.ts`. |
| 8 | `IpRule` với `action: 'allow'` bị bỏ qua hoàn toàn | `applyIpRules()` chỉ tìm rule có `action === 'deny'` để chặn; không có nhánh nào đọc rule `allow`. Deny luôn thắng và allow không có tác dụng gì — admin có thể tạo rule allow tin rằng nó mở lại một dải IP trong khi thực tế không đổi gì. Chưa có kế hoạch triển khai allowlist thật. |
