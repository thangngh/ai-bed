# Vietnamese Typeface (Be Vietnam Pro) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Be Vietnam Pro as a self-hosted webfont so the SPA renders Vietnamese diacritics correctly and identically on every device.

**Architecture:** Five static `woff2` weights are committed under `FE/public/fonts/` and declared with `@font-face` in `FE/src/index.css`. A single Tailwind v4 `@theme` override of `--font-sans` propagates the family to the entire document through preflight, so no React component is touched. One preload tag and one nginx cache rule handle delivery. Two filesystem tests guard the two failure modes that are otherwise silent.

**Tech Stack:** React 19, Tailwind CSS v4 (CSS-first config), Vite 6, Vitest 4 (jsdom), nginx.

**Spec:** `docs/superpowers/specs/2026-08-05-vietnamese-font-design.md`

## Global Constraints

- Typeface: **Be Vietnam Pro**, SIL Open Font License 1.1, no Reserved Font Name.
- Copyright line to reproduce verbatim: `Copyright 2021 The Be Vietnam Pro Project Authors (https://github.com/bettergui/BeVietnamPro)`
- Weights: **400, 500, 600, 700, 800**. Upright only — no italic, no other weights.
- Charsets: **`latin` + `vietnamese`**. `latin-ext` is not used.
- Format: **`woff2`** only.
- Font version segment in filenames: **`v12`** (confirm at download; it appears in every filename and `nginx` `immutable` caching depends on it).
- Test files must match `src/**/*.test.{ts,tsx}` — `FE/vitest.config.ts` collects nothing else. A `.spec.ts` file would never run.
- No npm dependency may be added.
- No file under `FE/src/components/` may be modified.
- All commands run from the `FE/` directory unless stated otherwise.

## File Structure

| File | Responsibility |
|---|---|
| `FE/public/fonts/*.woff2` | The five font binaries. Served as static assets, not bundled. |
| `FE/public/fonts/OFL.txt` | License text + copyright. Published at `/fonts/OFL.txt`. |
| `FE/src/index.css` | Sole owner of `@font-face` declarations and the `--font-sans` override. |
| `FE/index.html` | One `preload` hint for the critical weight. |
| `FE/nginx.conf` | Cache policy for `/fonts/` in production. |
| `FE/README.md` | Attribution section. |
| `FE/src/test/fonts.test.ts` | Guards asset presence, CSS↔file integrity, preload correctness, and license presence. |

---

### Task 1: Font binaries and license in the repo

Downloads the five weights, places the license beside them, and adds the tests that keep both from disappearing.

**Files:**
- Create: `FE/public/fonts/be-vietnam-pro-v12-latin_vietnamese-regular.woff2` (and 500/600/700/800)
- Create: `FE/public/fonts/OFL.txt`
- Create: `FE/src/test/fonts.test.ts`
- Modify: `FE/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: five files in `FE/public/fonts/` whose exact names Task 2 references from CSS and Task 3 references from HTML. The naming pattern is `be-vietnam-pro-v12-latin_vietnamese-{variant}.woff2` where `{variant}` is one of `regular`, `500`, `600`, `700`, `800`. **Step 4 records the real names — later tasks must use those, not this pattern.**
- Produces: `FE/src/test/fonts.test.ts` exporting nothing; Tasks 2 and 3 append `describe` blocks to it.

- [ ] **Step 1: Write the failing test**

Create `FE/src/test/fonts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// These tests read the repository, not the DOM. They exist because a missing
// or misnamed font file produces no error anywhere in the toolchain: `tsc
// --noEmit` is silent, `vite build` is silent, and the page merely falls back
// to a system font -- which looks plausible enough to ship unnoticed.
const FONTS_DIR = join(process.cwd(), 'public', 'fonts');

const WEIGHTS = ['regular', '500', '600', '700', '800'] as const;

describe('font assets', () => {
  it('ships one woff2 per required weight', () => {
    const files = existsSync(FONTS_DIR) ? readdirSync(FONTS_DIR) : [];
    const woff2 = files.filter((f) => f.endsWith('.woff2'));

    for (const weight of WEIGHTS) {
      const match = woff2.filter((f) => f.endsWith(`-${weight}.woff2`));
      expect(match, `expected exactly one woff2 for weight "${weight}", got ${JSON.stringify(match)}`).toHaveLength(1);
    }
    expect(woff2, 'no extra weights should be shipped').toHaveLength(WEIGHTS.length);
  });

  it('ships only the latin+vietnamese charset build', () => {
    const woff2 = readdirSync(FONTS_DIR).filter((f) => f.endsWith('.woff2'));
    for (const file of woff2) {
      expect(file, `${file} must be the merged latin_vietnamese build`).toContain('latin_vietnamese');
    }
  });
});

describe('OFL compliance', () => {
  it('publishes the license beside the fonts', () => {
    expect(existsSync(join(FONTS_DIR, 'OFL.txt'))).toBe(true);
  });

  it('reproduces the copyright line verbatim', () => {
    const text = readFileSync(join(FONTS_DIR, 'OFL.txt'), 'utf8');
    expect(text).toContain(
      'Copyright 2021 The Be Vietnam Pro Project Authors (https://github.com/bettergui/BeVietnamPro)',
    );
    expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fonts`
Expected: FAIL. `ships one woff2 per required weight` reports an empty array; `publishes the license beside the fonts` gets `false`.

If instead you see `No test files found`, the filename or location is wrong — it must be `FE/src/test/fonts.test.ts` to match `include: ['src/**/*.test.{ts,tsx}']`.

- [ ] **Step 3: Download the fonts**

From the repository root, in PowerShell:

```powershell
$url = 'https://gwfh.mranftl.com/api/fonts/be-vietnam-pro?download=zip&subsets=latin,vietnamese&variants=regular,500,600,700,800&formats=woff2'
$zip = Join-Path $env:TEMP 'be-vietnam-pro.zip'
Invoke-WebRequest -Uri $url -OutFile $zip
New-Item -ItemType Directory -Force FE\public\fonts | Out-Null
Expand-Archive -Path $zip -DestinationPath FE\public\fonts -Force
Remove-Item $zip
Get-ChildItem FE\public\fonts | Select-Object Name, Length
```

- [ ] **Step 4: Record the real filenames**

Read the `Get-ChildItem` output from Step 3. Expect five `.woff2` files named
`be-vietnam-pro-v12-latin_vietnamese-{regular,500,600,700,800}.woff2`.

**If the version segment is not `v12`,** the upstream font was republished. Use
the actual segment consistently in Tasks 2 and 3, and update the spec's
`Global Constraints` note. Do not rename the files — the version in the name is
what makes the `immutable` cache header in Task 3 safe.

Copy the exact five filenames somewhere you can paste from; Tasks 2 and 3 need
them character-for-character.

- [ ] **Step 5: Add the license file**

Download the license text verbatim from upstream:

```powershell
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/google/fonts/main/ofl/bevietnampro/OFL.txt' -OutFile FE\public\fonts\OFL.txt
Get-Content FE\public\fonts\OFL.txt -TotalCount 3
```

Expected first line: `Copyright 2021 The Be Vietnam Pro Project Authors (https://github.com/bettergui/BeVietnamPro)`

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- fonts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Add attribution to the FE README**

Append to `FE/README.md`:

```markdown
## Typeface

The SPA ships [Be Vietnam Pro](https://github.com/bettergui/BeVietnamPro),
self-hosted from `public/fonts/`. It is the one face in the shortlist designed
for Vietnamese from the outset: its diacritics are drawn per combination rather
than stacked mechanically, which is what keeps `ế ữ ặ` legible at the `text-2xl`
size the story screen offers.

- **Copyright** 2021 The Be Vietnam Pro Project Authors
- **License** SIL Open Font License 1.1 — full text at `public/fonts/OFL.txt`,
  served publicly at `/fonts/OFL.txt`
- **Source** google-webfonts-helper, charsets `latin` + `vietnamese`, weights
  400/500/600/700/800, `woff2`

The OFL is copyleft over the font files only. It places no obligation on this
repository's source: *"The requirement for fonts to remain under this license
does not apply to any document created using the fonts or their derivatives."*

Be Vietnam Pro declares **no Reserved Font Name**, so the subset files keep the
original family name without a rename.
```

- [ ] **Step 8: Commit**

```bash
git add FE/public/fonts FE/src/test/fonts.test.ts FE/README.md
git commit -m "feat(fe): ship Be Vietnam Pro self-hosted, with the license beside it

Five upright weights, latin+vietnamese charsets, woff2. Nothing renders with
them yet -- this is the asset and its license landing in the repo.

The tests guard the two things that fail silently: a missing weight and a
deleted OFL.txt. Neither tsc nor vite build would say a word about either."
```

---

### Task 2: Declare the faces and flip the family

The change that actually alters what users see. One `@theme` line reaches every screen.

**Files:**
- Modify: `FE/src/index.css`
- Modify: `FE/src/test/fonts.test.ts` (append one `describe` block)

**Interfaces:**
- Consumes: the five filenames recorded in Task 1 Step 4.
- Produces: `--font-sans` resolving to `"Be Vietnam Pro", ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif` for the whole document. Task 3 relies on `index.css` containing a `url()` for the regular weight.

- [ ] **Step 1: Write the failing test**

Append to `FE/src/test/fonts.test.ts`:

```typescript
describe('index.css font wiring', () => {
  const css = () => readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

  it('declares one @font-face per required weight', () => {
    const source = css();
    const faces = source.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(WEIGHTS.length);

    const declared = faces
      .map((face) => face.match(/font-weight:\s*(\d+)/)?.[1])
      .sort();
    expect(declared).toEqual(['400', '500', '600', '700', '800']);
  });

  it('points every url() at a file that exists', () => {
    const urls = [...css().matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
    expect(urls.length, 'expected at least one url() in index.css').toBeGreaterThan(0);

    for (const url of urls) {
      // Served from public/, so a leading /fonts/ maps to public/fonts/.
      const onDisk = join(process.cwd(), 'public', url.replace(/^\//, ''));
      expect(existsSync(onDisk), `${url} is referenced by index.css but ${onDisk} does not exist`).toBe(true);
    }
  });

  it('swaps rather than hiding text while the font loads', () => {
    const faces = css().match(/@font-face\s*\{[^}]*\}/g) ?? [];
    for (const face of faces) {
      expect(face, 'every @font-face needs font-display: swap').toMatch(/font-display:\s*swap/);
    }
  });

  it('overrides the Tailwind sans stack', () => {
    const source = css();
    expect(source).toMatch(/@theme\s*\{[^}]*--font-sans:[^;]*"Be Vietnam Pro"/s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fonts`
Expected: FAIL, 4 new failures. `declares one @font-face per required weight` reports `[]` with length 0.

- [ ] **Step 3: Write the CSS**

Replace the contents of `FE/src/index.css`. Substitute the filenames recorded in Task 1 Step 4 if they differ:

```css
@import "tailwindcss";

/* Be Vietnam Pro, self-hosted from public/fonts. See FE/README.md for the
   license and why this face was chosen over Lexend and Inter.

   `swap` and not `optional`: the app exists to be read aloud, so a brief
   reflow when the webfont arrives beats a paragraph that never renders in it
   on a slow connection. */

@font-face {
  font-family: "Be Vietnam Pro";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/be-vietnam-pro-v12-latin_vietnamese-regular.woff2") format("woff2");
}

@font-face {
  font-family: "Be Vietnam Pro";
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url("/fonts/be-vietnam-pro-v12-latin_vietnamese-500.woff2") format("woff2");
}

@font-face {
  font-family: "Be Vietnam Pro";
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url("/fonts/be-vietnam-pro-v12-latin_vietnamese-600.woff2") format("woff2");
}

@font-face {
  font-family: "Be Vietnam Pro";
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("/fonts/be-vietnam-pro-v12-latin_vietnamese-700.woff2") format("woff2");
}

@font-face {
  font-family: "Be Vietnam Pro";
  font-style: normal;
  font-weight: 800;
  font-display: swap;
  src: url("/fonts/be-vietnam-pro-v12-latin_vietnamese-800.woff2") format("woff2");
}

/* Tailwind v4 preflight sets font-family on `html` from --default-font-family,
   which resolves to --font-sans. Overriding this one variable therefore reaches
   every screen and every font-bold/semibold/medium/extrabold utility already in
   the codebase -- which is why no component file changes.

   The fallback chain is what renders during the swap window and if the font
   request fails outright; every entry handles Vietnamese acceptably. */
@theme {
  --font-sans: "Be Vietnam Pro", ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- fonts`
Expected: PASS, 8 tests.

If `points every url() at a file that exists` fails, a filename in the CSS does
not match what Task 1 downloaded. Fix the CSS to match the disk — never rename
the downloaded files.

- [ ] **Step 5: Verify the build and the full suite**

Run: `npm run lint`
Expected: no output (clean `tsc --noEmit`).

Run: `npm run build`
Expected: build succeeds. Confirm the fonts reached the output:

```powershell
Get-ChildItem dist\fonts | Select-Object Name
```

Expected: the five `.woff2` files plus `OFL.txt`.

Run: `npm test`
Expected: the whole suite passes, including the pre-existing component tests.

- [ ] **Step 6: Commit**

```bash
git add FE/src/index.css FE/src/test/fonts.test.ts
git commit -m "feat(fe): render the app in Be Vietnam Pro via one --font-sans override

Tailwind v4 preflight takes html's font-family from --default-font-family,
which resolves to --font-sans. Overriding that single variable reaches all 123
existing weight utilities and the story body, so no component changes.

The url()-resolves test is the only thing standing between a typo'd filename
and a silent fallback to Segoe UI that looks fine in review."
```

---

### Task 3: Delivery — preload the critical weight, cache the rest

**Files:**
- Modify: `FE/index.html`
- Modify: `FE/nginx.conf`
- Modify: `FE/src/test/fonts.test.ts` (append one `describe` block)

**Interfaces:**
- Consumes: the regular-weight filename from Task 1 Step 4; `index.css` from Task 2.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing test**

Append to `FE/src/test/fonts.test.ts`:

```typescript
describe('font delivery', () => {
  it('preloads exactly one weight, and it exists on disk', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const preloads = [...html.matchAll(/<link[^>]*rel=["']preload["'][^>]*>/g)].map((m) => m[0]);

    // More than one competes with the JS bundle for bandwidth on the critical
    // path, which delays first paint instead of helping it.
    expect(preloads).toHaveLength(1);

    const tag = preloads[0];
    expect(tag, 'fonts are fetched in CORS mode; without crossorigin the browser downloads the file twice').toContain('crossorigin');
    expect(tag).toContain('as="font"');
    expect(tag).toContain('type="font/woff2"');

    const href = tag.match(/href=["']([^"']+)["']/)?.[1];
    expect(href, 'preload tag needs an href').toBeDefined();
    expect(href).toContain('regular');

    const onDisk = join(process.cwd(), 'public', href!.replace(/^\//, ''));
    expect(existsSync(onDisk), `preloaded ${href} does not exist at ${onDisk}`).toBe(true);
  });

  it('caches /fonts/ immutably in production', () => {
    const conf = readFileSync(join(process.cwd(), 'nginx.conf'), 'utf8');
    expect(conf).toMatch(/location\s+\/fonts\/\s*\{/);
    expect(conf).toMatch(/Cache-Control[^;]*immutable/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fonts`
Expected: FAIL, 2 new failures. `preloads exactly one weight` gets `[]`; `caches /fonts/ immutably` finds no `location /fonts/`.

- [ ] **Step 3: Add the preload tag**

In `FE/index.html`, insert immediately after the `<meta name="description" ...>` line:

```html
    <!-- Weight 400 is what the story body needs first. Exactly one preload:
         more would contend with the JS bundle on the critical path. The
         crossorigin attribute is mandatory even same-origin, because fonts are
         fetched in CORS mode -- omit it and the file downloads twice. -->
    <link rel="preload" as="font" type="font/woff2" crossorigin
          href="/fonts/be-vietnam-pro-v12-latin_vietnamese-regular.woff2" />
```

- [ ] **Step 4: Add the nginx cache rule**

In `FE/nginx.conf`, insert before the `location / {` block:

```nginx
    # The version segment in each filename (`-v12-`) is what makes `immutable`
    # safe: a new font release means a new name, never an overwrite of a file
    # already cached by a client. Files under public/ bypass Vite's content
    # hashing, so this rule is the only cache policy they get.
    location /fonts/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- fonts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Verify nginx accepts the config**

From the repository root:

```powershell
docker compose build frontend
docker compose up -d frontend
docker compose exec frontend nginx -t
```

Expected: `syntax is ok` / `test is successful`.

Then confirm the header is actually served:

```powershell
docker compose exec frontend curl -sI http://localhost/fonts/be-vietnam-pro-v12-latin_vietnamese-regular.woff2
```

Expected: `HTTP/1.1 200 OK` and `Cache-Control: public, max-age=31536000, immutable`.

If the status is 404, the font did not reach `dist/` — re-check Task 2 Step 5.

- [ ] **Step 7: Commit**

```bash
git add FE/index.html FE/nginx.conf FE/src/test/fonts.test.ts
git commit -m "perf(fe): preload the story weight, cache /fonts/ immutably

One preload, not five -- the other four would fight the JS bundle for the
critical path. crossorigin is there because fonts fetch in CORS mode and its
absence costs a second download of the same file.

nginx set no cache header on anything before this. public/ bypasses Vite's
content hashing, so /fonts/ leans on the -v12- segment in the filename instead."
```

---

### Task 4: Verify the diacritics by eye

The acceptance gate. Everything automated so far proves the files are wired up; none of it proves the marks render correctly, which was the entire point.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-vietnamese-font-design.md` (status line only)

**Interfaces:**
- Consumes: the running app from Tasks 1–3.
- Produces: nothing.

- [ ] **Step 1: Run the app**

```powershell
cd FE
npm run dev
```

Open `http://localhost:3000`. Generate or open a story so `StoryViewScreen` is on screen.

- [ ] **Step 2: Confirm the font is actually applied**

In DevTools, select a paragraph of story text → Computed → `font-family`.
Expected: `Be Vietnam Pro` is first and **Rendered Fonts** at the bottom of the
Computed pane shows `Be Vietnam Pro`, not `Segoe UI`.

This step exists because every automated test so far checks the repository, not
the browser. If Rendered Fonts shows a system font, stop — the `@theme`
override is not reaching `html`.

- [ ] **Step 3: Walk the diacritic checklist**

Toggle the font-size control to `Cỡ lớn` then `Cỡ rất lớn`, and check each item
in **both** light and night mode:

- [ ] Stacked marks clear and unclipped: `ế ề ể ễ ệ ố ồ ổ ỗ ộ ứ ừ ử ữ ự ặ ẳ ẵ`
- [ ] Horn letters distinct from their bases: `ơ ư` vs `o u`
- [ ] `đ` and `Đ` keep the crossbar
- [ ] Capitals with marks not clipped by the line box: `Ế Ộ Ữ Ặ`
- [ ] Marks do not collide with descenders of the line above at `leading-relaxed`
- [ ] The `₫` sign renders (it lives in the `vietnamese` charset — if it shows a
      tofu box, the wrong charset was downloaded)

Fastest way to see all of them at once: paste the checklist strings into the
story title field on the form screen, or temporarily set a paragraph's text in
DevTools.

- [ ] **Step 4: Confirm no flash of invisible text**

In DevTools → Network, throttle to `Slow 4G` and hard-reload.
Expected: text appears immediately in the fallback face, then swaps to Be
Vietnam Pro. Text must never be invisible — that would mean `font-display` is
not `swap`.

- [ ] **Step 5: Mark the spec delivered**

In `docs/superpowers/specs/2026-08-05-vietnamese-font-design.md`, change the
status line from `> **Status:** Approved` to `> **Status:** Implemented`.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-05-vietnamese-font-design.md
git commit -m "docs(spec): mark the Vietnamese typeface design implemented

Diacritics verified by eye at text-xl and text-2xl in both themes -- the one
property no test in this change could assert."
```

---

## Notes for the implementer

**Two spec deviations were already corrected before this plan was written**, so
the spec and plan agree. Do not be surprised by them:

1. The spec originally placed the tests at `FE/src/__tests__/fonts.spec.ts`.
   `FE/vitest.config.ts` sets `include: ['src/**/*.test.{ts,tsx}']`, so that
   file would have been collected by nothing and passed forever without
   running. The tests live at `FE/src/test/fonts.test.ts`.
2. The spec's illustrative filenames used `v11`. The published version is `v12`.

**The TTS block in `FE/src/components/StoryViewScreen.tsx` stays commented out.**
It is unrelated paused work and is out of scope here. Note that it is currently
an **uncommitted working-tree change** — leave it alone rather than folding it
into any commit in this plan.

**If a font file needs replacing later,** change the filename too. The nginx
`immutable` header tells every client to never revalidate for a year, so
overwriting a served filename strands users on the old file.
