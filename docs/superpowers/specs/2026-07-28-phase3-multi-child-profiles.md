# Phase 3 Spec — Multi-Child Profiles

> **Date:** 2026-07-28  
> **Status:** Draft  
> **Scope:** Quản lý nhiều hồ sơ trẻ em, chuyển đổi nhanh, cá nhân hóa trải nghiệm

---

## 1. Overview

Phase 3 giải quyết gap lớn nhất về UX: FE hiện tại không biết "bé nào đang dùng app". BE đã có `child_profiles` table, CRUD endpoints, và `child_name` filter trên story queries. Phase 3 xây FE layer để kết nối BE child profile API vào trải nghiệm người dùng.

**Key decisions:**
- BE child profile đã đủ mạnh — Phase 3 chủ yếu là FE work
- Child ID được cache trong localStorage, sync với BE mỗi khi app mở
- Không login — tenant vẫn là device UUID
- 3 sub-phases: 3A (chọn hồ sơ) → 3B (lọc truyện theo bé) → 3C (quản lý hồ sơ)

---

## 2. Architecture Changes

```
FE hiện tại:                          FE mới:
───────────────                       ─────────
App.tsx                                App.tsx
├─ activeStory: state                   ├─ activeChild: state + localStorage
├─ savedStories: localStorage           ├─ children: ChildProfile[] (from BE)
├─ isNightMode                          ├─ activeStory
├─ lastInput                            ├─ childSelector modal
│                                       ├─ isNightMode
HomeScreen                             HomeScreen
├─ generic greeting                     ├─ "Chào bé {name} ơi! 🌙"
├─ sample stories                       ├─ multi-child greeting
│                                       ├─ age-filtered samples
FormScreen                              FormScreen
├─ all fields empty                     ├─ pre-filled from activeChild
├─ type childName each time             ├─ "dùng cho bé {name}" indicator
│                                       ├─ override fields for tonight
Header                                  Header
├─ logo + saved stories + theme         ├─ logo + child selector + saved + theme
│                                       └─ avatar circle showing active child initial
SavedStoriesModal                      SavedStoriesModal
├─ all stories merged                   ├─ tab: "Tất cả" / {childName}
└─ no child filter                      └─ child-specific stories highlighted
```

**Không có thay đổi DB schema.** Tất cả field cần đã có trong `child_profiles` table.

---

## 3. 3A — Child Profile Selection & Pre-fill

### 3.1 Data Flow: App Mount

```
1. App mount
2. fetch GET /child-profile (list all children for this tenant)
3. Check localStorage for cached childId
4. If cached childId exists in BE response → set as activeChild
5. If not → show "Chọn bé" prompt
6. Cache result in localStorage for offline fallback
```

### 3.2 FE: activeChild State

```typescript
// FE/src/types.ts — thêm
export interface ChildProfile {
  childId: string;
  childName: string;
  age: AgeGroup;
  interests?: string;
  preferredCharacters?: string;
  bedtimeGoal?: string;
  createdAt: string;
}

// FE/src/App.tsx — state
const [children, setChildren] = useState<ChildProfile[]>([]);
const [activeChild, setActiveChild] = useState<ChildProfile | null>(() => {
  try {
    const cached = localStorage.getItem('bsc_active_child');
    return cached ? JSON.parse(cached) : null;
  } catch { return null; }
});

// Sync activeChild to localStorage
useEffect(() => {
  if (activeChild) localStorage.setItem('bsc_active_child', JSON.stringify(activeChild));
  else localStorage.removeItem('bsc_active_child');
}, [activeChild]);
```

### 3.3 ChildSelector Component

New component `FE/src/components/ChildSelector.tsx`:

```
┌──────────────────────────────────┐
│  👶 Chọn bé                       │
│  ┌────────────────────────────┐  │
│  │ ○ An (4 tuổi)         👤  │  │
│  │ ● Minh (6 tuổi)  [ĐANG DÙNG]│  │
│  │ ○ Bơ (3 tuổi)            │  │
│  │ ──────────────────────   │  │
│  │ + Thêm hồ sơ mới         │  │
│  └────────────────────────────┘  │
│                                  │
│  (modal — click outside to close)│
└──────────────────────────────────┘
```

**Props:** `isOpen`, `children`, `activeChild`, `onSelect`, `onAddNew`, `onEdit`, `onClose`, `isNightMode`

**Behavior:**
- First time with no children: auto-open on form screen
- Show radio-style selection
- "Đang dùng" badge on active child
- Click child → sets active, closes
- Click "+ Thêm hồ sơ mới" → navigates to profile creation

### 3.4 HomeScreen — Child Greeting

**Thêm greeting section** (nếu activeChild != null):
```
🌟 Chào bé An ơi!
Hôm nay An bao nhiêu tuổi? → 4 tuổi 🌈
```
Dòng thứ 2 hiển thị thông tin active child. Nếu không có active child, hiện greeting mặc định "Chào ba mẹ!".

### 3.5 FormScreen — Pre-fill từ activeChild

**Khi activeChild tồn tại:**
- `childName` pre-filled, disabled (hiển thị "dùng cho bé An")
- `childAge` pre-filled
- `favoriteTopic` — vẫn trống (tùy chọn mỗi tối)
- Optional section:
  - `gender` — lấy từ `activeChild.gender` (nếu có, cần thêm field vào BE entity)
  - `lesson` — suggestion từ `bedtimeGoal`
  - `favoriteCharacter` — pre-filled từ `preferredCharacters`

**Cần thêm gender field vào ChildProfile entity** (nullable, default 'unspecified').

### 3.6 Header — Child Indicator

Thêm avatar circle cạnh logo:

```
[🌈] Bedtime Story Companion
      Chuyện kể trước giờ ngủ
      
  [A] [📚] [🌙]
```

- Circle hiện chữ cái đầu của active child name
- Click → mở ChildSelector
- Màu avatar dựa trên hash của childId (6 màu fixed palette)

---

## 4. 3B — Per-Child Story History

### 4.1 SavedStoriesModal — Child Filter

**Thêm tab bar** phía trên danh sách:
```
[Tất cả | An | Minh | Bơ]
```

- Mặc định: active child tab
- "Tất cả" = merged list (current behavior)
- Child tab = filter stories where `childName` matches (from BE or localStorage)

### 4.2 API: GET /story/latest với child_name

BE đã hỗ trợ `?child_name=An` param. FE cần:
1. Khi fetch stories, pass `child_name` từ activeChild
2. Lưu kết quả vào `beStories` per-child key trong state

**Tối ưu:** Cache per-child story list trong localStorage với key `bsc_be_stories_{childId}`.

### 4.3 HomeScreen — Age-Filtered Sample Stories

Filter `SAMPLE_STORIES` by active child's age. Show only stories where `childAge` matches.

---

## 5. 3C — Child Profile Management Screen

### 5.1 ProfileManager Screen

New screen type `'profile'` in `AppScreen` union. Routes from:
- "+ Thêm hồ sơ mới" in ChildSelector
- Edit icon on child in ChildSelector

**Layout:**
```
Trang cac be
────────────
[An] → sửa/xóa
[Minh] → sửa/xóa
[Bơ] → sửa/xóa
[+ Thêm hồ sơ mới]
```

### 5.2 ProfileEditor Component

Form fields:
- `childName` (text, required)
- `age` (3-6 grid, required)
- `gender` (boy/girl/unspecified, optional)
- `interests` (text, optional — "thích khủng long, công chúa, tàu hỏa")
- `preferredCharacters` (text, optional — "Gấu Pooh, Thỏ Bông")
- `bedtimeGoal` (text, optional — lesson suggestions)

**Submit:** POST /child-profile (create) hoặc PUT /child-profile/:childId (update).

### 5.3 Delete Profile

**BE:** Add `DELETE /child-profile/:childId` endpoint:
```typescript
async delete(childId: string, tenantId: string): Promise<void> {
  const profile = await this.repo.findOne({ where: { childId, tenantId } });
  if (!profile) throw new NotFoundException();
  profile.isActive = 0;
  await this.repo.save(profile);
}
```

**FE:** Confirm dialog → soft delete → remove from local cache. Nếu deleted child là activeChild → clear activeChild.

### 5.4 Avatar System

6-color palette based on child name hash:
```typescript
const AVATAR_COLORS = [
  { bg: 'bg-indigo-500', text: 'text-white' },
  { bg: 'bg-emerald-500', text: 'text-white' },
  { bg: 'bg-rose-500', text: 'text-white' },
  { bg: 'bg-amber-500', text: 'text-slate-900' },
  { bg: 'bg-cyan-500', text: 'text-white' },
  { bg: 'bg-violet-500', text: 'text-white' },
];
```

Avatar hiển thị: chữ cái đầu của childName, nền màu theo hash.

---

## 6. API Endpoints Summary

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | /child-profile | ✅ existing | List all children for tenant |
| GET | /child-profile?child_name=X | ✅ existing | Find by name |
| POST | /child-profile | ✅ existing | Create new child |
| PUT | /child-profile/:childId | ✅ existing | Update child fields |
| DELETE | /child-profile/:childId | 🔴 new | Soft delete (isActive=0) |
| GET | /story/latest | ✅ existing | Supports ?child_name= param |

---

## 7. Error & Edge Cases

| Scenario | Handling |
|----------|----------|
| BE returns empty child list | Show empty state "Thêm hồ sơ bé đầu tiên", auto-open profile creation |
| BE unreachable on mount | Use localStorage cache, show "Đang ngoại tuyến" indicator |
| Create duplicate child name | BE getOrCreate returns existing, alert user |
| Delete active child | Clear activeChild, redirect to home, show child selector |
| Switch child mid-story | Block switch: prompt "Đang đọc/xem truyện. Về trang chủ để chọn bé khác?". User must navigate to home first |
| Child name changed in BE | Re-fetch on next app open; localStorage is cache, not source |
| Offline create child | Not supported — require network for profile creation |

---

## 8. Testing

**FE tests:**
- ChildSelector renders child list, selects child, emits onSelect
- FormScreen pre-fills from activeChild correctly
- HomeScreen shows greeting with active child name
- SavedStoriesModal filters by child tab
- Header shows avatar with first letter

**BE tests:**
- DELETE /child-profile/:childId sets isActive=0
- GET /child-profile excludes inactive profiles
- Existing POST/PUT unchanged

---

## 9. Files Changed Summary

| File | Change |
|------|--------|
| FE/src/types.ts | Add ChildProfile interface, 'profile' AppScreen |
| FE/src/App.tsx | activeChild state, children fetch, child selector flow |
| FE/src/components/ChildSelector.tsx | **NEW** — child selection modal |
| FE/src/components/Header.tsx | Add active child avatar + click handler |
| FE/src/components/HomeScreen.tsx | Child greeting, age-filtered samples |
| FE/src/components/FormScreen.tsx | Pre-fill from activeChild |
| FE/src/components/SavedStoriesModal.tsx | Child filter tabs |
| FE/src/components/ProfileManager.tsx | **NEW** — list/edit/delete children |
| FE/src/components/ProfileEditor.tsx | **NEW** — child create/edit form |
| FE/src/utils/childClient.ts | **NEW** — BE child API wrapper |
| BE/src/modules/child/child.controller.ts | Add DELETE endpoint |
| BE/src/modules/child/child.service.ts | Add delete() method |
| BE/src/modules/child/entities/child-profile.entity.ts | Add gender column |
| BE/src/modules/child/dto/child-profile.dto.ts | Add gender field |
| BE/src/modules/child/__tests__/child.service.spec.ts | Delete test |