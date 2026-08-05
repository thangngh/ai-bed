# Vietnamese Typeface for the SPA — Design

> **Date:** 2026-08-05
> **Status:** Approved
> **Scope:** FE only (React 19 + Tailwind v4 + nginx). No BE or Engine change.

---

## 1. Problem

`FE/src/index.css` contains one line — `@import "tailwindcss"` — and `FE/index.html`
loads no font. The app therefore renders in Tailwind v4's default `--font-sans`
stack, which resolves to whatever the operating system supplies: Segoe UI on
Windows, Roboto on Android, SF Pro on iOS.

Three consequences:

1. **The product looks different on every device.** Nothing about the typography
   is a decision; it is a side effect of the visitor's OS.
2. **Stacked Vietnamese diacritics render poorly at the sizes this app uses.**
   `StoryViewScreen` offers a font-size toggle up to `text-2xl` with
   `leading-loose`, and Segoe UI crowds marks such as `ế`, `ữ`, `ặ` at those sizes.
3. **Reading happens in a dark room.** The primary use is a parent reading aloud
   at bedtime with night mode on — the condition under which weak letterform
   distinction hurts most.

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Audience the type serves | Parent reading aloud | Legibility outranks playfulness; the child is pre-literate |
| Typeface | **Be Vietnam Pro** | Only shortlisted face designed for Vietnamese from the start — diacritics are drawn per combination rather than mechanically stacked |
| Delivery | Self-hosted `woff2`, committed to the repo | No npm dependency added; no third-party request at runtime |
| Weights | 400, 500, 600, 700, 800 | Matches actual usage (see §4); no italic |
| Variable font | Not available | `google/fonts` ships Be Vietnam Pro as 18 static files only — verified |

### Rejected alternatives

- **Lexend** — designed around reading-proficiency research and a strong
  candidate, but its Vietnamese coverage is a later extension rather than an
  original concern, and its wide letterforms shorten lines at `text-2xl`.
- **Inter** — the safest UI face and best at `I`/`l`/`1` disambiguation, but
  reads as software chrome rather than bedtime storytelling, and its tall
  x-height compresses the space above the letter where Vietnamese marks sit.
- **Google Fonts CDN** — rejected on privacy, not licensing. Embedding
  `fonts.googleapis.com` transmits every visitor's IP to Google; LG München I
  (Jan 2022) held this to violate GDPR absent consent. The audience is children
  aged 3–6, and the deployment already routes through Cloudflare Tunnel with a
  measured egress budget (docs/11).
- **`@fontsource/be-vietnam-pro`** — ergonomic and versioned, but adds npm
  surface immediately after a supply-chain audit that flagged unpinned
  third-party artifacts.
- **Declaring `font-family` without shipping files** — effectively a no-op;
  virtually no device has Be Vietnam Pro installed.

## 3. Licensing

Be Vietnam Pro is **SIL Open Font License 1.1**, verified against
`google/fonts/ofl/bevietnampro/OFL.txt`:

```
Copyright 2021 The Be Vietnam Pro Project Authors
(https://github.com/bettergui/BeVietnamPro)
```

**No Reserved Font Name is declared.** This matters because subsetting counts as
modification under the OFL; with no RFN, the subset files may keep the original
family name and require no rename.

OFL is copyleft, but its scope ends at the font file. The license text is
explicit: *"The requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives."* The `.woff2`
files must stay OFL; the React source, the bundle, and the generated stories are
untouched by it. Nothing here obliges the project to open its source.

Three obligations follow, all satisfied in §5:

1. Ship the license text and copyright notice alongside the redistributed files.
2. Do not sell the font files on their own — not applicable.
3. Do not relicense the font files under other terms.

## 4. Weight inventory

Scanning `FE/src/**/*.{ts,tsx}` for Tailwind weight utilities:

| Utility | CSS weight | Occurrences |
|---|---|---|
| `font-bold` | 700 | 66 |
| `font-semibold` | 600 | 26 |
| `font-medium` | 500 | 18 |
| `font-extrabold` | 800 | 13 |
| *(default body text)* | 400 | — |

No `italic` utility appears anywhere, so italic faces are excluded. Five upright
weights are downloaded; nothing else.

## 5. Implementation

### 5.1 Font files

Download from google-webfonts-helper with charsets `latin` + `vietnamese`,
format `woff2`, the five weights above. Commit to `FE/public/fonts/`.

The `vietnamese` charset is what carries `U+1EA0–U+1EF9` plus `ơ ư đ ă`; `latin`
alone would break the language.

google-webfonts-helper merges the selected charsets into **one file per weight**,
named `be-vietnam-pro-{version}-latin_vietnamese-{variant}.woff2`. Five files
result, and no `unicode-range` is needed. The current published version is
**v12** — confirm it at download time rather than assuming, since the version
appears in every filename.

### 5.2 The one-line lever

`FE/src/index.css`, after the `@font-face` block:

```css
@theme {
  --font-sans: "Be Vietnam Pro", ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
}
```

Tailwind v4's preflight sets `font-family` on `html` from `--default-font-family`,
which resolves to `--font-sans`. Overriding that single variable propagates to
the whole document and to every existing weight utility, so **no component file
is modified**. This is why the change stays small despite touching every screen.

The fallback stack is what renders during the swap window and if a font request
fails; each entry handles Vietnamese acceptably.

Every `@font-face` declares `font-display: swap`. Text appears immediately in the
fallback face and is replaced when the webfont arrives. For an app whose whole
purpose is reading, a brief reflow beats invisible text.

### 5.3 Preload

One tag in `FE/index.html` — weight 400, `vietnamese` subset, the face the story
screen needs first:

```html
<link rel="preload" as="font" type="font/woff2" crossorigin
      href="/fonts/be-vietnam-pro-v12-latin_vietnamese-regular.woff2" />
```

Exactly one. Preloading all five would contend with the JS bundle for bandwidth
on the critical path and delay first paint rather than help it.

`crossorigin` is mandatory even same-origin: fonts are fetched in CORS mode, and
omitting the attribute makes the browser download the file twice.

Use the actual filename produced by the download; the `-v12-` version segment
must survive into the served name, because §5.4 depends on it.

### 5.4 Cache headers

`FE/nginx.conf` currently sets no cache header on any route. Files under
`public/` bypass Vite's content hashing, so they need an explicit rule:

```nginx
location /fonts/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

`immutable` is safe because the version segment is part of the filename:
replacing the font means introducing a new name, never overwriting a served one.

### 5.5 Attribution

- `FE/public/fonts/OFL.txt` — verbatim OFL 1.1 text with the copyright line from
  §3. Placing it beside the fonts publishes it at `/fonts/OFL.txt`, which
  discharges the "include a copy of the license" obligation for a web
  distribution.
- A section in `FE/README.md` naming the typeface, its authors, the license, and
  the download source.

## 6. Testing

Diacritic rendering is a visual property; jsdom cannot assert it, and it is
verified by eye against a checklist (§7). Two failure modes *are* mechanical,
regress silently, and get automated tests in `FE/src/test/fonts.test.ts`.

The filename matters: `FE/vitest.config.ts` sets
`include: ['src/**/*.test.{ts,tsx}']`, so a file named `*.spec.ts` would be
collected by nothing and pass forever without running. It sits in `src/test/`
alongside the existing `smoke.test.ts`, the established home for tests not bound
to a component.

1. **Every `url()` in `index.css` resolves to a file that exists under
   `FE/public/fonts/`.** A wrong path or a file lost in a merge produces no
   error anywhere — not in `tsc --noEmit`, not in `vite build`. The page simply
   falls back to a system font, which looks plausible enough to ship unnoticed.
   This test is the only thing that catches it.

2. **`OFL.txt` exists in `FE/public/fonts/`.** Converts the licensing obligation
   into a build-time assertion so a future directory cleanup cannot quietly
   delete it.

Both read the filesystem directly and need no DOM.

## 7. Manual verification checklist

Run against `StoryViewScreen` at `text-xl` and `text-2xl`, in both light and
night mode:

- Stacked marks stay clear and unclipped: `ế ề ể ễ ệ ố ồ ổ ỗ ộ ứ ừ ử ữ ự ặ ẳ ẵ`
- Horn letters read distinctly from their bases: `ơ ư` vs `o u`
- `đ` and `Đ` render with the crossbar intact
- Capitals with marks are not clipped by the line box: `Ế Ộ Ữ Ặ`
- Marks do not collide with the descenders of the line above at `leading-relaxed`
- The `₫` currency sign renders (it belongs to the `vietnamese` subset)

## 8. Files touched

| File | Change |
|---|---|
| `FE/public/fonts/*.woff2` | new — 5 files, one per weight |
| `FE/public/fonts/OFL.txt` | new |
| `FE/src/index.css` | `@font-face` block + `@theme` override |
| `FE/index.html` | one `preload` tag |
| `FE/nginx.conf` | one `location /fonts/` block |
| `FE/README.md` | attribution section |
| `FE/src/test/fonts.test.ts` | new |

No component file changes. No npm dependency added. No BE or Engine change.

## 9. Out of scope

- The paused TTS work. The Web Speech API block in `StoryViewScreen` stays
  commented out and is untouched here.
- A display face for headings. One family covers the whole app until there is
  evidence a second is needed.
- Italic faces, and weights 100/200/300/900 — none are used.
- The repo-root `LICENSE` file and the CI license gate raised during the
  dependency audit. Both are real, both are separate work.
