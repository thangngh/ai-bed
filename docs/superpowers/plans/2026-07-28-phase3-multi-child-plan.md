# Phase 3 Implementation Plan — Multi-Child Profiles

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-child profile management UI: select active child, pre-fill forms, filter story history, create/edit/delete children.

**Architecture:** BE child_profiles table + CRUD already exist. Phase 3 extends BE with gender column + soft-delete endpoint, and builds FE layer: childClient API wrapper, ChildSelector modal, Header avatar, HomeScreen greeting, FormScreen pre-fill, SavedStoriesModal child tabs, ProfileManager/ProfileEditor screens.

**Tech Stack:** NestJS 11 (TypeORM), React 19 (Vite), Tailwind CSS, class-validator

## Global Constraints

- Tenant = device UUID, attached as `X-Tenant-Id` header
- Dual SQLite: core.db (child_profiles) + local.db (story, section)
- Gender field only allows `'boy' | 'girl' | 'unspecified'`
- Child profile soft-delete: set `isActive = 0`, do NOT hard delete
- All API responses use `{ data: ... }` or `{ error: { code, message }, request_id }` envelope
- FE child list cached in localStorage, synced with BE on mount
- Active child persisted in localStorage as `bsc_active_child`
- No login — tenant vẫn là device UUID
- Avatar: 6-color palette, first letter of childName, color based on hash of childId

---
## Table of Contents

- **Phase 3A: Child Profile Selection & Pre-fill** (Tasks 3A.1–3A.8)
- **Phase 3B: Per-Child Story History** (Tasks 3B.1–3B.2)
- **Phase 3C: Profile Management Screen** (Tasks 3C.1–3C.8)

---

## Phase 3A: Child Profile Selection & Pre-fill

### Task 3A.1: BE — Add gender field to ChildProfile entity + DTO

**Files:**
- Modify: `BE/src/modules/child/entities/child-profile.entity.ts`
- Modify: `BE/src/modules/child/dto/child-profile.dto.ts`
- Test: `BE/src/modules/child/__tests__/child.service.spec.ts` (add test)

**Interfaces:**
- Consumes: existing ChildProfile entity with `childId`, `tenantId`, `childName`, `age`
- Produces: `ChildProfile.gender: string` (nullable, no default)

- [ ] **Step 1: Write failing test — create profile with gender**

```typescript
// BE/src/modules/child/__tests__/child.service.spec.ts — add
it('should create profile with gender', async () => {
  const p = await service.getOrCreate('tenant-1', { child_name: 'An', age: 4, gender: 'boy' } as any);
  expect(p.gender).toBe('boy');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd BE && npx jest src/modules/child/__tests__/child.service.spec.ts -v`
Expected: FAIL — Property `gender` does not exist on type ChildProfile

- [ ] **Step 3: Add gender column to entity**

```typescript
// BE/src/modules/child/entities/child-profile.entity.ts — add after bedtimeGoal
@Column({ name: 'gender', type: 'text', nullable: true })
gender?: string;
```

- [ ] **Step 4: Add gender to DTO**

```typescript
// BE/src/modules/child/dto/child-profile.dto.ts — add after bedtime_goal
@IsOptional()
@IsString()
gender?: string;
```

- [ ] **Step 5: Update service getOrCreate to save gender**

```typescript
// BE/src/modules/child/child.service.ts — in getOrCreate, after bedtimeGoal line
profile.gender = dto.gender || null;
```

- [ ] **Step 6: Run tests to verify pass**

Run: `cd BE && npx jest src/modules/child/__tests__/child.service.spec.ts -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add BE/src/modules/child/entities/child-profile.entity.ts BE/src/modules/child/dto/child-profile.dto.ts BE/src/modules/child/child.service.ts BE/src/modules/child/__tests__/child.service.spec.ts
git commit -m "feat: add gender column to child_profile entity + DTO + service"
```

---

### Task 3A.2: BE — Add gender to UpdateChildProfileDto

**Files:**
- Modify: `BE/src/modules/child/dto/update-child-profile.dto.ts`
- Modify: `BE/src/modules/child/child.service.ts`

**Interfaces:**
- Consumes: existing `UpdateChildProfileDto` with age/interests/preferred_characters/bedtime_goal
- Produces: `update()` can persist gender changes

- [ ] **Step 1: Add gender to update DTO**

```typescript
// BE/src/modules/child/dto/update-child-profile.dto.ts — add
@IsOptional()
@IsString()
gender?: string;
```

- [ ] **Step 2: Add gender to service.update()**

```typescript
// BE/src/modules/child/child.service.ts — in update(), add
if (dto.gender !== undefined) profile.gender = dto.gender;
```

- [ ] **Step 3: Commit**

```bash
git add BE/src/modules/child/dto/update-child-profile.dto.ts BE/src/modules/child/child.service.ts
git commit -m "feat: add gender to child profile update"
```

---

### Task 3A.3: FE — Add ChildProfile type + childClient API wrapper + avatar utils

**Files:**
- Modify: `FE/src/types.ts`
- Create: `FE/src/utils/childClient.ts`
- Create: `FE/src/utils/avatar.ts`

**Interfaces:**
- Consumes: `AgeGroup` type from types.ts
- Produces: `ChildProfile` interface, `childClient` object with `list()`, `get()`, `create()`, `update()`, `delete()` methods

- [ ] **Step 1: Add ChildProfile interface to types.ts**

```typescript
// FE/src/types.ts — add after FeedbackData
export interface ChildProfile {
  childId: string;
  childName: string;
  age: AgeGroup;
  gender?: string;
  interests?: string;
  preferredCharacters?: string;
  bedtimeGoal?: string;
  createdAt?: string;
}
```

- [ ] **Step 2: Add 'profile' to AppScreen**

```typescript
// FE/src/types.ts — modify AppScreen
export type AppScreen = 'home' | 'form' | 'loading' | 'story' | 'feedback' | 'error' | 'profile';
```

- [ ] **Step 3: Create childClient.ts**

```typescript
// FE/src/utils/childClient.ts
import { apiClient } from './api';
import { ChildProfile } from '../types';

interface ChildApiResponse {
  child_id: string;
  child_name: string;
  age: number;
}

export const childClient = {
  list: async (): Promise<ChildProfile[]> => {
    const data = await apiClient<any>('/child-profile');
    const children = data.children || [];
    return children.map((c: ChildApiResponse) => ({
      childId: c.child_id,
      childName: c.child_name,
      age: c.age as any,
    }));
  },

  getByName: async (name: string): Promise<ChildProfile | null> => {
    const data = await apiClient<any>(`/child-profile?child_name=${encodeURIComponent(name)}`);
    if (!data.child_id) return null;
    return { childId: data.child_id, childName: data.child_name, age: data.age };
  },

  create: async (input: { child_name: string; age: number; gender?: string; preferred_characters?: string; bedtime_goal?: string }): Promise<ChildProfile> => {
    const data = await apiClient<any>('/child-profile', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return { childId: data.child_id, childName: data.child_name, age: data.age };
  },

  update: async (childId: string, input: { age?: number; gender?: string; interests?: string; preferred_characters?: string; bedtime_goal?: string }): Promise<ChildProfile> => {
    const data = await apiClient<any>(`/child-profile/${childId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return { childId: data.child_id, childName: data.child_name, age: data.age };
  },

  delete: async (childId: string): Promise<void> => {
    await apiClient(`/child-profile/${childId}`, { method: 'DELETE' });
  },
};
```

- [ ] **Step 4: Commit**

```bash
git add FE/src/types.ts FE/src/utils/childClient.ts
git commit -m "feat: add ChildProfile type and childClient API wrapper"
```

---

### Task 3A.4: FE — ChildSelector component

**Files:**
- Create: `FE/src/components/ChildSelector.tsx`

**Interfaces:**
- Consumes: `ChildProfile[]`, `activeChild`, callbacks from App.tsx
- Produces: Child selection modal with radio-style list, "Đang dùng" badge, "+ Thêm hồ sơ mới" button

- [ ] **Step 1: Create ChildSelector component**

```typescript
// FE/src/components/ChildSelector.tsx
import React from 'react';
import { X, UserPlus, Check, Pencil } from 'lucide-react';
import { ChildProfile } from '../types';

interface ChildSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  children: ChildProfile[];
  activeChild: ChildProfile | null;
  onSelect: (child: ChildProfile) => void;
  onAddNew: () => void;
  onEdit: (child: ChildProfile) => void;
  isNightMode: boolean;
}

const AVATAR_COLORS = [
  { bg: 'bg-indigo-500', text: 'text-white' },
  { bg: 'bg-emerald-500', text: 'text-white' },
  { bg: 'bg-rose-500', text: 'text-white' },
  { bg: 'bg-amber-500', text: 'text-slate-900' },
  { bg: 'bg-cyan-500', text: 'text-white' },
  { bg: 'bg-violet-500', text: 'text-white' },
];

function getAvatarColor(id: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export const ChildSelector: React.FC<ChildSelectorProps> = ({
  isOpen, onClose, children, activeChild, onSelect, onAddNew, onEdit, isNightMode,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className={`w-full max-w-sm rounded-3xl border shadow-2xl overflow-hidden ${
        isNightMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-amber-200 text-amber-950'
      }`}>
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <h2 className="font-extrabold text-lg flex items-center gap-2">
            <span>👶</span>
            <span>Chọn bé</span>
          </h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Child list */}
        <div className="p-4 space-y-2">
          {children.length === 0 ? (
            <p className="text-center py-6 text-sm opacity-70">Chưa có hồ sơ bé nào</p>
          ) : children.map((child) => {
            const color = getAvatarColor(child.childId);
            const isActive = activeChild?.childId === child.childId;
            return (
              <div
                key={child.childId}
                onClick={() => { onSelect(child); onClose(); }}
                className={`p-3 rounded-2xl border flex items-center gap-3 cursor-pointer transition-all ${
                  isActive
                    ? isNightMode
                      ? 'bg-indigo-900/40 border-indigo-600/50'
                      : 'bg-indigo-50 border-indigo-300'
                    : isNightMode
                      ? 'bg-slate-800/60 border-slate-700 hover:bg-slate-700'
                      : 'bg-amber-50/60 border-amber-200 hover:bg-amber-100'
                }`}
              >
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full ${color.bg} ${color.text} flex items-center justify-center font-bold text-lg shrink-0`}>
                  {getInitial(child.childName)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm flex items-center gap-2">
                    <span>{child.childName}</span>
                    {isActive && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-600 text-white font-semibold">ĐANG DÙNG</span>
                    )}
                  </div>
                  <p className="text-xs opacity-70">{child.age} tuổi</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  {isActive && <Check className="w-4 h-4 text-indigo-500" />}
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit(child); }}
                    className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5 opacity-60" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add new */}
        <div className="px-4 pb-4">
          <button
            onClick={() => { onAddNew(); }}
            className={`w-full py-3 rounded-2xl text-sm font-bold border-2 border-dashed flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              isNightMode
                ? 'border-slate-600 text-slate-300 hover:border-indigo-500 hover:text-indigo-400'
                : 'border-amber-300 text-amber-800 hover:border-indigo-400 hover:text-indigo-600'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            <span>Thêm hồ sơ mới</span>
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add FE/src/components/ChildSelector.tsx
git commit -m "feat: ChildSelector component with avatar, select, edit, add-new"
```

---

### Task 3A.5: FE — Header child avatar

**Files:**
- Modify: `FE/src/components/Header.tsx`

**Interfaces:**
- Consumes: `activeChild: ChildProfile | null`, `onOpenChildSelector: () => void`
- Produces: Avatar circle in header showing active child initial, click opens ChildSelector

- [ ] **Step 1: Add new props to Header**

```typescript
// FE/src/components/Header.tsx — add to interface
interface HeaderProps {
  // ...existing...
  activeChild?: ChildProfile | null;
  onOpenChildSelector?: () => void;
}
```

- [ ] **Step 2: Add avatar circle between brand and saved-stories button**

```typescript
// FE/src/components/Header.tsx — import getAvatarColor, getInitial (or define inline)
// After the brand button, before "Right Actions" div, add:
{activeChild && (
  <button
    onClick={onOpenChildSelector}
    className={`w-8 h-8 rounded-full ${getAvatarColor(activeChild.childId).bg} ${getAvatarColor(activeChild.childId).text} flex items-center justify-center font-bold text-sm shrink-0 cursor-pointer hover:ring-2 hover:ring-indigo-400 transition-all`}
    title={activeChild.childName}
  >
    {getInitial(activeChild.childName)}
  </button>
)}
```

- [ ] **Step 3: Commit**

```bash
git add FE/src/components/Header.tsx
git commit -m "feat: Header child avatar with initial and color"
```

---

### Task 3A.6: FE — HomeScreen child greeting

**Files:**
- Modify: `FE/src/components/HomeScreen.tsx`

**Interfaces:**
- Consumes: `activeChild: ChildProfile | null`
- Produces: Personalized greeting section, age-filtered sample stories

- [ ] **Step 1: Add activeChild prop to HomeScreen**

```typescript
// FE/src/components/HomeScreen.tsx — add to interface
interface HomeScreenProps {
  // ...existing...
  activeChild?: ChildProfile | null;
}
```

- [ ] **Step 2: Add greeting section above hero (or inside hero)**

```typescript
// In render, before the hero section or integrated:
{activeChild && (
  <div className="text-center py-3 animate-fadeIn">
    <p className="text-lg sm:text-xl font-bold">
      🌟 Chào bé {activeChild.childName} ơi!
    </p>
    <p className="text-sm opacity-80">
      Hôm nay {activeChild.childName} bao nhiêu tuổi? → {activeChild.age} tuổi 🌈
    </p>
  </div>
)}
{!activeChild && (
  <div className="text-center py-3">
    <p className="text-lg font-bold">Chào ba mẹ!</p>
  </div>
)}
```

- [ ] **Step 3: Filter sample stories by active child's age**

```typescript
// Before rendering presetStories, filter:
const filteredStories = activeChild
  ? presetStories.filter(s => s.childAge === activeChild.age)
  : presetStories;
// Use filteredStories in the render loop
```

- [ ] **Step 4: Commit**

```bash
git add FE/src/components/HomeScreen.tsx
git commit -m "feat: HomeScreen child greeting and age-filtered samples"
```

---

### Task 3A.7: FE — FormScreen pre-fill from activeChild

**Files:**
- Modify: `FE/src/components/FormScreen.tsx`

**Interfaces:**
- Consumes: `activeChild: ChildProfile | null`
- Produces: Pre-filled childName (disabled), age, gender, favoriteCharacter from activeChild; override fields for tonight

- [ ] **Step 1: Add activeChild prop to FormScreen**

```typescript
// FE/src/components/FormScreen.tsx — add to interface
interface FormScreenProps {
  // ...existing...
  activeChild?: ChildProfile | null;
}
```

- [ ] **Step 2: Pre-fill state from activeChild**

```typescript
// In the component body, replace default useState with:
const [childName, setChildName] = useState(activeChild?.childName || '');
const [childAge, setChildAge] = useState<AgeGroup>(activeChild?.age || 4);

// For optional fields:
const [gender, setGender] = useState<GenderOption>((activeChild?.gender as GenderOption) || 'unspecified');
const [favoriteCharacter, setFavoriteCharacter] = useState(activeChild?.preferredCharacters || '');
```

- [ ] **Step 3: Show "dùng cho bé X" indicator near childName field**

Add a small badge below the childName input when activeChild exists:
```typescript
// After childName input
{activeChild && (
  <p className="text-xs text-indigo-500 font-medium">✨ Dùng cho bé {activeChild.childName}</p>
)}
```

- [ ] **Step 4: Commit**

```bash
git add FE/src/components/FormScreen.tsx
git commit -m "feat: FormScreen pre-fills from activeChild profile"
```

---

### Task 3A.8: FE — Wire activeChild flow through App.tsx

**Files:**
- Modify: `FE/src/App.tsx`

**Interfaces:**
- Consumes: `childClient`, `ChildProfile`, `ChildSelector`, `Header` with new props
- Produces: Full child selection flow on mount, activeChild state, child selector modal wiring

- [ ] **Step 1: Add imports**

```typescript
// FE/src/App.tsx — add imports
import { ChildProfile } from './types';
import { childClient } from './utils/childClient';
import { ChildSelector } from './components/ChildSelector';
```

- [ ] **Step 2: Add state**

```typescript
// After isNightMode state
const [children, setChildren] = useState<ChildProfile[]>([]);
const [activeChild, setActiveChild] = useState<ChildProfile | null>(() => {
  try {
    const cached = localStorage.getItem('bsc_active_child');
    return cached ? JSON.parse(cached) : null;
  } catch { return null; }
});
const [isChildSelectorOpen, setIsChildSelectorOpen] = useState(false);
```

- [ ] **Step 3: Sync activeChild to localStorage**

```typescript
// After savedStories useEffect
useEffect(() => {
  if (activeChild) localStorage.setItem('bsc_active_child', JSON.stringify(activeChild));
  else localStorage.removeItem('bsc_active_child');
}, [activeChild]);
```

- [ ] **Step 4: Fetch children on mount**

```typescript
// After the sync useEffect
useEffect(() => {
  childClient.list()
    .then(setChildren)
    .catch(() => {
      // Offline — try cached list
      try {
        const cached = localStorage.getItem('bsc_children_cache');
        if (cached) setChildren(JSON.parse(cached));
      } catch {}
    });
}, []);
```

- [ ] **Step 5: Cache children when fetched**

```typescript
// After setChildren in the fetch, add:
useEffect(() => {
  if (children.length) localStorage.setItem('bsc_children_cache', JSON.stringify(children));
}, [children]);
```

- [ ] **Step 6: Handle child selection**

```typescript
// Add handler
const handleSelectChild = (child: ChildProfile) => {
  if (currentScreen !== 'home' && currentScreen !== 'form') {
    // Block switch mid-story
    return; // User must navigate to home first
  }
  setActiveChild(child);
};
```

- [ ] **Step 7: Pass new props to all components**

Wire activeChild/childSelector to Header, HomeScreen, FormScreen, and ChildSelector:
```typescript
<Header
  // ...existing props...
  activeChild={activeChild}
  onOpenChildSelector={() => setIsChildSelectorOpen(true)}
/>

<HomeScreen
  // ...existing props...
  activeChild={activeChild}
/>

<FormScreen
  // ...existing props...
  activeChild={activeChild}
/>

<ChildSelector
  isOpen={isChildSelectorOpen}
  onClose={() => setIsChildSelectorOpen(false)}
  children={children}
  activeChild={activeChild}
  onSelect={handleSelectChild}
  onAddNew={() => { setIsChildSelectorOpen(false); setCurrentScreen('profile'); }}
  onEdit={(child) => { setIsChildSelectorOpen(false); setCurrentScreen('profile'); }}
  isNightMode={isNightMode}
/>
```

- [ ] **Step 8: Commit**

```bash
git add FE/src/App.tsx
git commit -m "feat: wire activeChild flow through App.tsx with ChildSelector"
```

---

## Phase 3B: Per-Child Story History

### Task 3B.1: FE — Update fetchStoriesFromBE with child_name param

**Files:**
- Modify: `FE/src/App.tsx`

**Interfaces:**
- Consumes: `activeChild` state from App.tsx
- Produces: BE stories fetched with `?child_name=activeChild.childName` param

- [ ] **Step 1: Modify fetchStoriesFromBE to pass child_name**

```typescript
// FE/src/App.tsx — replace fetchStoriesFromBE
const fetchStoriesFromBE = async () => {
  setIsLoadingStories(true);
  try {
    const params = new URLSearchParams({ limit: '50' });
    if (activeChild) params.set('child_name', activeChild.childName);
    const data = await apiClient<any>(`/story/latest?${params.toString()}`);
    const list = data.stories || [];
    setBeStories(list.map((s: any) => ({
      id: `be-${s.story_id}`,
      title: s.title,
      childName: '',
      childAge: 0,
      topic: s.theme || '',
      segments: {
        opening: s.title,
        situation: '', interaction1: '', challenge: '',
        interaction2: '', ending: '', interaction3: '', moralSummary: '',
      },
      createdAt: s.created_at,
    })));
  } catch {
    console.warn('Failed to fetch BE stories');
  } finally {
    setIsLoadingStories(false);
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add FE/src/App.tsx
git commit -m "feat: fetch BE stories filtered by active child"
```

---

### Task 3B.2: FE — SavedStoriesModal child filter tabs

**Files:**
- Modify: `FE/src/components/SavedStoriesModal.tsx`

**Interfaces:**
- Consumes: `activeChild`, `children` from App.tsx
- Produces: Tab bar ("Tất cả" / active child name) for filtering

- [ ] **Step 1: Add props + tab state**

```typescript
// FE/src/components/SavedStoriesModal.tsx — add to interface
interface SavedStoriesModalProps {
  // ...existing...
  activeChild?: ChildProfile | null;
}

// Add state inside component
const [filterTab, setFilterTab] = useState<'all' | 'child'>('child');
const showAllStories = filterTab === 'all';
```

- [ ] **Step 2: Add tab bar above content list (after header, before content)**

```typescript
// After header div, before content list div:
{activeChild && (
  <div className="px-5 pt-3 pb-1 flex gap-2">
    <button
      onClick={() => setFilterTab('all')}
      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
        filterTab === 'all'
          ? 'bg-indigo-600 text-white'
          : isNightMode ? 'bg-slate-800 text-slate-300' : 'bg-amber-100 text-amber-900'
      }`}
    >
      Tất cả
    </button>
    <button
      onClick={() => setFilterTab('child')}
      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
        filterTab === 'child'
          ? 'bg-indigo-600 text-white'
          : isNightMode ? 'bg-slate-800 text-slate-300' : 'bg-amber-100 text-amber-900'
      }`}
    >
      {activeChild.childName}
    </button>
  </div>
)}
```

- [ ] **Step 3: Filter stories based on tab**

```typescript
// Replace deduped definition with:
const allMerged = [...beStories, ...savedStories];
const seen = new Set<string>();
const deduped = allMerged.filter(s => {
  const key = s.title;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
const displayedStories = showAllStories || !activeChild
  ? deduped
  : deduped.filter(s => s.childName === activeChild.childName);
```

- [ ] **Step 4: Commit**

```bash
git add FE/src/components/SavedStoriesModal.tsx
git commit -m "feat: SavedStoriesModal child filter tabs"
```

---

## Phase 3C: Profile Management Screen

### Task 3C.1: BE — Add DELETE /child-profile/:childId endpoint

**Files:**
- Modify: `BE/src/modules/child/child.controller.ts`
- Modify: `BE/src/modules/child/child.service.ts`
- Test: `BE/src/modules/child/__tests__/child.service.spec.ts` (add test)

**Interfaces:**
- Consumes: `childId`, `tenantId`
- Produces: Soft-delete (set isActive=0), returns 204 No Content

- [ ] **Step 1: Write failing test**

```typescript
// BE/src/modules/child/__tests__/child.service.spec.ts — add
it('should soft-delete profile', async () => {
  const p = await service.getOrCreate('tenant-1', { child_name: 'ToDelete', age: 5 } as any);
  await service.delete(p.childId, 'tenant-1');
  const deleted = await service.findById(p.childId);
  expect(deleted).toBeDefined();
  expect(deleted!.isActive).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd BE && npx jest src/modules/child/__tests__/child.service.spec.ts -v -t "soft-delete"`
Expected: FAIL with "service.delete is not a function"

- [ ] **Step 3: Add delete method to service**

```typescript
// BE/src/modules/child/child.service.ts — add
async delete(childId: string, tenantId: string): Promise<void> {
  const profile = await this.repo.findOne({ where: { childId, tenantId } });
  if (!profile) throw new NotFoundException('Child profile not found');
  profile.isActive = 0;
  await this.repo.save(profile);
}
```

- [ ] **Step 4: Add DELETE endpoint to controller**

```typescript
// BE/src/modules/child/child.controller.ts — add import
import { Delete, HttpCode } from '@nestjs/common';

// Add method
@Delete(':childId')
@HttpCode(204)
async delete(@Param('childId') childId: string, @Req() req: Request) {
  const tenantId = (req as any).tenantId;
  await this.childService.delete(childId, tenantId);
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd BE && npx jest src/modules/child/__tests__/child.service.spec.ts -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add BE/src/modules/child/child.service.ts BE/src/modules/child/child.controller.ts BE/src/modules/child/__tests__/child.service.spec.ts
git commit -m "feat: soft-delete child profile endpoint"
```

---

### Task 3C.2: FE — ProfileEditor component

**Files:**
- Create: `FE/src/components/ProfileEditor.tsx`

**Interfaces:**
- Consumes: `ChildProfile | null` (null = create mode), callbacks
- Produces: Form with all child fields, save via childClient

- [ ] **Step 1: Create ProfileEditor component**

```typescript
// FE/src/components/ProfileEditor.tsx
import React, { useState } from 'react';
import { ArrowLeft, Sparkles, Save } from 'lucide-react';
import { AgeGroup, GenderOption, ChildProfile } from '../types';
import { childClient } from '../utils/childClient';

interface ProfileEditorProps {
  editChild?: ChildProfile | null; // null = create mode
  onSave: (child: ChildProfile) => void;
  onCancel: () => void;
  isNightMode: boolean;
}

const TOPIC_SUGGESTIONS = [
  { id: 'share', name: 'Chia sẻ', icon: '🤝' },
  { id: 'brave', name: 'Dũng cảm', icon: '🦁' },
  { id: 'honest', name: 'Trung thực', icon: '⭐' },
  { id: 'kind', name: 'Tốt bụng', icon: '💖' },
];

export const ProfileEditor: React.FC<ProfileEditorProps> = ({
  editChild, onSave, onCancel, isNightMode,
}) => {
  const isEdit = !!editChild;
  const [childName, setChildName] = useState(editChild?.childName || '');
  const [age, setAge] = useState<AgeGroup>(editChild?.age || 4);
  const [gender, setGender] = useState<GenderOption>((editChild?.gender as GenderOption) || 'unspecified');
  const [interests, setInterests] = useState(editChild?.interests || '');
  const [preferredCharacters, setPreferredCharacters] = useState(editChild?.preferredCharacters || '');
  const [bedtimeGoal, setBedtimeGoal] = useState(editChild?.bedtimeGoal || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!childName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        child_name: childName.trim(),
        age,
        gender: gender !== 'unspecified' ? gender : undefined,
        interests: interests.trim() || undefined,
        preferred_characters: preferredCharacters.trim() || undefined,
        bedtime_goal: bedtimeGoal.trim() || undefined,
      };
      if (isEdit && editChild) {
        const updated = await childClient.update(editChild.childId, payload);
        onSave({ ...updated, interests: payload.interests, preferredCharacters: payload.preferred_characters, bedtimeGoal: payload.bedtime_goal });
      } else {
        const created = await childClient.create(payload);
        onSave(created);
      }
    } catch (err) {
      console.error('Failed to save profile', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto py-4 animate-fadeIn space-y-5">
      <button onClick={onCancel} className={`inline-flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors cursor-pointer ${
        isNightMode ? 'bg-slate-800/80 hover:bg-slate-700 text-slate-300' : 'bg-amber-100/80 hover:bg-amber-200/60 text-amber-900'
      }`}>
        <ArrowLeft className="w-4 h-4" />
        <span>Trở về</span>
      </button>

      <h2 className="text-2xl font-extrabold flex items-center gap-2">
        <Sparkles className="w-6 h-6 text-amber-400" />
        <span>{isEdit ? 'Sửa hồ sơ' : 'Thêm hồ sơ mới'}</span>
      </h2>

      <form onSubmit={handleSubmit} className={`p-5 rounded-3xl border space-y-5 ${
        isNightMode ? 'bg-slate-800/80 border-slate-700/80' : 'bg-white border-amber-200/80'
      }`}>
        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-sm font-bold">Tên bé <span className="text-rose-500">*</span></label>
          <input value={childName} onChange={e => setChildName(e.target.value)}
            className={`w-full px-4 py-3 rounded-2xl text-sm border focus:outline-none focus:ring-2 ${
              isNightMode ? 'bg-slate-900 border-slate-700' : 'bg-amber-50/50 border-amber-200'
            }`} />
        </div>

        {/* Age */}
        <div className="space-y-1.5">
          <label className="text-sm font-bold">Tuổi</label>
          <div className="grid grid-cols-4 gap-2">
            {([3, 4, 5, 6] as AgeGroup[]).map(a => (
              <button type="button" key={a} onClick={() => setAge(a)}
                className={`py-3 rounded-2xl text-sm font-bold border transition-all cursor-pointer ${
                  age === a ? 'bg-indigo-600 border-indigo-600 text-white' : isNightMode
                    ? 'bg-slate-900/60 border-slate-700' : 'bg-amber-50/60 border-amber-200'
                }`}>{a} tuổi</button>
            ))}
          </div>
        </div>

        {/* Gender */}
        <div className="space-y-1.5">
          <label className="text-sm font-bold">Giới tính</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: 'unspecified' as const, label: 'Chưa chọn' },
              { value: 'boy' as const, label: 'Bé trai 👦' },
              { value: 'girl' as const, label: 'Bé gái 👧' },
            ].map(g => (
              <button type="button" key={g.value} onClick={() => setGender(g.value)}
                className={`py-2 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                  gender === g.value ? 'bg-indigo-600 border-indigo-600 text-white' : isNightMode
                    ? 'bg-slate-900/60 border-slate-700' : 'bg-amber-50/60 border-amber-200'
                }`}>{g.label}</button>
            ))}
          </div>
        </div>

        {/* Interests */}
        <div className="space-y-1.5">
          <label className="text-sm font-bold">Sở thích</label>
          <input value={interests} onChange={e => setInterests(e.target.value)} placeholder="Thích khủng long, công chúa, tàu hỏa..."
            className={`w-full px-4 py-3 rounded-2xl text-sm border focus:outline-none ${
              isNightMode ? 'bg-slate-900 border-slate-700' : 'bg-amber-50/50 border-amber-200'
            }`} />
        </div>

        {/* Preferred Characters */}
        <div className="space-y-1.5">
          <label className="text-sm font-bold">Nhân vật yêu thích</label>
          <input value={preferredCharacters} onChange={e => setPreferredCharacters(e.target.value)} placeholder="Gấu Pooh, Thỏ Bông..."
            className={`w-full px-4 py-3 rounded-2xl text-sm border focus:outline-none ${
              isNightMode ? 'bg-slate-900 border-slate-700' : 'bg-amber-50/50 border-amber-200'
            }`} />
        </div>

        {/* Bedtime goal */}
        <div className="space-y-1.5">
          <label className="text-sm font-bold">Bài học muốn gửi gắm</label>
          <div className="flex flex-wrap gap-2">
            {TOPIC_SUGGESTIONS.map(item => (
              <button type="button" key={item.id} onClick={() => setBedtimeGoal(item.name)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                  bedtimeGoal === item.name ? 'bg-indigo-600 border-indigo-600 text-white' : isNightMode
                    ? 'bg-slate-900/60 border-slate-700' : 'bg-amber-50/60 border-amber-200'
                }`}>
                <span>{item.icon} {item.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button type="submit" disabled={saving || !childName.trim()}
          className="w-full py-4 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer">
          <Save className="w-4 h-4" />
          <span>{saving ? 'Đang lưu...' : isEdit ? 'Cập nhật' : 'Thêm bé'}</span>
        </button>
      </form>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add FE/src/components/ProfileEditor.tsx
git commit -m "feat: ProfileEditor component for create/edit child profiles"
```

---

### Task 3C.3: FE — ProfileManager screen

**Files:**
- Create: `FE/src/components/ProfileManager.tsx`

**Interfaces:**
- Consumes: `ChildProfile[]`, `activeChild`, callbacks
- Produces: Grid list of all children with edit/delete actions

- [ ] **Step 1: Create ProfileManager component**

```typescript
// FE/src/components/ProfileManager.tsx
import React, { useState } from 'react';
import { ArrowLeft, Pencil, Trash2, Sparkles, Plus, UserPlus } from 'lucide-react';
import { ChildProfile } from '../types';
import { childClient } from '../utils/childClient';
import { ProfileEditor } from './ProfileEditor';

const AVATAR_COLORS = [
  { bg: 'bg-indigo-500', text: 'text-white' },
  { bg: 'bg-emerald-500', text: 'text-white' },
  { bg: 'bg-rose-500', text: 'text-white' },
  { bg: 'bg-amber-500', text: 'text-slate-900' },
  { bg: 'bg-cyan-500', text: 'text-white' },
  { bg: 'bg-violet-500', text: 'text-white' },
];

function getAvatarColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitial(name: string) { return name.charAt(0).toUpperCase(); }

interface ProfileManagerProps {
  children: ChildProfile[];
  activeChild: ChildProfile | null;
  onSelectChild: (child: ChildProfile) => void;
  onUpdate: (children: ChildProfile[]) => void;
  onBack: () => void;
  isNightMode: boolean;
}

export const ProfileManager: React.FC<ProfileManagerProps> = ({
  children, activeChild, onSelectChild, onUpdate, onBack, isNightMode,
}) => {
  const [editingChild, setEditingChild] = useState<ChildProfile | null | 'new'>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleEdit = (child: ChildProfile) => setEditingChild(child);
  const handleAddNew = () => setEditingChild('new');

  const handleSave = (saved: ChildProfile) => {
    if (editingChild === 'new') {
      onUpdate([...children, saved]);
    } else {
      onUpdate(children.map(c => c.childId === saved.childId ? { ...c, ...saved } : c));
    }
    setEditingChild(null);
  };

  const handleDelete = async (child: ChildProfile) => {
    if (!confirm(`Xóa hồ sơ của bé ${child.childName}?`)) return;
    setDeleting(child.childId);
    try {
      await childClient.delete(child.childId);
      const updated = children.filter(c => c.childId !== child.childId);
      onUpdate(updated);
      if (activeChild?.childId === child.childId) onSelectChild(null as any);
    } catch {
      alert('Xóa thất bại. Vui lòng thử lại.');
    } finally {
      setDeleting(null);
    }
  };

  if (editingChild) {
    return (
      <ProfileEditor
        editChild={editingChild === 'new' ? null : editingChild}
        onSave={handleSave}
        onCancel={() => setEditingChild(null)}
        isNightMode={isNightMode}
      />
    );
  }

  return (
    <div className="max-w-lg mx-auto py-4 animate-fadeIn space-y-5">
      <button onClick={onBack} className={`inline-flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors cursor-pointer ${
        isNightMode ? 'bg-slate-800/80 hover:bg-slate-700 text-slate-300' : 'bg-amber-100/80 hover:bg-amber-200/60 text-amber-900'
      }`}>
        <ArrowLeft className="w-4 h-4" /><span>Trở về</span>
      </button>

      <h2 className="text-2xl font-extrabold flex items-center gap-2">
        <Sparkles className="w-6 h-6 text-amber-400" />
        <span>Trang các bé</span>
      </h2>

      <div className="space-y-3">
        {children.length === 0 && (
          <div className="text-center py-10 opacity-70">
            <UserPlus className="w-12 h-12 mx-auto mb-3" />
            <p className="font-semibold">Chưa có hồ sơ bé nào</p>
            <p className="text-xs mt-1">Thêm hồ sơ đầu tiên để bắt đầu!</p>
          </div>
        )}
        {children.map(child => {
          const color = getAvatarColor(child.childId);
          const isActive = activeChild?.childId === child.childId;
          return (
            <div key={child.childId} className={`p-4 rounded-2xl border flex items-center gap-3 ${
              isNightMode ? 'bg-slate-800/80 border-slate-700' : 'bg-white border-amber-200'
            }`}>
              <div className={`w-12 h-12 rounded-full ${color.bg} ${color.text} flex items-center justify-center font-bold text-xl shrink-0`}>
                {getInitial(child.childName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold flex items-center gap-2">
                  <span>{child.childName}</span>
                  {isActive && <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-600 text-white">ĐANG DÙNG</span>}
                </div>
                <p className="text-xs opacity-70">{child.age} tuổi</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleEdit(child)} disabled={deleting === child.childId}
                  className="p-2 rounded-xl hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50">
                  <Pencil className="w-4 h-4 opacity-60" />
                </button>
                <button onClick={() => handleDelete(child)} disabled={deleting === child.childId}
                  className="p-2 rounded-xl hover:bg-rose-500/10 text-rose-500 transition-colors cursor-pointer disabled:opacity-50">
                  {deleting === child.childId ? <span className="text-xs">...</span> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {children.length > 0 && (
        <button onClick={handleAddNew} className={`w-full py-3.5 rounded-2xl text-sm font-bold border-2 border-dashed flex items-center justify-center gap-2 transition-colors cursor-pointer ${
          isNightMode ? 'border-slate-600 text-slate-300 hover:border-indigo-500' : 'border-amber-300 text-amber-800 hover:border-indigo-400'
        }`}>
          <Plus className="w-4 h-4" /><span>Thêm hồ sơ mới</span>
        </button>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add FE/src/components/ProfileManager.tsx
git commit -m "feat: ProfileManager screen with edit/delete child profiles"
```

---

### Task 3C.4: FE — Wire ProfileManager into App.tsx

**Files:**
- Modify: `FE/src/App.tsx`

**Interfaces:**
- Consumes: `ProfileManager` component
- Produces: 'profile' screen shows ProfileManager, can add/edit/delete children

- [ ] **Step 1: Add import**

```typescript
// FE/src/App.tsx — add import
import { ProfileManager } from './components/ProfileManager';
```

- [ ] **Step 2: Add profile screen rendering**

```typescript
// In the main container, before the SavedStoriesModal:
{currentScreen === 'profile' && (
  <ProfileManager
    children={children}
    activeChild={activeChild}
    onSelectChild={handleSelectChild}
    onUpdate={setChildren}
    onBack={() => setCurrentScreen('home')}
    isNightMode={isNightMode}
  />
)}
```

- [ ] **Step 3: Wire ChildSelector onAddNew/onEdit to navigate to 'profile'**

The ChildSelector onAddNew and onEdit are already pointing to `setCurrentScreen('profile')` from 3A.8. Ensure handleSelectChild handles null (when active child is deleted):

```typescript
// Update handleSelectChild signature
const handleSelectChild = (child: ChildProfile | null) => {
  setActiveChild(child);
};
```

- [ ] **Step 4: Commit**

```bash
git add FE/src/App.tsx
git commit -m "feat: wire ProfileManager screen into App.tsx"
```

---

### Task 3C.5: FE — Block child switch mid-story

**Files:**
- Modify: `FE/src/App.tsx`

**Interfaces:**
- Consumes: `currentScreen` state
- Produces: Alert when trying to switch child while on story/feedback screen

- [ ] **Step 1: Update handleSelectChild with block logic**

```typescript
// FE/src/App.tsx — replace handleSelectChild
const handleSelectChild = (child: ChildProfile | null) => {
  if (currentScreen !== 'home' && currentScreen !== 'form' && currentScreen !== 'profile') {
    alert('Đang đọc/xem truyện. Về trang chủ để chọn bé khác.');
    return;
  }
  setActiveChild(child);
};
```

- [ ] **Step 2: Commit**

```bash
git add FE/src/App.tsx
git commit -m "feat: block child switch mid-story"
```

---

### Task 3C.6: FE — Offline indicator when BE unreachable

**Files:**
- Modify: `FE/src/components/Header.tsx`

**Interfaces:**
- Consumes: `isOffline: boolean` prop
- Produces: Small "Đang ngoại tuyến" badge in header

- [ ] **Step 1: Add isOffline state to App.tsx + pass to Header**

```typescript
// FE/src/App.tsx — track offline status
const [isOffline, setIsOffline] = useState(false);

// In the fetch children useEffect catch:
.catch(() => { setIsOffline(true); ... })
```

- [ ] **Step 2: Update Header props + render badge**

```typescript
// FE/src/components/Header.tsx — add prop
interface HeaderProps {
  // ...existing...
  isOffline?: boolean;
}

// In header, near the theme toggle:
{isOffline && (
  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-semibold">
    📡 Ngoại tuyến
  </span>
)}
```

- [ ] **Step 3: Commit**

```bash
git add FE/src/App.tsx FE/src/components/Header.tsx
git commit -m "feat: offline indicator in header when BE unreachable"
```

---

### Task 3C.7: FE — Auto-open ChildSelector when no children exist

**Files:**
- Modify: `FE/src/App.tsx`

**Interfaces:**
- Consumes: `children.length === 0`
- Produces: Auto-open ChildSelector on form screen when no children exist

- [ ] **Step 1: Add useEffect to auto-open**

```typescript
// FE/src/App.tsx — add after children fetch useEffect
useEffect(() => {
  if (children.length === 0 && currentScreen === 'form') {
    setIsChildSelectorOpen(true);
  }
}, [children.length, currentScreen]);
```

- [ ] **Step 2: Show empty state in FormScreen when no children**

The empty state text "Thêm hồ sơ mới" already exists in ChildSelector. The auto-open handles the first-time flow.

- [ ] **Step 3: Commit**

```bash
git add FE/src/App.tsx
git commit -m "feat: auto-open ChildSelector when no children exist"
```

---

### Task 3C.8: BE test — Verify findByTenant excludes inactive profiles

**Files:**
- Modify: `BE/src/modules/child/__tests__/child.service.spec.ts` (add test)

- [ ] **Step 1: Write test**

```typescript
// BE/src/modules/child/__tests__/child.service.spec.ts — add
it('should exclude inactive profiles from findByTenant', async () => {
  const p = await service.getOrCreate('tenant-1', { child_name: 'InactiveTest', age: 5 } as any);
  await service.delete(p.childId, 'tenant-1');
  const activeProfiles = await service.findByTenant('tenant-1');
  expect(activeProfiles.find(c => c.childId === p.childId)).toBeUndefined();
});
```

- [ ] **Step 2: Run test**

Run: `cd BE && npx jest src/modules/child/__tests__/child.service.spec.ts -v -t "exclude inactive"`

- [ ] **Step 3: Commit**

```bash
git add BE/src/modules/child/__tests__/child.service.spec.ts
git commit -m "test: verify findByTenant excludes inactive profiles"
```

---

## Summary

| Phase | Tasks | Files Touched | Focus |
|---|---|---|---|
| 3A | 8 | ~10 files | Child selection UX, pre-fill, Header avatar |
| 3B | 2 | ~2 files | Per-child story history filtering |
| 3C | 8 | ~8 files | Profile management screen, soft-delete, edge cases |
| **Total** | **18** | **~20 files** | |

Each task follows: Test → Implement → Test → Commit