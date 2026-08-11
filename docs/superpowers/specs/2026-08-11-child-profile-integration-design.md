# Hồ sơ bé — Audit & tích hợp lại FE

> **Ngày:** 2026-08-11
> **Phạm vi:** module `child` ở BE + đường điều hướng hồ sơ bé ở FE
> **Trạng thái:** đã duyệt, chờ lập plan
> **Nhánh:** `feat/child-profile-integration`

---

## 1. Vấn đề

Tính năng tạo và quản lý hồ sơ bé bị coi là deadcode. Audit cho thấy chẩn đoán đó sai ở phần "chưa viết", nhưng đúng ở phần "không dùng được".

**BE không phải deadcode.** `ChildModule` có đăng ký `ChildController` (`child.module.ts:6`) và được `AppModule` import (`app.module.ts:38`). Bốn endpoint `POST/GET/PUT/DELETE /child-profile` đều sống. `ChildService` còn được `StoryService`, `FeedbackService`, `AnalyticsService`, `AdminFeedbackService` gọi thật.

**FE cũng đã có đủ component.** `ProfileManager`, `ProfileEditor`, `ChildSelector`, `childClient`, và screen `'profile'` trong `App.tsx:348`.

Cái hỏng là **đồ thị điều hướng bị đứt**, khiến toàn bộ tính năng không thể chạm tới:

| # | Chỗ đứt | Vị trí |
|---|---|---|
| 1 | Header không có nút nào dẫn vào screen `profile`. Nút avatar mở `ChildSelector` chỉ render khi đã có `activeChild` | `Header.tsx:40` |
| 2 | Lối vào duy nhất là `children.length===0 && screen==='form'` tự mở `ChildSelector` → "Thêm hồ sơ mới" → `ProfileManager`. Nhưng `ProfileManager` **ẩn** nút "Thêm hồ sơ mới" khi `children.length === 0` → **ngõ cụt tuyệt đối, không cách nào tạo bé đầu tiên** | `App.tsx:123-127`, `ProfileManager.tsx:114` |
| 3 | `onEdit(child)` bỏ qua tham số `child`, chỉ nhảy về danh sách chứ không mở editor | `App.tsx:385` |
| 4 | Empty-state của `AnalyticsScreen` cũng không có nút tạo hồ sơ | `AnalyticsScreen.tsx:138-144` |

Hệ quả: hồ sơ bé chỉ xuất hiện do `StoryService.create` âm thầm gọi `getOrCreate` (`story.service.ts:31`) — cha mẹ có hồ sơ mà không biết mình đã tạo, và không có đường nào để sửa hay xoá.

Audit còn phát hiện ba lỗi BE độc lập với điều hướng:

- **Mất dữ liệu khi sửa hồ sơ.** `GET /child-profile` chỉ trả `child_id/child_name/age` (`child.controller.ts:27`), nên `ProfileEditor` prefill `interests`/`preferredCharacters`/`bedtimeGoal` bằng rỗng, rồi `PUT` ghi rỗng đè lên DB. Sửa mỗi tuổi bé cũng xoá sạch sở thích và nhân vật yêu thích — đúng những trường `StoryService.create` đọc lại để dựng prompt (`story.service.ts:55-56`).
- **Bé đã xoá không tạo lại được.** `getOrCreate` tra cứu không lọc `isActive` (`child.service.ts:33`) trong khi `findByTenant` lọc `isActive:1` (`child.service.ts:57`). Tạo lại bé cùng tên trả về đúng row đã soft-delete, API báo thành công nhưng bé vĩnh viễn không hiện trong danh sách.
- **Không đổi tên được.** `UpdateChildProfileDto` không có `child_name`, nhưng `ProfileEditor` vẫn cho gõ lại tên — bấm Cập nhật thì tên im lặng không đổi.

## 2. Quyết định nền

| Quyết định | Chọn | Lý do |
|---|---|---|
| Mô hình luồng | Hồ sơ là trung tâm | `childId` đã là khoá của story, memory, analytics, feedback. Để form nhập tên tự do song song với hồ sơ là giữ hai nguồn sự thật |
| `POST /story` | Thêm `child_id` optional, giữ `getOrCreate` khi vắng | Chặn sinh hồ sơ ma theo đường FE mà không phá integration test và client cũ |
| Onboarding | Empty-state có CTA tại chỗ | Không chặn cha mẹ xem truyện mẫu; không phải viết và test thêm màn hình wizard |
| Đổi tên bé | Cho phép, có chống trùng | Gõ sai tên bé là chuyện rất thường; bắt xoá rồi tạo lại sẽ mất lịch sử truyện |
| Tạo lại bé đã xoá | Sinh `childId` **mới**, row cũ ở yên | Hồi sinh row cũ sẽ làm truyện và analytics của bé đã xoá bất ngờ sống lại — trái với kỳ vọng của nút "Xoá hồ sơ" |
| `POST /child-profile` trùng tên | 409 Conflict | Với luồng hồ sơ-là-trung-tâm, "tạo" phải là tạo; ghi đè âm thầm là hành vi của `getOrCreate`, không phải của POST |

### Rủi ro đã chấp nhận

- **`getOrCreate` vẫn còn.** `StoryService` vẫn dùng nó khi request không có `child_id`, nên đường sinh hồ sơ ngầm chưa biến mất hoàn toàn — chỉ không còn client nào đi qua nó. Bỏ hẳn là việc của lần sau, khi không còn caller nào.
- **Không migration dữ liệu cũ.** Hồ sơ đã sinh ngầm trước đây vẫn nằm nguyên trong DB. Sau thay đổi này chúng hiện ra trong `ProfileManager` và cha mẹ tự xoá được — đủ, không cần script.

## 3. Kiến trúc

Không thêm module, không thêm bảng, không thêm dependency. Toàn bộ là sửa trong biên hiện có.

```
BE/src/modules/child/
  child.controller.ts              + toResponse(), GET by-name dùng findByName
  child.service.ts                 + create(), sửa getOrCreate/update/delete/findByTenant
  dto/update-child-profile.dto.ts  + child_name
BE/src/modules/story/
  dto/create-story.dto.ts          + child_id optional
  story.service.ts                 + nhánh resolve theo child_id

FE/src/
  types.ts                         StoryFormInput + childId
  utils/childClient.ts             map đủ trường
  utils/storyGenerator.ts          gửi child_id
  components/Header.tsx            + nút "Bé"
  components/ProfileManager.tsx    nút thêm luôn hiện, + initialEditChild
  components/AnalyticsScreen.tsx   + onAddChild
  components/FormScreen.tsx        chặn khi chưa chọn bé, chip thay ô tên/tuổi
  App.tsx                          nối lại điều hướng
```

## 4. Thay đổi BE

### B1 — `toResponse()` dùng chung cho cả bốn response

`ChildController` hiện dựng object trả về ở bốn chỗ khác nhau, cả bốn đều thiếu `gender/interests/preferred_characters/bedtime_goal`. Gom về một hàm:

```ts
private toResponse(p: ChildProfile) {
  return {
    child_id: p.childId,
    child_name: p.childName,
    age: p.age,
    gender: p.gender ?? null,
    interests: p.interests ?? null,
    preferred_characters: p.preferredCharacters ?? null,
    bedtime_goal: p.bedtimeGoal ?? null,
  };
}
```

Dùng cho `POST`, `GET` (list và by-name), `PUT`. Đây là chỗ chặn bug mất dữ liệu ở gốc: một hàm thì bốn response không thể lệch nhau về sau.

Nhánh by-name không tìm thấy vẫn giữ nguyên hình dạng cũ `{ child_id: null }` để `childClient.getByName` không phải đổi.

### B2 — Tách `create()` khỏi `getOrCreate()`

`ChildService.create(tenantId, dto)`: tìm row `{ tenantId, childName, isActive: 1 }`; thấy thì ném `ConflictException`; không thấy thì tạo row mới với đủ mọi trường trong DTO.

`getOrCreate` giữ nguyên chữ ký và hành vi refresh-age cho `StoryService`, chỉ sửa theo B3.

`ChildController.create` chuyển sang gọi `create()`.

### B3 — `getOrCreate` lọc `isActive: 1`

Thêm `isActive: 1` vào mệnh đề `where` của lần tra cứu đầu (`child.service.ts:33`). Bé đã soft-delete sẽ không khớp nữa → rơi xuống nhánh tạo mới → sinh `childId` mới. Row cũ giữ nguyên `isActive: 0`, `findByTenant` vẫn lọc nó ra.

### B4 — `update`/`delete` chỉ tác động row đang hoạt động

Thêm `isActive: 1` vào `where` của cả hai; không khớp thì vẫn ném `NotFoundException` như hiện nay. Nhất quán với B3: một row đã xoá thì không sửa và không xoá lại được.

### B5 — Đổi tên bé

`UpdateChildProfileDto` thêm:

```ts
@IsOptional()
@IsString()
@IsNotEmpty()
@MaxLength(40)          // NAME_MAX, khớp CreateChildProfileDto
@IsChildSafeText()
child_name?: string;
```

`ChildService.update`: nếu `dto.child_name` có mặt và khác tên hiện tại, tìm row `{ tenantId, childName: dto.child_name, isActive: 1 }`; thấy row khác `childId` thì ném `ConflictException`; không thì gán.

`IsChildSafeText()` không có `{ content: true }` — khớp đúng cách `CreateChildProfileDto` khai báo `child_name`.

### B6 — `POST /story` nhận `child_id`

`CreateStoryDto` thêm:

```ts
@IsOptional()
@IsUUID()
child_id?: string;
```

`StoryService.create`:

```ts
const child = dto.child_id
  ? await this.resolveChild(dto.child_id, tenantId)
  : await this.childService.getOrCreate(tenantId, { /* như hiện tại */ });
```

`resolveChild` gọi `childService.findById`, ném `NotFoundException` nếu không có, `isActive !== 1`, hoặc `tenantId` không khớp. Không tạo mới trong nhánh này.

Phần còn lại của `create` không đổi — `child.age`, `child.gender`, `child.preferredCharacters` vẫn được đọc y như cũ.

`child_name` và `age` **vẫn là trường bắt buộc** của `CreateStoryDto`. Không nới lỏng chúng: nhánh không có `child_id` cần chúng để `getOrCreate`, và FE nay lấy chúng từ `activeChild` nên vẫn luôn gửi đủ.

### B7 — `GET ?child_name=` dùng `findByName`

`child.controller.ts:22-24` đang tải toàn bộ hồ sơ của tenant rồi lọc bằng JS, và vì thế bỏ qua bộ lọc `isActive` mà `findByName` đã có sẵn. Thay bằng `childService.findByName(tenantId, childName)`.

### B8 — `findByTenant` sắp thứ tự

Thêm `order: { createdAt: 'ASC' }`. Hiện thứ tự phụ thuộc DB nên danh sách bé có thể nhảy giữa các lần tải.

## 5. Thay đổi FE

### F1 — Nối lại điều hướng

- **`Header`**: thêm nút "Bé" (icon `Users`) **luôn hiện**, gọi `setScreen('profile')`. Nút avatar giữ nguyên điều kiện `activeChild` và vẫn mở `ChildSelector`.
- **`ProfileManager`**: bỏ điều kiện `children.length > 0` ở nút "Thêm hồ sơ mới" (`ProfileManager.tsx:114`) để nút luôn hiện; empty-state gắn thêm CTA cùng hành động.
- **`AnalyticsScreen`**: thêm prop `onAddChild: () => void`, empty-state có nút "Thêm hồ sơ bé".
- **`ProfileManager`**: thêm prop `initialEditChild?: ChildProfile | null` để mở thẳng `ProfileEditor` đúng bé. `App.tsx` `onEdit(child)` lưu child vào state rồi `setCurrentScreen('profile')`.
- Gỡ `useEffect` auto-open `ChildSelector` (`App.tsx:123-127`) — `FormScreen` tự lo empty state theo F2.

### F2 — Form theo hồ sơ

- Không có `activeChild` → `FormScreen` render empty-state "Chọn bé trước khi kể chuyện" + CTA mở `ChildSelector`, **không** render form.
- Có `activeChild` → bỏ ô nhập tên (`FormScreen.tsx:177`) và dãy nút tuổi (`FormScreen.tsx:209-227`), thay bằng chip `Đang kể cho bé An · 4 tuổi · [Đổi bé]`. Nút "Đổi bé" gọi prop mới `onOpenChildSelector` mà `App.tsx` truyền xuống — cùng hàm mở `ChildSelector` mà `Header` đang dùng, để chỉ có một đường đổi bé trong toàn app.
- `StoryFormInput` thêm `childId: string`. `childName`/`childAge` vẫn còn trong kiểu vì `LoadingScreen` và `BedtimeStory` đang đọc, nhưng nay lấy từ `activeChild` chứ không từ input.
- `childName` bị bỏ khỏi `errors` và khỏi vòng validate — nó không còn là trường người dùng nhập.

### F3 — Client và trạng thái

- `childClient.list/getByName/create/update` map thêm `gender/interests/preferredCharacters/bedtimeGoal` từ response mới; bỏ `as any` ở `age`.
- `storyGenerator` gửi `child_id` trong payload.
- `ProfileManager.handleSave`: nếu đây là bé đầu tiên (`children.length === 0`) thì gọi `onSelectChild(saved)` để tự đặt làm `activeChild`.
- `ProfileEditor` bắt lỗi 409: hiện thông báo "Đã có bé tên này rồi" thay vì chỉ `console.error` như hiện nay (`ProfileEditor.tsx:52-54`).

## 6. Xử lý lỗi

| Tình huống | BE | FE |
|---|---|---|
| Tạo bé trùng tên | 409 `ConflictException` | Thông báo dưới ô tên, không rời form |
| Đổi tên trùng bé khác | 409 `ConflictException` | Như trên |
| `child_id` không thuộc tenant / đã xoá | 404 `NotFoundException` | `getErrorType` → `'server'` → `ErrorScreen` |
| Sửa/xoá bé đã xoá | 404 | Tải lại danh sách rồi báo "Hồ sơ không còn tồn tại" |
| `GET /child-profile` lỗi mạng | — | Giữ nguyên cơ chế `isOffline` + cache `bsc_children_cache` hiện có |

## 7. Kiểm thử

### BE — `child.service.spec.ts`

- `create` ném `ConflictException` khi trùng tên đang active
- `create` **không** ném khi trùng tên với row `isActive: 0`, và trả `childId` khác row cũ
- `update` đổi tên hợp lệ
- `update` ném `ConflictException` khi tên mới trùng bé khác đang active
- `update` cho phép "đổi" sang chính tên hiện tại (không tự xung đột với mình)
- `update` không đụng các trường không có trong DTO
- `update`/`delete` ném `NotFoundException` với row `isActive: 0`
- `getOrCreate` bỏ qua row đã soft-delete và tạo row mới

### BE — `child.integration.spec.ts`

- `POST` rồi `GET` trả đủ bảy trường, khớp giá trị đã gửi
- **`PUT` chỉ đổi `age` thì `interests`/`preferred_characters`/`bedtime_goal` còn nguyên** — đây là bug chính, test này bắt buộc
- `GET ?child_name=` không trả bé đã xoá

### BE — story integration

- `POST /story` với `child_id` hợp lệ dùng đúng hồ sơ đó và **không** tạo row mới
- `POST /story` với `child_id` của tenant khác → 404
- `POST /story` không có `child_id` vẫn chạy đúng như trước (bảo chứng tương thích ngược)

### FE

- `ProfileManager` với `children=[]` vẫn render nút tạo hồ sơ
- `ProfileManager` với `initialEditChild` mở thẳng `ProfileEditor` đúng bé
- `Header` render nút "Bé" kể cả khi `activeChild` là `null`
- `FormScreen` không có `activeChild` → không render form, có CTA
- `FormScreen` có `activeChild` → không có ô nhập tên, submit kèm `childId`
- `AnalyticsScreen` empty-state có nút gọi `onAddChild`

## 8. Ngoài phạm vi

- Wizard onboarding nhiều bước
- Migration hồ sơ sinh ngầm trước đây
- Thay đổi module `memory` và `feedback`
- Bắt buộc `child_id` ở `POST /story` (giữ optional)
- Bỏ `getOrCreate` khỏi `StoryService`
- Ràng buộc UNIQUE ở tầng DB cho `(tenant_id, child_name)` — chống trùng làm ở tầng service, vì soft-delete khiến ràng buộc DB phải là partial index mà SQLite hiện tại không được cấu hình để migrate
