# Admin Dashboard FE — IP Management & Alerts (Design)

> **Ngày:** 2026-08-20
> **Phạm vi:** hai màn vận hành của admin console tiêu thụ BE dashboard API đã xanh test.
> **Nguồn:** `docs/admin/01-traffic-dashboard-spec.md`, plan `docs/superpowers/plans/2026-08-17-dashboard-be-hardening.md`.
> **Trạng thái:** thiết kế đã chốt, chưa triển khai.

## 1. Mục tiêu và phạm vi

BE dashboard đã hoàn tất (17 route dưới `AdminGuard`, 320 test xanh). FE chưa có gì.
Bản thiết kế này phủ **hai màn vận hành**:

- **IP Management** (`/admin/ip`) — rules, states, ingest.
- **Alerts** (`/admin/alerts`) — danh sách cảnh báo, đánh dấu đã xử lý.

Kèm hạ tầng dùng chung: layout + navigation, một hook đọc dữ liệu, client và types cho
dashboard API.

### Ngoài phạm vi

| Hạng mục | Lý do |
|---|---|
| Traffic Overview, LLM Usage | Là màn quan sát, không chặn vận hành. Plan sau. |
| `GET /admin/dashboard/settings` | Hai màn trên không cần. |
| Biểu đồ (CSS bar) | Thuộc hai màn quan sát. |
| BE debt #1/#2 — p95 thật | Cần lưu mẫu latency theo bucket, đổi schema. |
| BE debt #6 — index | Tối ưu, chưa có tín hiệu chậm. |
| BE debt #8 — `IpRule.action = 'allow'` không được đọc | Cần quyết định sản phẩm trước. |
| BE debt #9 — `pattern` không validate hình dạng | Xem §4.4. |

## 2. Task 0 — điều kiện tiên quyết ở BE

`POST /admin/dashboard/ip/rules` hiện **âm thầm mất toàn bộ body**.

`ValidationPipe` (`BE/src/common/pipes/validation.pipe.ts:26`) gọi
`validate(object, { whitelist: true })`, và `whitelist` xoá mọi property không có
decorator. `RuleDto` chỉ decorate `id`:

```ts
export class RuleDto {
  @IsOptional() @IsInt() id?: number;
  type!: RuleType;      // không decorator -> bị xoá
  pattern!: string;     // không decorator -> bị xoá
  action!: RuleAction;  // không decorator -> bị xoá
  tier: string = 'default';
  note?: string | null;
}
```

Đã xác nhận bằng probe test tạm (sau đó xoá): body hợp lệ đầy đủ
`{type:'ip', pattern:'10.0.0.9', action:'deny', tier:'default', note:'probe'}`
đi ra khỏi pipe thành `{}`.

**Sửa** — thêm decorator, theo đúng khuôn `update-rule.dto.ts`:

```ts
@IsIn(['ip', 'cidr']) type!: RuleType;
@IsString() @IsNotEmpty() @MaxLength(64) pattern!: string;
@IsIn(['allow', 'deny']) action!: RuleAction;
@IsOptional() @IsString() tier?: string;
@IsOptional() @IsString() note?: string | null;
```

Test đỏ trước, trong `dashboard.dto.spec.ts`, theo khuôn test của Task 9: khẳng định
`pattern` **sống sót** qua pipe, và body thiếu `type` bị 422.

**Không** validate hình dạng IP/CIDR bằng regex. Một regex đúng cho cả IPv4, IPv6 và CIDR
là thứ dễ sai và khó soát; sai theo hướng quá chặt sẽ chặn pattern hợp lệ mà người vận hành
thực sự cần. Ghi lại thành **debt #9** trong `docs/admin/01-traffic-dashboard-spec.md` §7.

## 3. Kiến trúc FE

### 3.1 File layout

Tất cả dưới `FE/src/admin/`.

**Mới:**

| File | Trách nhiệm |
|---|---|
| `AdminLayout.tsx` | Header + tab nav (Feedback / IP / Alerts) + logout + `<Outlet>` |
| `useAdminResource.ts` | Đọc dữ liệu: `{data, loading, error, reload}`, 401, map lỗi, polling |
| `dashboardClient.ts` | 10 hàm gọi API dashboard |
| `dashboardTypes.ts` | `IpRule`, `IpState`, `Alert`, `Paged<T>`, `IngestResult`, `ApplyResult` |
| `parseUtc.ts` | Parse timestamp UTC không hậu tố zone |
| `AdminIpScreen.tsx` | Ghép 3 khối của màn IP |
| `IpRulesTable.tsx` | Bảng rules + toggle enabled + sửa/xoá |
| `IpRuleForm.tsx` | Form inline tạo/sửa rule |
| `IpStatesTable.tsx` | Bảng states + bỏ block |
| `IngestPanel.tsx` | Input logPath + nút ingest |
| `AdminAlertsScreen.tsx` | Màn alerts |
| `AlertsTable.tsx` | Bảng alerts + hàng chi tiết |

**Sửa:**

| File | Thay đổi |
|---|---|
| `AdminApp.tsx` | Route lồng dưới `AdminLayout` |
| `AdminFeedbackScreen.tsx` | Bỏ `<header>` riêng, dùng `useAdminResource` |
| `adminClient.ts` | Export `adminFetch` để `dashboardClient` dùng lại |
| `__tests__/AdminFeedbackScreen.test.tsx` | Cập nhật assertion theo hai thay đổi trên |

`dashboardClient.ts` tách khỏi `adminClient.ts` thay vì nhồi tiếp: `adminClient` sẽ thành
12 hàm phủ 3 subsystem khác nhau. Hai file, một `adminFetch` dùng chung.

### 3.2 Client và types

| Hàm | Route | Trả về |
|---|---|---|
| `fetchIpRules()` | `GET /admin/dashboard/ip/rules` | `IpRule[]` |
| `createIpRule(body)` | `POST /admin/dashboard/ip/rules` | `IpRule` |
| `updateIpRule(id, patch)` | `PATCH /admin/dashboard/ip/rules/:id` | `IpRule` |
| `deleteIpRule(id)` | `DELETE /admin/dashboard/ip/rules/:id` | `{deleted:true}` |
| `applyIpRules()` | `POST /admin/dashboard/ip/rules/apply` | `{matched, alerts_created}` |
| `fetchIpStates(params)` | `GET /admin/dashboard/ip/states` | `Paged<IpState>` |
| `unblockIp(ip)` | `DELETE /admin/dashboard/ip/states/:ip` | `{unblocked:true}` |
| `fetchAlerts(params)` | `GET /admin/dashboard/alerts` | `Paged<Alert>` |
| `resolveAlert(id)` | `PATCH /admin/dashboard/alerts/:id/resolve` | `Alert` |
| `ingestTraffic(logPath)` | `POST /admin/dashboard/traffic/ingest` | `{ingested, skipped, alerts_created}` |

`unblockIp` phải `encodeURIComponent(ip)` — IPv6 chứa `:`.

**Quy ước tên khoá: camelCase.** `listIpRules` / `listIpStates` / `listAlerts` trả thẳng
entity TypeORM, nên JSON ra là `blockedUntil`, `autoBlocked`, `updatedAt`, `detailJson`,
`resolvedAt`, `createdAt`. Khác `AdminFeedbackItem` (snake_case) và khác `trafficOverview`
(snake_case). Hai quy ước sẽ cùng tồn tại trong `FE/src/admin/`.

**Không** thêm lớp map để chuẩn hoá. Lớp map che mất sự thật là BE không nhất quán, và làm
người đọc code FE không đối chiếu được với response thật. Thay vào đó ghi comment ở đầu
`dashboardTypes.ts` nói rõ vì sao có hai quy ước.

Shape (đọc từ entity, không suy đoán):

```ts
interface IpRule {
  id: number; type: 'ip' | 'cidr'; pattern: string;
  action: 'allow' | 'deny'; tier: string; note: string | null;
  createdBy: string; createdAt: string; enabled: boolean;
}

interface IpState {
  ip: string; // PK
  status: 'ok' | 'throttled' | 'temp_blocked' | 'perm_blocked';
  tier: string; score: number; blockedUntil: string | null;
  autoBlocked: boolean; reason: string | null; updatedAt: string;
}

interface Alert {
  id: number; type: string; severity: 'info' | 'warning' | 'critical';
  ip: string | null; provider: string | null;
  detailJson: string; // string chứa JSON, không phải object
  resolved: boolean; createdAt: string; resolvedAt: string | null;
}

interface Paged<T> { items: T[]; total: number; limit: number; offset: number; }
```

`temp_blocked` có trong union nhưng BE hiện không gán giá trị này. Giữ trong type và map
badge cho nó, để nếu BE bật lên thì không rơi ra ô trắng.

### 3.3 Timestamp

BE ghi UTC **không có hậu tố zone**: `2026-08-14T10:30:00` (spec §4.1).
`new Date('2026-08-14T10:30:00')` trong JS parse thành **giờ địa phương** — ở UTC+7 lệch 7
tiếng, và lệch âm thầm chứ không báo lỗi.

Một helper duy nhất, dùng ở mọi chỗ hiển thị thời gian:

```ts
export function parseUtc(ts: string): Date {
  return new Date(`${ts}Z`);
}
```

### 3.4 `useAdminResource`

```ts
useAdminResource<T>(key: string, fetcher: () => Promise<T>, opts?: { pollMs?: number })
  -> { data: T | null; loading: boolean; error: string | null; reload: () => void }
```

- `key` là chuỗi phụ thuộc, thường `searchParams.toString()` — giữ nguyên mẹo mà
  `AdminFeedbackScreen` đang dùng để một instance `URLSearchParams` mới cùng nội dung không
  gây refetch.
- `reload()` tăng một nonce nội bộ.
- 401 → `clearToken()` + `navigate('/admin/login', { replace: true })`, một chỗ duy nhất.
- `error` là chuỗi tiếng Việt đã map từ `ApiError.code` (§6).

Hook này quản 4 việc: fetch, 401, map lỗi, polling. Ranh giới hơi rộng. Cách hẹp hơn là
tách `usePolling`, nhưng khi đó logic "bỏ response cũ" phải phối hợp giữa hai hook và dễ
sai hơn. Chọn gộp, giữ file dưới ~90 dòng.

## 4. Màn IP Management (`/admin/ip`)

Một route, ba khối xếp dọc: **Ingest → Rules → States**. Không tách route vì quy trình vận
hành thực tế là *sửa rule → apply → xem states đổi*.

### 4.1 URL là nguồn sự thật — cho phần server lọc được

`listIpStates` nhận `status/limit/offset`. `listIpRules` **không nhận tham số nào** — trả
toàn bộ, sort `createdAt DESC`.

- States: `?status=&offset=` trên URL, `limit` cố định 50 (BE cap 500, default 100).
- Rules: không đưa vào URL, **không có filter**. Số rule thực tế nhỏ; filter client-side là
  thứ sẽ phải xoá khi BE bổ sung query.

Hai khối gọi hook riêng: `useAdminResource('rules', fetchIpRules)` và
`useAdminResource(statesKey, () => fetchIpStates(...))`. Không dùng một hook lấy cả hai, vì
khi đó `reload` là "tất cả hoặc không gì" trong khi ghi rule chỉ cần refetch rules.

### 4.2 Ghi và refetch

| Hành động | Refetch |
|---|---|
| Tạo / sửa / xoá rule | rules |
| `applyIpRules()` | rules **+ states** (ghi `ip_state`, tạo alert) |
| `unblockIp(ip)` | states **+ alerts** |
| `ingestTraffic()` | states (+ alerts) |

`applyIpRules` và `unblockIp` đụng dữ liệu của màn Alerts — `unblockIp` còn resolve các
alert `ddos_throttled | ddos_permanent | rule_block` đang mở của IP đó. Vì hai màn không
cùng mount, **không** dựng shared store; màn Alerts fetch khi mount và auto-refresh 30s nên
tự bắt kịp.

Giá phải trả: nếu người dùng mở Alerts ở tab khác, tab đó lệch tới 30 giây. Chấp nhận được
với console vận hành 1–2 người.

### 4.3 Confirm cho destructive

`deleteIpRule`, `unblockIp`, `applyIpRules`. `applyIpRules` nằm trong nhóm này vì một cú
bấm có thể block hàng loạt IP — confirm hiển thị số rule đang `enabled`.

Dùng `window.confirm`, không tự dựng modal: có sẵn, không cần state, và không màn nào khác
trong admin đang có modal để bắt chước.

### 4.4 `IpRuleForm`

Inline form, không modal. Fields khớp `RuleDto` sau Task 0: `type` (select ip/cidr),
`pattern` (text), `action` (select allow/deny), `tier` (text, default `default`),
`note` (textarea).

Chỉ chặn `pattern` rỗng. **Không** validate hình dạng IP/CIDR, khớp với quyết định ở Task 0:
nếu FE chặt hơn BE thì hai bên nói hai chuyện khác nhau và người dùng không biết tin bên
nào. Sai lệch kỳ vọng này là **debt #9**.

PATCH chỉ nhận `action / enabled / tier / note` — không đổi được `type` / `pattern`. Vậy:

- Hàng trong bảng có toggle `enabled` bấm-là-gửi.
- Nút "Sửa" mở lại form với `type` / `pattern` readonly.
- Muốn đổi pattern thì xoá và tạo lại — đúng như BE cho phép, không giả vờ nhiều hơn.

### 4.5 `IpStatesTable`

Cột: `ip`, `status` (badge: ok xám / throttled vàng / temp_blocked cam / perm_blocked đỏ),
`tier`, `score`, `blockedUntil`, `autoBlocked`, `reason`, `updatedAt`.
Nút "Bỏ block" chỉ hiện khi `status !== 'ok'`.

### 4.6 `IngestPanel`

Một input `logPath` + nút. BE (Task 1 của plan trước) chặn path ngoài
`DASHBOARD_NGINX_LOG_DIR`, nên lỗi hay gặp nhất là
`400 Log path is outside the configured log directory`.

Panel hiển thị **nguyên `message` từ BE**, không thay bằng câu chung. Thành công thì hiện
`ingested / skipped / alerts_created`.

## 5. Màn Alerts (`/admin/alerts`)

Một bảng. Filter `resolved` trên URL (`?resolved=false|true|` rỗng = tất cả), `limit` 50
(BE cap 200, default 50), phân trang Trước/Sau như `AdminFeedbackScreen`.

Mặc định mở màn là `?resolved=false` — người vận hành vào đây để xem cái *chưa xử lý*. Đặt
mặc định bằng `Navigate replace` khi URL trống, không bằng default trong
`filtersFromParams`, để URL luôn tự mô tả đầy đủ những gì đang hiển thị.

### 5.1 Hai điểm phải xác nhận khi viết plan

Không đoán, phải đọc code BE rồi chốt:

1. **Encode query `resolved`** sau khi Task 8/9 thêm DTO validation: nhận `'true'/'false'`
   dạng chuỗi hay đã transform thành boolean, và `undefined` có nghĩa "tất cả" hay không.
   Quyết định `fetchAlerts` gửi gì.
2. **`PATCH /alerts/:id/resolve` trên alert đã resolved** trả 200 hay 404/409. Quyết định có
   cần disable nút hay không.

### 5.2 Bảng

Cột: `severity` (badge: info xám / warning vàng / critical đỏ), `type`, `ip`, `provider`,
`createdAt`, trạng thái, nút "Đã xử lý".

`ip` và `provider` đều nullable — hiển thị `—`, không phải chuỗi rỗng.

`detailJson` là **string chứa JSON**. Nút "Chi tiết" mở/đóng một hàng phụ, nội dung là
`JSON.stringify(JSON.parse(s), null, 2)` trong `<pre>`, bọc `try/catch`: parse lỗi thì in
thẳng chuỗi gốc.

Không map từng field vì `detailJson` khác nhau theo `type` (ddos, rule_block, provider…) và
BE không cam kết schema — parse theo type sẽ hỏng âm thầm khi BE thêm loại alert mới.

### 5.3 Polling 30 giây

Do `useAdminResource` lo (`{ pollMs: 30_000 }`), với bốn quy tắc:

1. **Pause khi `document.hidden`**, và khi tab quay lại thì fetch **ngay**, không chỉ resume
   timer — nếu không, người dùng nhìn dữ liệu cũ tới 30s sau khi quay lại.
2. **Bỏ response cũ**: mỗi fetch mang một số thứ tự; response về mà số đó không còn mới nhất
   thì bỏ, không `setState`. Chặn cả đổi filter lẫn poll chậm chồng lên nhau.
3. **Poll không đặt `loading = true`.** Nếu đặt, cứ 30s bảng lại nháy sang skeleton.
   `loading` chỉ dành cho lần fetch đầu và cho `reload()` do người dùng bấm.
4. **Lỗi khi poll không xoá `data` đang có** — hiện dải cảnh báo nhỏ trên bảng ("Không cập
   nhật được, đang thử lại") và giữ dữ liệu cũ. Chỉ lỗi ở lần fetch đầu mới thay cả màn bằng
   khối lỗi + "Thử lại".

Ngoại lệ: **401 khi poll vẫn redirect ngay.** Token hết hạn giữa lúc mở màn là chuyện chắc
chắn xảy ra (JWT có `expires_at`), và giữ màn với dữ liệu cũ trong khi mọi request đều 401
thì tệ hơn.

Checkbox "Tự động làm mới" (bật sẵn) để tắt polling — cần khi ai đó đang đọc một hàng chi
tiết và không muốn bảng đổi dưới chân mình.

## 6. Xử lý lỗi

Bảng map, một chỗ duy nhất trong `useAdminResource`:

| code | thông báo |
|---|---|
| `UNAUTHORIZED` | không hiện — redirect `/admin/login` |
| `TIMEOUT` | "Máy chủ phản hồi quá lâu. Thử lại." |
| `NETWORK_ERROR` | "Không kết nối được máy chủ." |
| khác | `err.message` từ BE nếu có, nếu không thì "Có lỗi xảy ra." |

Nhánh cuối cố ý ưu tiên `message` của BE. Dashboard trả những câu cụ thể và hữu ích
(`Log path is outside the configured log directory`, `VALIDATION_ERROR` kèm field) — thay
chúng bằng "Có lỗi xảy ra" là làm người vận hành mất thông tin duy nhất họ có.

Giá phải trả: message của BE là tiếng Anh, nên màn hình sẽ lẫn hai ngôn ngữ. Chọn lẫn ngôn
ngữ thay vì mất thông tin.

**Lỗi khi ghi không đi qua hook** (hook chỉ lo đọc). Mỗi màn giữ
`actionError: string | null`, hiện thành dải đỏ ngay trên khối tương ứng, tự xoá khi hành
động sau thành công. Nút đang gửi thì `disabled` — chặn double-submit tạo hai rule trùng.

## 7. Testing

Theo pattern `FE/src/admin/__tests__/AdminFeedbackScreen.test.tsx` đã có: `MemoryRouter` +
`initialEntries`, token JWT giả còn sống trong `localStorage`, `vi.spyOn(client, 'fn')` trên
namespace import (cách này đã chạy được trong repo này).

File test mới:

1. **`useAdminResource.test.tsx`** — loading→data; đổi `key` thì refetch; `reload()` refetch;
   401 → `clearToken` + redirect; response cũ về sau khi key đã đổi thì bị bỏ; poll không
   bật `loading`; poll lỗi thì giữ `data` cũ.
2. **`dashboardClient.test.ts`** — mock `fetch`, khẳng định method/path/body của 10 hàm;
   `unblockIp` encode IPv6 đúng.
3. **`parseUtc.test.ts`** — `parseUtc('2026-08-14T10:30:00').getTime()` bằng
   `Date.UTC(2026, 7, 14, 10, 30, 0)`. Khẳng định bằng epoch ms, **không** set
   `process.env.TZ`: đổi TZ lúc runtime không đáng tin trên Windows, còn epoch ms thì đúng ở
   mọi timezone.
4. **`AdminIpScreen.test.tsx`** — render 3 khối; toggle `enabled` gọi PATCH rồi refetch
   rules; xoá rule có confirm (mock `window.confirm`), bấm Huỷ thì **không** gọi API;
   `applyIpRules` refetch cả rules và states; "Bỏ block" chỉ hiện với `status !== 'ok'`; lỗi
   ingest hiện nguyên message BE.
5. **`AdminAlertsScreen.test.tsx`** — mặc định `resolved=false`; badge severity; `detailJson`
   hỏng vẫn render chuỗi gốc; "Đã xử lý" refetch; polling tiến 30s bằng
   `vi.useFakeTimers()`.
6. **`AdminLayout.test.tsx`** — 3 tab, tab đang active, logout xoá token và về login.

**Cạm bẫy đã biết:** `userEvent` mặc định treo khi dùng chung `vi.useFakeTimers()`. Test
polling phải `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`, hoặc tách hẳn
test polling khỏi test có tương tác.

**Test cũ phải sửa:** `AdminFeedbackScreen.test.tsx` — màn này bỏ `<header>` riêng và chuyển
sang hook, nên assertion nào bám vào header hoặc loading của nó phải cập nhật. Đây là giá
của việc dùng `AdminLayout` chung.

Lệnh test: `cd FE && npx vitest run src/admin`.

## 8. Ràng buộc chung

- Comment và commit message bằng **tiếng Anh**.
- Không BOM UTF-8; literal tiếng Việt là UTF-8 hợp lệ.
- Không đổi 17 route path của BE.
- `adminFetch` vẫn **không** dùng `apiClient` / `ensureTenantId()` — mở console không được
  tạo tenant row.
- Không thêm thư viện data-fetch hay chart. FE hiện không có, và hai màn này không cần.
