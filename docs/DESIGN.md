# Modus v3 — Design direction & design system

> ## ⚠️ Superseded in part — read this first
>
> The app now ships **"Nocturne"** (the `Modus Desktop` / `Modus Phone` designs), not the
> "Bullion" direction this document specifies. Two things in here are **wrong about the code**:
>
> | This document says | The code actually does |
> | --- | --- |
> | Warm black + **gold** (`#d4af37`), Manrope/Inter | Blue-black `#12131c` + **violet** `#8b5cf6` / cyan `#22d3ee`, Sora + JetBrains Mono |
> | Three-tier chrome: phone tab bar → 80 px icon rail → 260 px sidebar + top bar (§6.3, §7.x) | **One floating dock** at every width — `src/app/NavDock.tsx`. `Sidebar`, `IconRail`, `TopBar`, `BottomTabBar` are deleted |
> | Nav: Today · Log · Scan · Progress · Plan · History · Profile | Nav: **Today · Insights · ➕ · Coach · You**. Routes are unchanged (`/progress`, `/plan`, `/profile`), only the labels and chrome moved |
> | `.fm-shell` / `.fm-content-grid` 4/8/12-column grid | One centred 1180 px measure; screens compose with plain flex/grid |
>
> **`src/styles/tokens.css` is the source of truth for colour, type, radii and elevation.**
> The `--fm-gold-*` primitives and the `--gold*` aliases still exist there, but they resolve to
> violet — they are a deprecated name layer kept so ~50 Bullion-era call sites keep rendering.
>
> Everything else in this document — the non-negotiables below, the accessibility method, the
> CVD reasoning, the per-screen information architecture, the RTL rules — still applies and was
> carried over.

**Owner:** design (task P1.1). **Status:** superseded by Nocturne for §2 (colour), §3
(effects), §6 (layout/chrome) and the nav parts of §7; the rest still stands.
**Audience:** frontend (P3.1–P3.5, P4.1–P4.2). Read the project plan §5 first — this
file is the detailed answer to those bounds.

Everything here is buildable. Every colour is a hex. Every contrast ratio in this document was
**computed, not estimated** (sRGB relative luminance, WCAG 2.1 formula); every categorical chart
palette was run through the `dataviz` skill's validator
(`scripts/validate_palette.js`, OKLab ΔE ×100, Machado–Oliveira–Fernandes CVD simulation at
severity 1.0) and the raw verdicts are pasted in §4.

---

## 0. Non-negotiables

The frontend developer must not deviate from these without coming back to this document.

1. **Legibility beats novelty.** the project plan says real users. If a visual effect and a number
   ever compete, the number wins. Every effect in here has an off-switch that leaves the app
   fully usable.
2. **No glass, no blur, no gradient, no 3D behind any number or chart.** Glass is allowed on
   navigation chrome and sheets only (§3.6). Data sits on flat opaque surfaces.
3. **AA everywhere, measured.** Body text ≥ 4.5:1, large/bold text and UI boundaries ≥ 3:1,
   on the *actual* surface it renders on. The tables in §2 give you pre-cleared pairs — use
   them and you cannot fail.
4. **Colour is never the only signal.** Every status ships colour **+ icon + text label**. Every
   chart series ships colour **+ a direct label, a legend, or its own facet**. Over-target is
   never "it went red" alone — it also gets a `▲` marker and the word "over".
5. **≥44×44 px hit target** on every interactive element, at every breakpoint, including chart
   points and chip close buttons. Visual size may be smaller; the hit area may not.
6. **Focus is always visible** — `2px solid #F0D878`, `outline-offset: 2px`. Never removed,
   never replaced by a colour change alone.
7. **Logical properties only.** `ps-/pe-/ms-/me-/start-/end-/text-start`, never
   `pl-/pr-/ml-/mr-/left-/right-/text-left`. RTL is a `dir` attribute, not a second stylesheet.
8. **No invented data, ever.** Empty states are designed (§9). A chart with no data shows the
   empty state, not a demo curve. A chart with one point shows the point and says
   "one reading — no trend yet".
9. **Desktop is designed, not stretched.** §6 specifies a real multi-column desktop layout with
   its own navigation. Shipping the 480 px frame centred on a 1440 px screen is a failure.
10. **Dark theme only in v3.** See §2.0. Do not ship a half-working light theme or a theme
    toggle that does nothing.

---

## 1. The three directions

the project plan §5 requires 2–3 named directions with full hex tokens, one recommended, and an
argument if the gold-on-dark identity is replaced. Here they are. **Direction A is recommended
and the rest of this document specifies it in full.** B and C are given with complete token sets
so switching later is a token-file swap, not a redesign.

### Direction A — **"Bullion"** ✅ RECOMMENDED

> Keep the gold. Systematise it. Stop making it do jobs it is bad at.

**What it is.** The v1/v2 warm near-black stays exactly as it is (`#0B0B0A`). The gold stays
exactly as it is (`#D4AF37` / `#F0D878`). What changes is *discipline*: gold becomes the brand,
the primary action, the focus ring, and the single "calories" metric — and nothing else. It stops
being smeared across borders, icons, eyebrows and macro bars at once. Everything gold vacates
gets a purpose-built token: a five-step neutral ink ramp, a four-state status scale, and a
validated three-hue data palette that is deliberately *not* gold, so charts read as data and not
as decoration.

Visually it lands as a **dark instrument panel with one precious material in it** — matte warm
black, hairline warm-neutral rules, dense tabular numbers, and gold used the way a watch dial
uses it: on the hands and the index marks, not on the whole face. Depth comes from four flat
surface steps and one shadow scale; glass is used only on nav chrome, where the content sliding
under it is the point (§3.6).

**Why it wins here.**
- It is Mutasim's identity, built twice by him. the project plan names it as *the* reference. There
  is no external reference that beats "the thing the owner already made and cares about".
- Warm near-black is genuinely correct for this product: a PWA opened at 06:00 before a workout
  and at 23:00 after dinner. It is OLED-cheap and it does not glare.
- Gold is a **narrow-hue** accent. That is a liability for charts (yellow collides with orange
  under every form of colour-blindness) and an asset for identity. Direction A resolves the
  tension by assigning gold to identity and giving data its own hues — which is exactly the
  extension the project plan §5 demands.
- It is the lowest-risk path for 317 existing tests and an existing component library: the
  base, surface and gold hexes are unchanged, so most of the migration is *additive*.

**Full token set:** §2. **Full data ramp:** §4.

| Role | Hex |
| --- | --- |
| Page background | `#0B0B0A` |
| Raised background | `#121110` |
| Surface 1 (cards) | `#1A1916` |
| Surface 2 (inputs, rows) | `#221F1B` |
| Surface 3 (chips, tracks) | `#2B2721` |
| Surface 4 (hover) | `#35302A` |
| Ink primary | `#F7F5F0` |
| Ink secondary | `#DAD4C8` |
| Ink tertiary | `#A8A296` |
| Ink quaternary | `#8B8579` |
| Primary / brand | `#D4AF37` |
| Primary light (focus, hover) | `#F0D878` |
| Primary deep (borders at 3:1) | `#8A7224` |
| Border hairline | `#38311B` (= `rgba(212,175,55,.16)` over surface 1) |
| Border strong | `#594C21` (= `rgba(212,175,55,.34)` over surface 1) |
| Success / on-track | `#55C483` |
| Warning / attention | `#F4993C` |
| Danger / destructive | `#F05560` |
| Info / syncing | `#70B6E7` |
| Neutral / offline | `#A8A296` |
| Data — protein | `#DD6D49` |
| Data — carbs | `#00A692` |
| Data — fat | `#A769D0` |
| Data — energy (kcal, weight trend) | `#D4AF37` |

---

### Direction B — **"Atlas Night"** (extend: same gold, colder ground)

**What it is.** Identical structure to A, but the ground shifts from warm brown-black to **cool
graphite** (`#08090B` → `#14171C` → `#1B1F26` → `#242A33`) and the gold is brightened one step to
`#E8B93F` so it still sings against a cold surface. Ink goes cool (`#EEF1F5`). Glass is used more
heavily — this is the direction where a full glassmorphism-v2 treatment and a WebGL ambient layer
would look most at home.

**Why you might pick it.** Cool graphite is the better *data* ground: warm neutrals subtly tint
adjacent chart colours, cool neutrals do not. On a 27" monitor with six chart cards open, B is
measurably calmer. It also reads more "instrument / telemetry", which suits the Progress screen.

**Why it is not recommended.** It quietly throws away the thing that makes Modus look like
Modus. Gold on cool graphite is the default palette of every crypto dashboard and premium-tier
SaaS upsell page — it is *close* to the failure mode the project plan forbids, just with a warmer
accent. And it costs the whole existing surface token set for a benefit only visible on a large
monitor.

| Role | Hex | Contrast on `#14171C` |
| --- | --- | --- |
| Page background | `#08090B` | — |
| Raised background | `#0E1014` | — |
| Surface 1 (cards) | `#14171C` | — |
| Surface 2 | `#1B1F26` | — |
| Surface 3 | `#242A33` | — |
| Surface 4 (hover) | `#2E3540` | — |
| Ink primary | `#EEF1F5` | 15.86 |
| Ink secondary | `#C3CAD4` | 10.88 |
| Ink tertiary | `#98A1AD` | 6.87 |
| Ink quaternary | `#7C8593` | 4.82 |
| Primary / brand | `#E8B93F` | 9.79 |
| Primary light | `#F7DD8C` | 13.41 |
| Primary deep (3:1 border) | `#9A7C1E` | 4.51 |
| Border hairline | `rgba(238,241,245,.08)` | decorative |
| Border strong / field | `#66707F` | 3.58 on card, **3.30 on the field fill `#1B1F26`** |
| Success | `#4CC98A` | 8.58 |
| Warning | `#F2A03D` | 8.44 |
| Danger | `#F0596A` | 5.42 |
| Info | `#69AFF0` | 7.69 |
| Data — protein / carbs / fat | `#DD6D49` / `#00A692` / `#A769D0` | 5.6 / 6.0 / 4.9 — validator: **ALL CHECKS PASS**, all-pairs, worst CVD ΔE 11.2 |

### Direction C — **"Sahra Daylight"** (replace: light-first, warm sand)

**What it is.** A genuine replacement of the *mode*. Warm sand paper (`#F6F1E7`), near-black olive
ink (`#1E1D17`), gold demoted to a darkened `#7A5F10` for text and kept at `#C09A2A` for large
marks only. Named for صحراء — the warm-light register of the same warm-neutral family, rather than
an unrelated new hue.

**The argument for replacing.** Nutrition logging happens in the daytime, in kitchens, in gyms,
outdoors, at a desk — the exact conditions where a near-black UI is hardest to read on a phone at
low brightness in sunlight. Every major competitor is light-first for that reason. A light Modus
would also be *more* differentiated in a portfolio full of dark dashboards, not less.

**Why it still loses.** It discards the identity Mutasim built twice and that the project plan names
as the reference, in exchange for a benefit (outdoor legibility) that a future light theme could
deliver additively. It also inverts every existing component in the repo, which is the largest
possible change surface right before three security audits. Offered honestly, not recommended.

| Role | Hex | Contrast on `#FFFDF8` |
| --- | --- | --- |
| Page background | `#F6F1E7` | — |
| Surface 1 (cards) | `#FFFDF8` | — |
| Surface 2 | `#F0EADC` | — |
| Surface 3 | `#E4DCCA` | — |
| Surface 4 (hover) | `#D8CEB8` | — |
| Ink primary | `#1E1D17` | 16.61 |
| Ink secondary | `#4A473C` | 9.15 |
| Ink tertiary | `#6B6759` | 5.57 |
| Primary / brand text | `#7A5F10` | 5.95 |
| Primary mark (fills ≥24 px only) | `#C09A2A` | 2.62 — **large marks only, never text** |
| Border hairline | `#DED6C4` | decorative |
| Border strong / field | `#7F765C` | 4.44 on card, **3.77 on the field fill `#F0EADC`** |
| Success | `#1D7A46` | 5.26 |
| Warning | `#8F5C0C` | 5.58 |
| Danger | `#B3261E` | 6.43 |
| Info | `#12557E` | 7.87 |
| Data — protein / carbs / fat | `#C4562A` / `#005E8A` / `#7B4FBF` | validator: **ALL CHECKS PASS**, all-pairs, worst CVD ΔE 8.9 |

> **If you switch directions later:** every hex in this document lives in exactly one place —
> `src/styles/tokens.css` (§13). Swapping A→B is one file. Swapping A→C additionally requires
> re-running the validator against the light surface (already done above) and re-checking §2.3.

---

# DIRECTION A — THE SYSTEM

Everything from here down specifies Direction A.

## 2. Colour

### 2.0 One theme, honestly

v3 ships **dark only**. `user_settings.theme` exists in the schema (the project plan §3) and is
reserved for a future light theme; until that theme exists **the UI must not show a theme
control**. This follows the same rule that cut `Settings.units` in the project plan §4: the app never
implies a capability it lacks. Write `theme: 'dark'` and leave it alone.

`color-scheme: dark` goes on `:root` so form controls, scrollbars and the URL bar match.

### 2.1 Primitive tokens

```css
:root {
  /* ── Neutral ground (warm) ─────────────────────────────────────────── */
  --fm-black:        #0B0B0A;   /* page */
  --fm-black-raise:  #121110;   /* sticky bars, table header */
  --fm-surface-1:    #1A1916;   /* cards, charts */
  --fm-surface-2:    #221F1B;   /* inputs, list rows, chart tooltip */
  --fm-surface-3:    #2B2721;   /* chips, progress tracks, gridlines */
  --fm-surface-4:    #35302A;   /* hover on surface-3, pressed rows */
  --fm-scrim:        rgba(6,6,5,.72);   /* behind sheets/dialogs */

  /* ── Ink ──────────────────────────────────────────────────────────── */
  --fm-ink-1:        #F7F5F0;
  --fm-ink-2:        #DAD4C8;
  --fm-ink-3:        #A8A296;
  --fm-ink-4:        #8B8579;
  --fm-ink-disabled: #6B665D;   /* disabled text only — WCAG exempt */

  /* ── Gold (identity) ──────────────────────────────────────────────── */
  --fm-gold-100:     #F9E7B3;
  --fm-gold-200:     #F0D878;   /* focus ring, hover ink */
  --fm-gold-300:     #E9C85E;
  --fm-gold-400:     #D4AF37;   /* THE gold */
  --fm-gold-500:     #B59521;
  --fm-gold-600:     #8A7224;   /* 3:1 borders */
  --fm-gold-700:     #5D4B0C;
  --fm-gold-800:     #392C01;
  --fm-gold-900:     #241C05;   /* tinted fills behind gold text */

  /* ── Status (reserved — never used as a chart series) ─────────────── */
  --fm-ok:           #55C483;
  --fm-warn:         #F4993C;
  --fm-danger:       #F05560;
  --fm-info:         #70B6E7;
  --fm-neutral:      #A8A296;

  /* status tint fills — status colour at 10% over surface-1, pre-composited.
     10%, not 12%: at 12% the danger ink lands on 4.50:1, which is AA only by
     rounding. At 10% it is 4.63:1 with room to spare. */
  --fm-ok-bg:        #202A21;   /* #55C483 on it: 6.79 · ink-1 on it: 13.63 */
  --fm-warn-bg:      #30261A;   /* #F4993C on it: 6.68 · ink-1 on it: 13.59 */
  --fm-danger-bg:    #2F1F1D;   /* #F05560 on it: 4.63 · ink-1 on it: 14.44 */
  --fm-info-bg:      #23292B;   /* #70B6E7 on it: 6.70 · ink-1 on it: 13.54 */

  /* ── Data (validated — see §4) ────────────────────────────────────── */
  --fm-data-protein: #DD6D49;
  --fm-data-carbs:   #00A692;
  --fm-data-fat:     #A769D0;
  --fm-data-energy:  #D4AF37;
  --fm-data-grid:    #2B2721;
  --fm-data-axis:    #3A352D;
  --fm-data-ref:     #A8A296;   /* target / goal reference lines */

  /* ── Borders ──────────────────────────────────────────────────────── */
  --fm-border:        rgba(212,175,55,.16);  /* = #38311B over surface-1 */
  --fm-border-strong: rgba(212,175,55,.34);  /* = #594C21 over surface-1 */
  --fm-border-field:  #8A7224;               /* 3.53:1 on surface-2 — inputs */
  --fm-border-neutral: rgba(247,245,240,.09);
}
```

### 2.2 Semantic tokens

Components consume **only** these. A component that writes `#D4AF37` is a bug.

```css
:root {
  --fm-bg:               var(--fm-black);
  --fm-bg-elevated:      var(--fm-black-raise);

  --fm-text:             var(--fm-ink-1);
  --fm-text-muted:       var(--fm-ink-2);
  --fm-text-subtle:      var(--fm-ink-3);
  --fm-text-faint:       var(--fm-ink-4);
  --fm-text-disabled:    var(--fm-ink-disabled);
  --fm-text-on-accent:   var(--fm-black);      /* ink sitting ON a gold fill */

  --fm-accent:           var(--fm-gold-400);
  --fm-accent-hover:     var(--fm-gold-300);
  --fm-accent-press:     var(--fm-gold-500);
  --fm-accent-quiet:     var(--fm-gold-900);   /* tinted fill behind gold text */

  --fm-focus:            var(--fm-gold-200);

  --fm-card:             var(--fm-surface-1);
  --fm-field:            var(--fm-surface-2);
  --fm-chip:             var(--fm-surface-3);
  --fm-hover:            var(--fm-surface-4);
}
```

### 2.3 Contrast table — every pair you are allowed to ship

Computed with the WCAG 2.1 relative-luminance formula. **AA needs 4.5:1 for text below 24 px
(or below 18.66 px bold) and 3:1 for larger text, icons and component boundaries.**

| Foreground | on `#0B0B0A` | on `#1A1916` | on `#221F1B` | on `#2B2721` | Verdict |
| --- | --- | --- | --- | --- | --- |
| `#F7F5F0` ink-1 | 18.07 | 16.13 | 15.06 | 13.62 | AA/AAA everywhere |
| `#DAD4C8` ink-2 | 13.35 | 11.91 | 11.12 | 10.06 | AA/AAA everywhere |
| `#A8A296` ink-3 | 7.76 | 6.93 | 6.46 | 5.85 | AA everywhere |
| `#8B8579` ink-4 | 5.37 | 4.80 | 4.48 | 4.05 | AA to surface-2; **surface-3 → large text / icons only** |
| `#6B665D` disabled | 3.44 | 3.07 | 2.87 | 2.60 | disabled text only (WCAG-exempt) |
| `#D4AF37` gold-400 | 9.36 | 8.36 | 7.80 | 7.06 | AA everywhere |
| `#F0D878` gold-200 | 13.88 | 12.39 | 11.56 | 10.46 | AA everywhere; focus ring |
| `#B59521` gold-500 | 6.83 | 6.10 | 5.69 | 5.15 | AA everywhere |
| `#8A7224` gold-600 | 4.23 | 3.78 | 3.53 | 3.19 | **borders/icons only, ≥3:1 — not body text** |
| `#55C483` success | 9.01 | 8.04 | 7.51 | 6.79 | AA everywhere |
| `#F4993C` warning | 8.88 | 7.93 | 7.40 | 6.69 | AA everywhere |
| `#F05560` danger | 5.79 | 5.17 | 4.82 | 4.36 | AA to surface-2; **surface-3 → large text only** |
| `#70B6E7` info | 8.94 | 7.98 | 7.45 | 6.74 | AA everywhere |
| `#DD6D49` protein | 5.96 | 5.32 | 4.97 | 4.49 | AA to surface-2 |
| `#00A692` carbs | 6.44 | 5.75 | 5.37 | 4.86 | AA everywhere |
| `#A769D0` fat | 5.23 | 4.67 | 4.36 | 3.94 | AA to surface-1; **surface-2/3 → marks & large text** |

**Ink on fills (buttons, badges):**

| Pair | Ratio |
| --- | --- |
| `#0B0B0A` on `#D4AF37` (primary button) | 9.36 |
| `#0B0B0A` on `#F0D878` (primary hover) | 13.88 |
| `#0B0B0A` on `#F05560` (destructive solid) | 5.79 |
| `#0B0B0A` on `#55C483` | 9.01 |
| `#F7F5F0` on `#221F1B` (input text) | 15.06 |
| `#0B0B0A` on `#F4726F` (destructive hover) | 7.02 |
| `#0B0B0A` on `#D9414C` (destructive active) | 4.51 |
| `#F0D878` on `#241C05` (selected row / quiet gold fill) | 11.90 |
| `#D4AF37` on `#241C05` | 8.03 |
| `#F7F5F0` on `#161513` (glass opaque fallback) | 16.75 |
| Status ink on its own tint — `#55C483`/`#202A21` · `#F4993C`/`#30261A` · `#F05560`/`#2F1F1D` · `#70B6E7`/`#23292B` | 6.79 · 6.68 · 4.63 · 6.70 |

**Boundaries (WCAG 1.4.11, needs 3:1):**

| Boundary | Colour | Ratio | Against |
| --- | --- | --- | --- |
| Input / select / textarea border | `#8A7224` | 3.53 | field fill `#221F1B` |
| Input border vs surrounding card | `#8A7224` | 3.78 | `#1A1916` |
| Focus ring | `#F0D878` | 12.39 | `#1A1916` |
| Progress fill vs track | `#D4AF37` vs `#2B2721` | 7.06 | — |
| Selected tab indicator | `#D4AF37` | 8.36 | `#1A1916` |
| Card hairline `#38311B` | 1.36 | — | **decorative only** — cards are also separated by a surface step, so the hairline is not load-bearing. Never use it as the sole boundary of an interactive control. |

**Known collisions, and why they are safe.** Warm hues are crowded because gold owns the yellow
band. Measured normal-vision ΔE (OKLab ×100):

| Pair | ΔE | Mitigation |
| --- | --- | --- |
| `--fm-warn` vs `--fm-gold-400` | 7.3 | Status never appears as a chart mark; gold never appears as a badge fill. Status always ships an icon + word ("Over", "Attention"). |
| `--fm-danger` vs `--fm-data-protein` | 6.8 | Same form-factor rule. Danger is a badge/border/solid button; protein is a bar/dot/line only. |
| `--fm-warn` vs `--fm-data-protein` | 11.8 | Same. |
| `--fm-info` vs any series | n/a | No blue exists in the chart palette at all (§4) — deliberate. |

This is the same rule the `dataviz` reference palette itself applies to its status scale: a status
colour beside a same-family series leans on **icon + label + placement**, never on hue.

---

## 3. Type, space, shape, depth, motion

### 3.1 Typography

Self-hosted, offline-capable, OFL. **No CDN `@import`** — this is a PWA and it must render with
the network off.

| Role | Family | Package | Loaded |
| --- | --- | --- | --- |
| UI + display (Latin) | **Inter Variable** | `@fontsource-variable/inter` (latin subset) | always, preloaded |
| UI + display (Arabic) | **Cairo Variable** | `@fontsource-variable/cairo` (arabic + latin subsets) | **only when `lang="ar"`** — dynamic `import()` from the i18n language-change handler |
| Mono | **JetBrains Mono Variable** | `@fontsource-variable/jetbrains-mono` (latin subset) | **lazy** — only on the recovery-code screen and the export preview |

```css
:root {
  --fm-font-sans: 'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  --fm-font-mono: 'JetBrains Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace;
}
:root:lang(ar), [lang='ar'] {
  --fm-font-sans: 'Cairo Variable', 'Inter Variable', 'Noto Sans Arabic', system-ui, sans-serif;
}
body { font-family: var(--fm-font-sans); font-optical-sizing: auto; }
```

Why these: Inter is already in the repo and is the most legible UI face at 13–15 px on dark.
Cairo is variable (one file, not four static weights), genuinely designed for Arabic UI rather than
a Latin face with Arabic bolted on, and OFL. JetBrains Mono earns its bytes on exactly one screen —
the recovery code, where `0/O` and `1/l/I` confusion is a data-loss bug, not a style preference.

**Scale.** `rem`-based, 16 px root. Never below 12 px for anything a user must read.

| Token | Size | Line-height | Weight | Tracking | Used for |
| --- | --- | --- | --- | --- | --- |
| `--fm-t-display` | `clamp(1.75rem, 5vw, 2.5rem)` | 1.05 | 800 | −0.022em | Onboarding hero, marketing-ish moments. One per screen. |
| `--fm-t-h1` | `clamp(1.375rem, 3.5vw, 1.75rem)` | 1.15 | 800 | −0.018em | Screen title |
| `--fm-t-h2` | `1.25rem` | 1.20 | 700 | −0.012em | Card group title |
| `--fm-t-h3` | `1.0625rem` | 1.30 | 700 | −0.006em | Card title |
| `--fm-t-body-lg` | `1rem` | 1.55 | 400 | 0 | Long copy, dialog body |
| `--fm-t-body` | `0.9375rem` | 1.55 | 400 | 0 | Default |
| `--fm-t-body-sm` | `0.8125rem` | 1.50 | 400 | 0 | Helper text, captions |
| `--fm-t-label` | `0.75rem` | 1.30 | 600 | 0.02em | Field labels, nav labels |
| `--fm-t-eyebrow` | `0.6875rem` | 1.20 | 700 | 0.12em | UPPERCASE section eyebrow |
| `--fm-t-metric-xl` | `2.75rem` | 1.00 | 800 | −0.03em | The one hero number per screen |
| `--fm-t-metric-lg` | `2rem` | 1.00 | 800 | −0.025em | Ring centres, stat tiles |
| `--fm-t-metric-md` | `1.375rem` | 1.05 | 700 | −0.015em | Row totals |
| `--fm-t-numeric` | `0.875rem` | 1.40 | 500 | 0 | Table cells, axis ticks — **`tabular-nums`** |

**Numeral rules.** Hero and stat-tile numbers use the font's default **proportional** figures
(`tabular-nums` makes a large `121` look gappy). Columns of numbers — table cells, axis ticks,
the macro rows — use `font-variant-numeric: tabular-nums`. Digits are **always Latin**, in both
locales: `new Intl.NumberFormat(locale, { numberingSystem: 'latn' })`.

**Arabic adjustments** (Cairo runs visually smaller and needs more leading):

```css
[lang='ar'] {
  /* sizes: +1px on running text so Cairo matches Inter's apparent size */
  --fm-t-body:     1rem;
  --fm-t-body-sm:  0.875rem;
  --fm-t-label:    0.8125rem;
  --fm-t-eyebrow:  0.75rem;

  /* leading: +0.1 across the board — Arabic needs room for descenders and marks */
  --fm-lh-body:    1.65;   /* Latin: 1.55 */
  --fm-lh-heading: 1.30;   /* Latin: 1.20 */
  --fm-lh-tight:   1.15;   /* Latin: 1.05 */

  letter-spacing: 0;                 /* never track Arabic — it breaks joining */
  font-feature-settings: 'liga' 1;
}
[lang='ar'] .fm-eyebrow { text-transform: none; }  /* Arabic has no letter case */
```
Define `--fm-lh-*` for **both** locales (Latin values in `:root`, the values above in
`[lang='ar']`) and have every type token consume the variable. Do **not** write a blanket
`[lang='ar'] * { line-height: … }` rule — it would override the tight leading on hero numbers
and the ring centre, which must stay at 1.0 in every language.

### 3.2 Spacing

4 px base. Tailwind's default scale already matches; these are the values you may use:

`0 · 2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80`

| Token | px | Use |
| --- | --- | --- |
| `--fm-gutter-phone` | 16 | Screen inline padding < 640 |
| `--fm-gutter-tablet` | 24 | 640–1023 |
| `--fm-gutter-desktop` | 32 | ≥ 1024 |
| `--fm-card-pad` | 20 | Card padding (16 on phone for dense list cards) |
| `--fm-stack` | 16 | Default gap between cards |
| `--fm-stack-lg` | 24 | Gap between card *groups* |
| `--fm-row-min-h` | 56 | List row min height (touch) |

### 3.3 Radii

Keep v1's language, extend it.

```css
--fm-r-xs:    6px;   /* tags, tiny badges */
--fm-r-sm:   10px;   /* chips, inputs, small buttons */
--fm-r-md:   14px;   /* buttons, list rows, tooltips */
--fm-r-lg:   22px;   /* cards */
--fm-r-xl:   28px;   /* bottom sheets, dialogs */
--fm-r-full: 999px;  /* pills, avatars, ring caps */
```
Chart marks: bars get a **4 px rounded data-end, square at the baseline** (`rx` only on the growth
end) — per the dataviz mark spec, not the card radius.

### 3.4 Elevation

Four steps. Elevation is carried by the **surface step first**, shadow second. Never use shadow
alone to separate two things on the same surface.

```css
--fm-elev-0: none;
--fm-elev-1: 0 1px 2px rgba(0,0,0,.45);
--fm-elev-2: 0 4px 16px -4px rgba(0,0,0,.55), 0 1px 2px rgba(0,0,0,.40);
--fm-elev-3: 0 12px 32px -8px rgba(0,0,0,.65), 0 2px 6px rgba(0,0,0,.45);
--fm-elev-accent: 0 8px 28px -10px rgba(212,175,55,.28);  /* primary CTA only */
```

| Level | Where |
| --- | --- |
| 0 | Cards at rest (surface step is enough) |
| 1 | Hovered/selected list rows, chips |
| 2 | Sticky bars, popovers, chart tooltips, FAB |
| 3 | Dialogs, bottom sheets, the merge screen's choice cards when selected |
| accent | The single primary CTA on a screen, at rest. Removed on `:active`. |

### 3.5 Grain

One shared texture, applied to the page background only. Kills the flat-plastic look on large
screens without touching content.

```css
.fm-grain::after {
  content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 0;
  opacity: .035; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
}
```
The existing `.ambient-grid` from v2 is **kept**, unchanged, layered under the grain, and masked
away below 82 % as it already is.

### 3.6 Glass — where it is allowed, and where it is banned

Glassmorphism v2 (blur + 1 px gradient border + soft *coloured* shadow, not blur alone):

```css
.fm-glass {
  position: relative;
  background: linear-gradient(160deg, rgba(38,34,26,.72), rgba(20,19,17,.86));
  -webkit-backdrop-filter: blur(18px) saturate(118%);
          backdrop-filter: blur(18px) saturate(118%);
  box-shadow: var(--fm-elev-2), inset 0 1px 0 rgba(247,245,240,.06);
}
.fm-glass::before {                      /* the 1px gradient light-catch border */
  content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
  background: linear-gradient(160deg, rgba(240,216,121,.34), rgba(240,216,121,.06) 42%, rgba(247,245,240,.05));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  pointer-events: none;
}
@supports not (backdrop-filter: blur(1px)) {
  .fm-glass { background: #16151399; background-color: #161513; }  /* opaque fallback */
}
```

**Allowed on:** bottom tab bar, desktop top bar, desktop sidebar, bottom sheets, dialogs, the
sticky "today's total" bar, the sync banner.
**Banned on:** any card containing a number, a chart, a food row, a form field, or an empty
state. The `modern-3d-ui-design` guidance is explicit that glass costs clarity on data-dense
surfaces — and this is a data-dense app.

### 3.7 Motion

The v1/v2 feel is kept: `cubic-bezier(.22,1,.36,1)` remains the signature entrance curve. Two
more curves are added because one curve cannot do exits and micro-feedback well.

```css
--fm-ease-emphasis: cubic-bezier(.22, 1, .36, 1);   /* entrances, screen transitions (KEPT) */
--fm-ease-standard: cubic-bezier(.2, 0, 0, 1);      /* everyday UI: hover, expand, colour */
--fm-ease-exit:     cubic-bezier(.4, 0, 1, 1);      /* dismiss, leave */

--fm-dur-1:  120ms;  /* colour/opacity micro-feedback */
--fm-dur-2:  180ms;  /* hover, chip toggle, focus */
--fm-dur-3:  240ms;  /* sheet/menu open, row expand */
--fm-dur-4:  320ms;  /* screen transition (KEPT from v2's 350ms, tightened) */
--fm-dur-5:  520ms;  /* ring fill, chart draw-in — the only long ones */
```

| Moment | Spec |
| --- | --- |
| Screen transition | `opacity 0→1` + `translateY(8px→0)`, `--fm-dur-4`, `--fm-ease-emphasis`. Unchanged from v2. |
| Card entrance (stagger) | Same, `--fm-dur-3`, **max 4 items**, 40 ms stagger, then everything else appears at once. Never stagger a list. |
| Ring fill | `stroke-dashoffset`, `--fm-dur-5`, `--fm-ease-emphasis`. Fires once per mount, not on every re-render. |
| Chart draw-in | Line: `stroke-dashoffset` `--fm-dur-5`. Bars: `scaleY` from the baseline, `--fm-dur-4`, 25 ms stagger capped at 12 bars. |
| Button press | `transform: scale(.97)`, `--fm-dur-1`, no easing curve needed. |
| Bottom sheet | `translateY(100%→0)`, `--fm-dur-3`, `--fm-ease-emphasis`; scrim `opacity` `--fm-dur-2`. Exit uses `--fm-ease-exit` at `--fm-dur-2`. |
| Toast | Slide in from the block-end 12 px + fade, `--fm-dur-3`; auto-dismiss 5 s (8 s if it contains an action); hover/focus pauses the timer. |
| Sync spinner | 1.2 s linear rotation. **The only looping animation in the app.** |
| Value change | Numbers do **not** count up or animate. A changed number gets a 600 ms `--fm-accent-quiet` background flash, nothing more. |

**Reduced motion.** `prefers-reduced-motion: reduce` *or* the in-app `settings.reducedMotion`
toggle (both already wired in `AppShell.tsx` — keep that mechanism):

- All transitions/animations → `0.01ms` (the existing global rule stays).
- Rings and bars render at their **final** value immediately.
- Charts render fully drawn.
- The sync spinner becomes a **static** icon; the "Syncing…" text plus `aria-live="polite"` is
  what communicates activity.
- Sheets and dialogs **cross-fade** (`opacity`, 100 ms) instead of sliding — they must still
  appear/disappear, because instant popping is disorienting.
- **The WebGL layer never initialises at all** (§11).

---

## 4. The data-visualisation system

This is a first-class deliverable, not chart-library defaults.

### 4.1 The categorical palette, and why it excludes gold

Macros are the only true categorical series in the app. They were validated with the `dataviz`
validator on the chart surface `#1A1916`, with `--pairs all` (the strict test — in a grouped bar
or a stacked bar every pair can end up adjacent):

```
$ node scripts/validate_palette.js "#DD6D49,#00A692,#A769D0" --mode dark --surface "#1A1916" --pairs all

Palette (dark, surface #1A1916, categorical): 3 slots
  [PASS] Lightness band         all 3 inside L 0.48–0.67
  [PASS] Chroma floor           all 3 >= 0.1
  [PASS] CVD separation         worst all-pairs #A769D0↔#00A692 ΔE 11.2 (deutan) · tritan 15.1
  [PASS] Normal-vision floor    worst all-pairs #A769D0↔#DD6D49 ΔE 21.8 (normal)
  [PASS] Contrast vs surface    all 3 >= 3:1
  → ALL CHECKS PASS
```

| Slot | Role | Hex | Rationale |
| --- | --- | --- | --- |
| 1 | **Protein** | `#DD6D49` | Terracotta. Closest step to v1's `#E7835F` that sits inside the dark lightness band — identity preserved. |
| 2 | **Carbs** | `#00A692` | Jade. Replaces v1's `#9BC868`; that yellow-green collapsed toward gold under deuteranopia. |
| 3 | **Fat** | `#A769D0` | Amethyst. Replaces v1's `#E18AAE`; pink sat too close to protein terracotta. |

**Gold is deliberately not a categorical slot.** Yellow next to orange is the single worst pair in
CVD terms — measured at ΔE 4.8–5.6 (deutan) in trials. Gold is therefore assigned only to
**single-series** charts (calories per day, body-weight trend), which never share a plot with the
macro hues. This is a design constraint, not a limitation: it is *why* the ramp passes.

**No blue exists in the chart palette.** Blue is reserved for `--fm-info` (sync). A chart line and
a sync badge will never be confused.

### 4.2 Chart-by-chart specification

Everything below sits on `--fm-surface-1 #1A1916`.

Shared chrome:

| Element | Spec |
| --- | --- |
| Gridlines | `#2B2721`, **1 px solid** hairline, horizontal only. Never dashed, never vertical. |
| Baseline / axis | `#3A352D`, 1 px |
| Axis tick text | `--fm-t-numeric` (14 px / 500 / `tabular-nums`), `--fm-ink-4 #8B8579` |
| Axis title | `--fm-t-label`, `--fm-ink-3 #A8A296`. Units always stated ("kcal", "g", "kg"). |
| Reference lines (target / goal) | `--fm-data-ref #A8A296`, **1.5 px dashed 4 2**, always with an inline end-label ("Target 2 100 kcal"). Neutral by design: a target is not a series. |
| Line | 2 px, round join/cap |
| End marker | r = 5 (10 px), filled with the series colour, **2 px ring in `#1A1916`** |
| Bar | max 24 px thick, 4 px rounded growth end, square at baseline, **2 px surface gap** between touching bars/segments |
| Area fill | series hue at 10 % opacity |
| Tooltip | `--fm-surface-2 #221F1B`, `--fm-r-md`, `--fm-elev-2`, 1 px `--fm-border-strong`, 12 px padding, `--fm-t-numeric` values, `--fm-ink-3` labels |
| Hover hit target | ≥ 44 px wide invisible band per x-position (a `<rect>` per column), not the 10 px dot |

---

#### 4.2.1 Body-weight trend — **line, single series**

- **Daily readings:** dots, r = 4 (8 px), `--fm-ink-4 #8B8579`, 2 px `#1A1916` ring. These are
  what the user actually weighed — noisy, deliberately quiet.
- **7-day moving average:** 2 px line, `--fm-data-energy #D4AF37`, with an end marker and a single
  direct label at the end ("81.4 kg"). This is the story, so it wears the gold.
- **Goal weight:** dashed `#A8A296` reference line + end label.
- **Y axis:** kg, clamped to `[min−1, max+1]` of the visible window, **never forced to zero** (a
  weight chart zeroed at 0 kg is unreadable). Say so in the axis title area: "kg — axis is zoomed
  to the visible range".
- **Range control:** segmented `30 d · 90 d · 1 y · All`, defaults to 90 d. One row above the chart.
- **< 2 readings:** empty state E-6 (§9), not a chart.
- **Exactly 2 readings:** draw the dots and the connecting line, but **suppress the moving average
  and the trend delta**, and show the caption "Two readings — not enough for a trend yet."

#### 4.2.2 Calories per day — **column, single series**

- Gold columns (`#D4AF37`), 24 px max, 2 px gaps.
- Target line dashed `#A8A296` across the plot.
- Columns **over target** keep the gold fill and add a **`#F05560` 2 px cap bar** on top plus a
  `▲` glyph — over-target is shape + position + colour, never colour alone.
- Days with **no log at all** render as an empty slot with a 1 px `#2B2721` baseline tick, **not a
  zero bar**. A zero bar claims "you ate nothing"; an empty slot says "no data". Legend note
  required: "Gaps are days with no log."
- Direct-label the highest and the most recent column only.

#### 4.2.3 Macro trends — **small multiples (3 stacked mini-charts)**

Three separate mini column charts, each 1 series, stacked vertically on phone and side by side on
desktop:

```
Protein  ▁▃▅▂▆▇▄   142 g avg   #DD6D49
Carbs    ▄▂▆▃▅▁▃   198 g avg   #00A692
Fat      ▃▃▂▄▂▅▃    61 g avg   #A769D0
```

Each mini-chart: 64 px tall, its own target reference line, its own y-scale (labelled), one direct
label at the end. **No legend needed** — each facet is titled.

Why facets and not one grouped chart: three series × 30 days in one plot is unreadable at 390 px,
and faceting removes the cross-series colour-discrimination burden entirely. The palette *does*
pass all-pairs, so a combined stacked view is permitted as an optional toggle ("Combine") on
desktop only — with the 2 px surface gaps and a legend.

#### 4.2.4 Weekly averages — **horizontal bars + delta**

One row per week, most recent first:

```
This week   ██████████████░░░   1 940 kcal   ▼ 60 vs target
Last week   ███████████████░░   2 010 kcal   ▲ 90 over target
```

- Bar: gold `#D4AF37`, track `#2B2721`, 12 px tall, `--fm-r-full`.
- Delta: `--fm-ok #55C483` with `✓` when within ±5 % of target, `--fm-warn #F4993C` with `▲`/`▼`
  when outside. **Arrow + number + word, never a bare colour.**
- Weeks with fewer than 4 logged days are shown but flagged: "3 of 7 days logged — average is over
  those 3 days." Never silently average over missing days.

#### 4.2.5 Streaks — **ordinal calendar heatmap + status tile**

Ordinal single-hue gold ramp, validated:

```
$ node scripts/validate_palette.js "#5D4B0C,#8A7224,#B59521,#D4AF37" --ordinal --mode dark --surface "#1A1916"
  [PASS] Lightness monotone · [PASS] Adjacent ΔL >= 0.06 · [PASS] Light-end contrast 2.07:1 · [PASS] Single hue
  → ALL CHECKS PASS
```

| Cell state | Fill | Border | Meaning |
| --- | --- | --- | --- |
| No log | `#221F1B` | 1 px `#2B2721` | nothing recorded |
| Logged, < 60 % of target | `#5D4B0C` | none | |
| 60–85 % | `#8A7224` | none | |
| 85–110 % (on target) | `#D4AF37` | none | |
| > 110 % (over) | `#B59521` | **2 px `#F05560` inset ring** | over-target gets a *shape*, not just a step |

- Cell 14 × 14 px with 4 px gap on phone, 18 × 18 px on desktop; hit target padded to 44 px via a
  wrapping button.
- Each cell is a `<button>` with `aria-label="12 March — 2 040 kcal, on target"` and navigates to
  that day in History.
- Streak headline is a **stat tile**, not a chart: `--fm-t-metric-lg` number + label
  "day streak" + a `--fm-ok` / `--fm-neutral` status dot with its word.
- Streak definition must be stated on screen, because it is a rule the user cannot see:
  *"A day counts when you log at least one entry and land within ±15 % of your calorie target."*

#### 4.2.6 Today's rings (Home)

Keep the existing `MacroRing`/`MacroBar` components, retokenised:

- Calorie ring: 132 px, 10 px stroke, track `#2B2721`, fill `#D4AF37`, cap round.
- Over target: fill switches to `#F05560` **and** a `▲` glyph appears beside the centre number
  **and** the sr-only text says "over target". Three signals.
- Macro bars: 8 px tall, `--fm-r-full`, track `#2B2721`, fills protein/carbs/fat.
- Centre number: `--fm-t-metric-lg`, proportional figures. Sub-label `--fm-t-body-sm`,
  `--fm-ink-3`, tabular.

### 4.3 Accessibility of every chart (mandatory, all of them)

1. The SVG is `aria-hidden="true"`. The chart's `<figure>` carries a `<figcaption>` with a
   one-sentence text summary of the trend, generated from the data:
   *"Body weight, last 90 days: 84.2 kg down to 81.4 kg, 12 readings."*
2. A **"Show data table"** disclosure under every chart renders a real `<table>` with `<caption>`,
   `<th scope>` and the same numbers. This is the P3.3 acceptance criterion "text alternative
   behind the visual" — it is a table, not alt text.
3. Series identity is never colour-alone: single-series charts are named in the title; the
   3-macro views are faceted and titled; any combined view carries a legend **and** 2 px gaps.
4. Tooltips are reachable by keyboard: each x-position is focusable (`tabindex="0"`,
   `role="img"`, `aria-label` with the values) and arrow keys move between points.
5. `forced-colors: active` → all fills become `CanvasText`/`Highlight`, and the **table view is
   auto-expanded**.

### 4.4 Library

**Recharts** (already an ecosystem match for React 18 + the existing stack, SVG, tree-shakeable,
MIT). Budget: the Progress screen route is `lazy()`-loaded, so Recharts is not in the first-paint
chunk. Style it with the tokens above; do **not** use its default palette.
If the bundle report shows Recharts pushing the Progress chunk over ~120 KB gz, drop to hand-rolled
SVG — every chart in §4.2 is a `<path>`/`<rect>` and a scale function, and the specs above are
complete enough to build without a library.

---

## 5. Information architecture

the project plan §4 bounds: max 5 primary destinations, Progress must be primary, Plan/History/
Profile may live under *More*. Final IA:

### Primary (phone bottom tab bar — exactly 5)

| # | Route | Label EN | Label AR | Icon (lucide) |
| --- | --- | --- | --- | --- |
| 1 | `/` | Today | اليوم | `Home` |
| 2 | `/log` | Log | التسجيل | `UtensilsCrossed` |
| 3 | `/scan` | Scan | المسح | `Camera` |
| 4 | `/progress` | Progress | التقدّم | `TrendingUp` |
| 5 | `/more` | More | المزيد | `LayoutGrid` |

### Under More (`/more` — a real screen, not a menu popover)

Grouped list, each row 56 px with icon + label + chevron (chevron mirrors in RTL):

- **Track** — Plan (`/plan`), History (`/history`)
- **You** — Profile & targets (`/profile`), Weight log (`/profile/weight`)
- **Account** — Account & sync (`/account`) *or* "Sign in / Create account" when signed out.
  Hidden entirely when the deployment reports `sync_unconfigured`; replaced by an honest card.
- **App** — Language (inline switcher), Motion (reduced-motion toggle), Data (export / reset),
  About & honesty notes

### Desktop (≥1024) — no *More*

The sidebar is wide enough to show everything, so `/more` is not rendered as a destination.
Sidebar order: **Today · Log · Scan · Progress · Plan · History** — divider — **Profile ·
Account & sync** — divider (pinned to the bottom) — **language switcher · sync chip**.
`/more` still resolves (deep links, back button) but redirects to `/profile` at ≥1024.

### Routes added in v3

```
/progress                     Progress (new — primary)
/more                         More hub (phone/tablet only)
/log/entry/:id                Edit entry (sheet on phone, dialog on desktop)
/log/custom-food              Create/edit a custom food
/log/favourites               Favourites & quick-add
/profile/weight               Weight log + add reading
/auth/sign-in                 Sign in
/auth/sign-up                 Create account
/auth/recovery-code           Recovery code — shown once, immediately after sign-up
/auth/recover                 Redeem a recovery code
/account                      Account & sync settings
/account/password             Change password
/account/delete               Delete account
/sync/merge                   Adoption / merge decision  ← full screen, non-dismissible
```

---

## 6. Layout — both breakpoints designed

### 6.1 Breakpoints

Tailwind defaults, with defined behaviour at each:

| Name | Width | Layout |
| --- | --- | --- |
| base | 0–639 | Phone. App frame `max-width: 480px`, centred, 16 px gutters. Bottom tab bar. |
| `sm` | 640–767 | Same as base (frame stays 480 px), 24 px gutters. Bottom tab bar. |
| `md` | 768–1023 | Tablet. **Left icon rail 80 px** replaces the bottom bar. Content is a 2-column bento, max 720 px. |
| `lg` | 1024–1279 | Laptop. **Sidebar 260 px** + top bar 64 px. Content 12-col grid, max 1 100 px. |
| `xl` | 1280–1535 | Content max 1 200 px, 3-column bento available, optional right rail 300 px. |
| `2xl` | ≥1536 | Content max 1 320 px, gutters 48 px. **Never full-bleed.** |

### 6.2 Phone shell (< 768)

```
┌──────────────────────────────┐  ← 100dvh
│  [status/notch safe area]    │
│  ┌────────────────────────┐  │
│  │ Today          ⟳ Synced │  │  header: h1 + sync chip
│  │ Wednesday, 12 March     │  │  --fm-t-body-sm, --fm-ink-3
│  └────────────────────────┘  │
│                              │
│  ▓▓▓▓▓ scrollable content ▓▓ │  16px gutters, 16px card gap
│  ▓▓▓▓▓                    ▓▓ │
│  ▓▓▓▓▓                    ▓▓ │
│                              │  ← 96px bottom spacer so the last
│                              │     card clears the tab bar + FAB
├──────────────────────────────┤
│ 🏠   🍽   📷   📈   ▦        │  fm-glass, h=64 + safe-area
│Today Log  Scan Prog  More    │  labels always visible (never icon-only)
└──────────────────────────────┘
```

- Tab bar: `.fm-glass`, `border-block-start: 1px solid var(--fm-border)`, `padding-block-end:
  env(safe-area-inset-bottom)`. Each tab ≥ 64 px tall, ≥ 20 % width. Active = `--fm-gold-200` icon
  + label + a 3 px `--fm-gold-400` indicator bar at the block-start edge of the tab.
- Header is **not** sticky on scroll (it wastes 15 % of a small viewport); the screen title
  collapses into a 48 px sticky mini-bar showing just the title + sync chip once the h1 scrolls
  out. Mini-bar uses `.fm-glass`.
- FAB (Log screen only): 56 px, `inset-inline-end: 16px`, `inset-block-end: 80px`, gold fill,
  `--fm-elev-accent`.

### 6.3 Desktop shell (≥1024) — a real desktop layout

```
┌──────────┬──────────────────────────────────────────────────────────────┐
│          │  Wednesday, 12 March 2026        ⟳ Synced 2m   [EN|ع]  (MA) │ 64px top bar
│  ◆       ├──────────────────────────────────────────────────────────────┤
│ Modus │                                                              │
│          │   ┌────────────────────────┬─────────────┬─────────────┐     │
│ ▸ Today  │   │                        │  Protein    │  Remaining  │     │
│   Log    │   │      CALORIE RING      │  142/165 g  │  660 kcal   │     │
│   Scan   │   │      1 440 / 2 100     ├─────────────┼─────────────┤     │
│   Progr. │   │                        │  Carbs      │  Fat        │     │
│   Plan   │   │      3 macro bars      │  198/240 g  │  61/70 g    │     │
│   Histor.│   └────────────────────────┴─────────────┴─────────────┘     │
│          │   ┌──────────────────────────────┬───────────────────────┐   │
│ ─────────│   │  Today's meals (grouped)     │  Quick add            │   │
│   Profile│   │  ...                         │  favourites, copy     │   │
│   Account│   │                              │  yesterday            │   │
│          │   └──────────────────────────────┴───────────────────────┘   │
│ ─────────│                                                              │
│ [EN|ع]   │                                                              │
│ ⟳ Synced │                                                              │
└──────────┴──────────────────────────────────────────────────────────────┘
 260px                       content: max 1100px @lg / 1200px @xl, centred
```

Grid contract (put this in CSS, do not eyeball it):

```css
.fm-shell { display: grid; grid-template-columns: 1fr; min-block-size: 100dvh; }

@media (min-width: 768px) {
  .fm-shell { grid-template-columns: 80px 1fr; }        /* icon rail */
}
@media (min-width: 1024px) {
  .fm-shell { grid-template-columns: 260px 1fr; }       /* full sidebar */
}

.fm-content-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  padding-inline: var(--fm-gutter-phone);
}
@media (min-width: 768px) {
  .fm-content-grid { grid-template-columns: repeat(8, minmax(0,1fr)); gap: 20px;
                     padding-inline: var(--fm-gutter-tablet); }
}
@media (min-width: 1024px) {
  .fm-content-grid { grid-template-columns: repeat(12, minmax(0,1fr)); gap: 24px;
                     padding-inline: var(--fm-gutter-desktop);
                     max-inline-size: 1100px; margin-inline: auto; }
}
@media (min-width: 1280px) { .fm-content-grid { max-inline-size: 1200px; } }
@media (min-width: 1536px) { .fm-content-grid { max-inline-size: 1320px; gap: 32px;
                                                padding-inline: 48px; } }
```

Card spans per screen are given in §7. Every card declares
`grid-column: span 4` (phone) / `span N` (md/lg) — no auto-placement guessing.

**Sidebar spec (≥1024).** Width 260 px, `.fm-glass`, `border-inline-end: 1px solid
var(--fm-border)`. Brand block 72 px tall. Nav items 44 px tall, `--fm-r-md`, 12 px inline
padding, icon 20 px + label `--fm-t-body`. Active: `--fm-accent-quiet #241C05` fill,
`--fm-gold-200` text, 3 px `--fm-gold-400` bar on the **inline-start** edge (mirrors in RTL).
Bottom block pinned with `margin-block-start: auto` holds the language switcher and the sync chip.

**Icon rail spec (768–1023).** Width 80 px, same glass, icons 22 px centred with a 10 px label
underneath (never icon-only — an unlabelled icon rail is a usability failure), item height 60 px,
active indicator as above.

**Top bar (≥1024).** Height 64 px, `.fm-glass`, sticky. Contents, inline-start → inline-end:
current date (`--fm-t-body`, `--fm-ink-2`), flexible spacer, sync chip, language switcher,
account avatar/menu button (36 px circle, initials, `--fm-surface-3` fill).

### 6.4 Density

Desktop is **not** "the same cards, wider". Concretely:
- List rows drop from 56 px to 48 px and gain columns (portion, kcal, P/C/F, meal, actions) —
  on phone those become two stacked lines.
- The Log screen becomes a genuine **two-pane** layout: search results on the inline-start,
  the selected food's portion panel pinned on the inline-end (no sheet, no navigation).
- History becomes a real table with sortable headers instead of stacked cards.
- Progress shows 4 charts at once in a bento; phone shows one per scroll section.

---

## 7. Screens

Notation: `[md/lg spans]` are `grid-column` values in `.fm-content-grid`.

### 7.1 Onboarding — `/onboarding`

Unchanged in structure (6 steps: sex, age, height, weight, activity, goal); retokenised.
- Phone: one question per screen, `--fm-t-display` question, big touch targets (`Segmented`
  options 56 px tall), a 6-dot progress row at the block-start, Back / Continue at the block-end.
- Desktop: **two columns** `[span 5]` + `[span 7]` — the inline-start column holds the step list
  (all 6 visible, current highlighted, completed ones clickable to go back), the inline-end column
  holds the current question. No wasted 900 px of empty space.
- The formula citation stays visible on the final step: "Targets use Mifflin-St Jeor ×
  activity factor, then your goal split. Cut = −20 %." (`--fm-t-body-sm`, `--fm-ink-3`.)

### 7.2 Today / Dashboard — `/`

**Phone** (single column, `[span 4]` each):
1. Header: h1 "Today", date, sync chip.
2. **Hero card** — calorie ring (132 px) + "Remaining 660 kcal" `--fm-t-metric-md` + 3 macro bars.
3. **Quick actions row** — 3 chips: `+ Log food` · `Scan a meal` · `Copy yesterday`. 44 px tall.
4. **Today's meals** — grouped by Breakfast / Lunch / Dinner / Snack; each group is a sub-header
   (`--fm-t-eyebrow`) + rows. Empty groups are not rendered.
5. **Streak tile** (compact) — "12-day streak" + status dot, links to Progress.
6. Bottom spacer 96 px.

**Desktop** (bento):
- `[span 5]` hero ring card (taller, ring 168 px)
- `[span 4]` three stat tiles stacked: Protein / Carbs / Fat, each `label · value · target ·
  mini progress bar`
- `[span 3]` "Remaining" tile — `--fm-t-metric-xl` hero number, the one hero figure on the screen
- `[span 8]` Today's meals table
- `[span 4]` right column: Quick add (favourites, 6 max) + Copy yesterday + Streak tile

**States:** loading = skeletons matching card geometry (ring → 132 px circle, `#221F1B`, 1.4 s
shimmer, or static under reduced motion). Empty = E-3 (§9). Error = never; local data cannot fail
to load, and a corrupt store falls back to the migration-recovery path with E-9.

### 7.3 Log — `/log`

**Phone**
```
┌────────────────────────────┐
│ Log            ⟳          │
│ Wed 12 Mar   ◄ [date] ►    │  ← date stepper; tapping [date] opens a picker
├────────────────────────────┤
│ 🔍 Search 184 foods…       │  56px, --fm-field, border --fm-border-field
├────────────────────────────┤
│ [All][Fav ★][Mine][Recent] │  filter chips, 36px, scrollable inline
├────────────────────────────┤
│ Chicken breast, raw     +  │  56px rows: name / cat · kcal per 100g
│ Poultry · 165 kcal /100 g  │
│ ────────────────────────── │
│ Labneh                ★ +  │  ★ = favourite toggle (44px hit)
│ Dairy · 174 kcal /100 g    │
│ ────────────────────────── │
│ My protein shake   👤 +    │  👤 badge = user-entered (custom food)
│ Custom · 121 kcal /100 g   │
└────────────────────────────┘
              (FAB) + Custom food
```
- **Date stepper** is how backdating works. `◄`/`►` step one day (mirrored in RTL — `◄` always
  means "previous day", so in RTL it renders on the inline-end side pointing inline-end). Future
  days are disabled with the tooltip "You can't log a day that hasn't happened."
  A "Today" pill appears whenever the selected day ≠ today, tapping it returns.
- Selecting a food opens the **PortionPanel** — bottom sheet on phone (`--fm-r-xl` block-start
  corners, drag handle 36×4 px `--fm-surface-4`, `.fm-glass`, max 88 dvh):
  grams stepper (−/+ 10 g, 44 px each) + numeric field + common-portion chips + live macro
  preview + meal selector (`Segmented`) + `Add to <day>` primary button.
- **Custom-food marking is mandatory and visual, not just a label**: a 20 px `User` lucide icon
  in `--fm-ink-3` inside a `--fm-surface-3` rounded square, plus the text "Custom · your numbers"
  in the row's second line, plus a footnote inside the portion panel:
  *"You entered these values. Modus hasn't checked them."* Reference foods get no badge but do
  get "Approximate reference values per 100 g" in the panel.

**Edit entry — `/log/entry/:id`** (sheet on phone, 480 px dialog on desktop):
title "Edit entry", the same portion controls pre-filled, a read-only line showing
"Logged 12 Mar, 13:04" and, if edited before, "Edited 12 Mar, 19:22". Actions:
`Save` (primary) · `Cancel` (ghost) · `Delete` (danger ghost, inline-end).
Delete asks for confirmation inline inside the sheet — the row is replaced by
"Delete this entry? [Delete] [Keep]" — no second modal.

**Favourites & quick-add — `/log/favourites`**: grid of favourite foods (2 cols phone / 4 desktop),
each a card with name, the last portion used, and a one-tap `+ Add 150 g` button. Star toggles
live on every food row app-wide.

**Copy yesterday**: a chip on Today and Log. Opens a confirm sheet listing exactly what will be
copied ("6 entries, 2 040 kcal — from Tue 11 Mar") with per-entry checkboxes (all checked) and
`Copy 6 entries`. Never copies silently. If yesterday is empty the chip is disabled with the
tooltip "Nothing logged yesterday."

**Desktop Log = two panes.** `[span 7]` search + results list (48 px rows, columns: name ·
category · kcal/100 g · ★ · +), `[span 5]` sticky portion panel. Keyboard: `/` focuses search,
`↑/↓` moves the result selection, `Enter` opens it in the panel, `Enter` again adds.

**States:** loading = 6 row skeletons. Empty search = E-7. Empty day = E-3 variant.

### 7.4 Scan — `/scan`

Unchanged flow (pick photo → analysing → editable review → log), retokenised.
- **Analysing** state: the photo at 40 % opacity with a `--fm-gold-400` sweep line under motion,
  or a static 3-dot `aria-live="polite"` "Analysing your photo…" under reduced motion. Include
  "This usually takes 10–20 seconds" — a real expectation, not a spinner.
- **Review** step: every item is an editable row with a `confidence` pill
  (`high` `--fm-ok-bg`/`--fm-ok` · `medium` `--fm-warn-bg`/`--fm-warn` · `low`
  `--fm-surface-3`/`--fm-ink-3`), each with its word, never colour alone. Banner above the list:
  *"These are estimates. Check them before you log."* (`--fm-warn-bg`, `--fm-warn` icon).
- 503 → E-5 (§9). 413/400 → inline error card with the real reason and a `Choose another photo`
  button. 429 → "Too many scans right now. Try again in a minute." with a countdown.
- Desktop: `[span 6]` photo + dropzone, `[span 6]` review list. Drag-and-drop supported with a
  dashed `--fm-border-strong` drop target.

### 7.5 Progress — `/progress` (new, primary)

**Phone** — vertical sections, each a card `[span 4]`:
1. **Range control** — segmented `30 d · 90 d · 1 y · All`, sticky under the header.
2. **Weight** card — §4.2.1 chart, 200 px tall, headline delta above it
   ("−2.8 kg in 90 days", `--fm-ok` + `▼`), `Add today's weight` secondary button.
3. **Calories** card — §4.2.2, 180 px tall.
4. **Macro trends** card — §4.2.3, three 64 px facets.
5. **Weekly averages** card — §4.2.4, up to 8 rows, "Show more" after 4.
6. **Streaks** card — §4.2.5 stat tile + calendar heatmap.

**Desktop bento:**
- `[span 12]` range control row (segmented + a date-range readout on the inline-end)
- `[span 8]` Weight chart (320 px tall)
- `[span 4]` stat tiles column: current weight · 90-day change · streak · days logged
- `[span 6]` Calories chart
- `[span 6]` Macro trends (three facets side by side)
- `[span 7]` Weekly averages table
- `[span 5]` Streak calendar

**Every card independently handles empty** — a user with weights but no food log sees a real
weight chart and E-6 inside the calories card. Never blank the whole screen.

### 7.6 Plan — `/plan`

Kept as-is in behaviour. Visual pass: the generated day becomes 4 meal cards
(Breakfast/Lunch/Dinner/Snack) each with its foods, portion and macro subtotal, plus a totals
strip showing plan vs target with a per-macro delta. `Log this whole day` primary button writes
the plan into the selected day (with the same confirm-list pattern as copy-yesterday).
Honesty line stays visible: *"A rule-based suggestion from your targets and the food database.
Not medical or dietary advice."*
Desktop: `[span 3]` × 4 meal cards in one row, `[span 12]` totals strip below.

### 7.7 History — `/history`

- Phone: list of day cards, newest first — date, kcal vs target with a mini bar, macro chips,
  entry count. Tap → day detail (`/history/:day`) with the full entry list, editable.
- Desktop: a **table** — `Date · Entries · kcal · Protein · Carbs · Fat · vs target`, sortable by
  date and by kcal, 48 px rows, sticky header on `--fm-black-raise`. Row click opens the day
  detail in a `[span 5]` side panel, list stays visible.
- Month grouping headers (`--fm-t-eyebrow`, sticky).
- Infinite scroll is banned (it breaks the back button and keyboard users). Use a
  `Load 30 more days` button.

### 7.8 Profile — `/profile`

Sections as cards:
1. **Your targets** — the computed numbers, with the formula named and the inputs editable
   inline. Changing an input shows a live "New target: 2 040 kcal (was 2 100)" preview and an
   explicit `Save targets` button. Never recompute silently.
2. **Body weight** — latest reading, sparkline, `Add reading` → `/profile/weight`.
3. **Preferences** — Language (EN/العربية `Segmented`), Reduced motion (switch).
4. **Your data** — Export JSON (downloads), Reset (danger, typed confirmation).
5. **Account** — see §7.9/§7.11.
6. **About** — version, the honesty notes, links to the food-data basis and the Mifflin-St Jeor
   citation, licence.

Desktop: `[span 4]` a sticky sub-nav listing the sections, `[span 8]` the sections themselves.

**Weight log — `/profile/weight`**: a form (weight, date defaulting to today) plus the list of
readings, each editable/deletable. One reading per day is enforced — re-adding for the same day
shows "You already logged 81.4 kg for 12 March. Replace it?" with `Replace` / `Cancel`.

---

### 7.9 Auth screens

All auth screens use a **centred single-column card**, max-inline-size 420 px, on the page
background, with the Modus mark above it. No sidebar, no tab bar. On desktop the card is
vertically centred; on phone it sits 48 px from the top so the keyboard does not cover it.

**Guest mode is never blocked.** Every auth screen has a visible
`Continue without an account` link (`LinkButton`, `--fm-ink-3`) — not hidden in fine print.

#### `/auth/sign-up` — Create account
```
◆ Modus
Create an account
Your log syncs to every device you sign in on.

Email                      [                    ]
Password                   [                    ] 👁
                           At least 10 characters.
                           ▓▓▓▓▓▓░░░░ Strength: good

[ Create account ]                          ← primary, full width, 48px
Continue without an account                 ← always present

⚠ We can't email you a reset link.
  You'll get a recovery code on the next screen. Save it.
```
- The recovery-code warning is shown **before** signup, in a `--fm-warn-bg` card with a
  `--fm-warn` `AlertTriangle` icon. It is not a surprise on the next screen.
- Email field: `type="email"`, `autocomplete="email"`, `inputmode="email"`.
  Password: `autocomplete="new-password"`, reveal toggle 44 px, `aria-pressed`.
- Strength meter: 4 segments, `--fm-danger` → `--fm-warn` → `--fm-gold-400` → `--fm-ok`,
  **always with the word** ("weak / fair / good / strong"). Segments are the shape channel.
- Email is labelled honestly: helper text *"Used only to sign in. Not verified, and we never
  send email."*
- Errors are **field-level**, `--fm-danger` 1.5 px border + `--fm-danger` message with an
  `AlertCircle` icon, `aria-describedby`, and the field keeps focus.
- Server-side "email already registered" must not leak (the project plan §2 forbids enumeration).
  UI copy for that case: the generic **"We couldn't create that account. Check your details and
  try again."** — one message for every failure class.

#### `/auth/recovery-code` — shown once
```
◆
Save your recovery code
This is the only way back into your account if you
forget your password. We can't email you a reset link.

┌──────────────────────────────────────┐
│  7K4M - 92QX - 8RTD - 51WV - 3NHA    │  ← --fm-font-mono, 20px, letter-spacing .06em
└──────────────────────────────────────┘     --fm-surface-2, 2px --fm-border-strong

[ Copy code ]  [ Download .txt ]            ← both secondary, 48px

☐ I've saved my recovery code somewhere safe

[ Continue ]                                ← DISABLED until the box is ticked
```
- The code is rendered in JetBrains Mono precisely so `0/O` and `1/l` cannot be confused.
- No "Skip". No dismissal by pressing Escape or the back button — the route replaces history.
- After `Continue`, the code is never shown again; `/account` states that plainly:
  *"Your recovery code was shown once at sign-up. If you've lost it, sign in and generate a new
  one — the old one stops working."*

#### `/auth/sign-in`
Email + password + `Sign in` + `Use a recovery code` link + `Continue without an account`.
One generic failure message, identical for wrong email and wrong password:
**"That email and password don't match."** No timing difference is visible to the user; the
server handles the timing side (the project plan §2).
Rate-limited state: the button disables and shows **"Too many attempts. Try again in 4:32."**
with a live countdown and `aria-live="polite"`.

#### `/auth/recover`
Email + recovery code (mono input, auto-uppercase, auto-hyphen every 4 chars, `inputmode="text"`,
`autocomplete="one-time-code"`) → sets a new password. Copy states: *"Using this code signs you
out everywhere and gives you a new code."*

#### `/account` — Account & sync
Cards: **Signed in as** (email + "not verified" tag, honest) · **Sync** (chip + last-sync time +
`Sync now`) · **Devices** (`Sign out everywhere`) · **Security** (`Change password`,
`New recovery code`) · **Danger zone** (`Delete account`).

#### `/account/delete` — Delete account
Full-screen, `--fm-danger` accented, never a small modal.
```
Delete your account
This deletes your account and everything synced to it:
  • 412 food entries
  • 96 weight readings
  • 14 custom foods
  • your profile and targets
It cannot be undone. We do not keep a copy.

The data on THIS DEVICE stays. You'll be signed out and
Modus keeps working offline with your local log.

[ Export my data first (.json) ]        ← secondary, tracked
Type DELETE to confirm   [        ]
[ Delete my account ]                   ← danger solid, disabled until exact match
[ Cancel ]
```
Counts are real, fetched before the screen renders (skeleton while loading). The
"data on this device stays" sentence is required — it is the single most reassuring true fact and
it directly implements the project plan §1 rule 3.

---

### 7.10 Sync states

One component, `SyncChip`, 6 states. Height 28 px, `--fm-r-full`, `--fm-surface-3` fill,
12 px inline padding, 14 px icon + `--fm-t-label` text. **Always icon + text.**
Placement: desktop top bar; phone screen header (Today, Log, Progress) and `/more`.

| State | Icon | Colour | Text | Live region |
| --- | --- | --- | --- | --- |
| `guest` | `UserRound` | `--fm-ink-4` | "On this device only" | — |
| `synced` | `Check` | `--fm-ink-3` | "Synced · 2 min ago" | — |
| `syncing` | `RefreshCw` (spins) | `--fm-gold-400` | "Syncing…" | `polite` |
| `queued` | `CloudOff` | `--fm-warn` | "Offline · 4 changes queued" | `polite` |
| `error` | `AlertTriangle` | `--fm-danger` | "Sync failed" + `Retry` button | `assertive` |
| `unconfigured` | — | — | **chip not rendered at all** | — |

**Banners.** Only two states escalate to a banner (48 px, full content width, above the first
card, `--fm-r-md`):
- `queued`: `--fm-warn-bg` / `--fm-warn` — *"You're offline. 4 changes are saved here and will
  sync when you're back."* Dismissible for the session.
- `error`: `--fm-danger-bg` / `--fm-danger` — *"Couldn't sync. Your log is safe on this device."*
  + `Retry` + `Details` (expands the real error string — no invented friendly lie).

**Never** block the UI on sync. There is no full-screen "syncing" state anywhere in the app.
Sync failure must not disable the Log screen.

**`sync_unconfigured`** — the deployment has no `DATABASE_URL`. Handle it exactly like
`ai_unconfigured` already is: hide auth entirely (no sign-in links, no `/account` row in More,
`/auth/*` redirects to `/`) and show E-4 in the Profile "Account" slot. Never a broken button.

---

### 7.11 `/sync/merge` — the adoption / merge screen

**The highest-risk screen in v3. It is designed here in full.**

**Trigger.** Sign-in completes → client pulls → *both* local data and account data are non-empty.
(Local-only → silent upload with a toast. Account-only → silent download with a toast. Neither →
nothing.) Navigating away is blocked: it is a route with no nav chrome, Escape does nothing, and
the browser back button re-enters it. There is one exit that is not a choice:
`Decide later — keep working offline`, which returns to `/` in **guest-sync-paused** mode with a
persistent `queued` banner. That exit exists because trapping a user is worse than delaying a merge.

**Phone layout** (stacked). **Desktop** `[span 6]` + `[span 6]` for the two comparison cards, the
choices below at `[span 12]`.

```
Your data is in two places
Sign-in never deletes anything. Choose how to put them together.

┌─ On this device ───────────┐  ┌─ In your account ──────────┐
│ 41 days logged             │  │ 96 days logged             │
│ 12 Feb – 12 Mar            │  │ 4 Dec – 10 Mar             │
│ 318 entries                │  │ 742 entries                │
│ 22 weight readings         │  │ 61 weight readings         │
│ 6 custom foods             │  │ 3 custom foods             │
│ 4 favourites               │  │ 9 favourites               │
│ Last change: today 14:02   │  │ Last change: 10 Mar 21:30  │
└────────────────────────────┘  └────────────────────────────┘

[ ⤓ Download a backup of this device's data (.json) ]   ← secondary, full width
   ✓ Backup saved (modus-backup-2026-03-12.json)     ← replaces the button once done

Choose one:
┌────────────────────────────────────────────────────────┐
│ ● Merge both        ★ RECOMMENDED                      │  ← radio card, selected:
│   Keep everything from both places.                    │     2px --fm-gold-400 border,
│   Where the same entry was changed in both, the        │     --fm-accent-quiet fill,
│   newer change is kept.                                │     --fm-elev-3
│   → Your account will gain 214 entries and 18 weights. │
│   → Nothing is deleted anywhere.                       │
│   → 3 entries were changed in both places. [Review]    │
├────────────────────────────────────────────────────────┤
│ ○ Keep this device only                                │  ← unselected: 1px --fm-border,
│   Replaces your account's data with this device's.     │     --fm-surface-1
│   ⚠ 528 entries and 39 weights in your account will    │  ← --fm-danger text + icon
│     be deleted.                                        │
├────────────────────────────────────────────────────────┤
│ ○ Keep account only                                    │
│   Replaces this device's data with your account's.     │
│   ⚠ 104 entries and 4 weights on this device will be   │
│     deleted. Download the backup above first.          │
└────────────────────────────────────────────────────────┘

[ Merge both ]                        ← primary; label mirrors the selection
Decide later — keep working offline   ← LinkButton
```

**Rules the developer must not soften:**

1. Every number on this screen is **real and computed before commit**. If a count cannot be
   computed (pull failed), the screen must not render — show the `error` sync banner instead and
   retry.
2. The primary button's **label always names the chosen action** ("Merge both", "Keep this
   device only") — never a generic "Continue".
3. For options 2 and 3 the primary button is **disabled** until either the backup has been
   downloaded *or* the user ticks `☐ I don't need a backup`. Option 1 needs no backup gate
   (nothing is deleted) but the backup button stays available.
4. Options 2 and 3 additionally require a **second confirm dialog** naming the exact counts:
   *"Delete 528 entries from your account? This can't be undone."* → `Delete and continue` /
   `Go back`.
5. Radio cards are real `<input type="radio">` in a `<fieldset>` with a `<legend>`; selection is
   signalled by **border weight + fill + a check glyph**, not colour alone. Whole card is the
   label (44 px+ hit area everywhere).
6. **[Review]** expands an inline list of the rows that differ:
   ```
   Chicken breast · 12 Mar · Lunch
     This device   180 g · 297 kcal · changed today 14:02   ← will be kept
     Your account  200 g · 330 kcal · changed 10 Mar 21:30
   ```
   Read-only, with an explicit sentence: *"Modus keeps the newer change. After merging you
   can edit any of these on the Log screen."* This is honest about last-write-wins
   (the project plan §2) instead of hiding it.
7. **Progress state** while committing: the choice cards freeze (`aria-busy="true"`), a
   determinate progress bar shows "Merging 214 of 532…", and the screen cannot be navigated away
   from. Interruption (tab close, network drop) must leave the local store untouched — the local
   store is only rewritten after the server batch acknowledges.
8. **Result screen** `/sync/merge/done`: a summary with real counts
   ("Added 214 entries · 18 weights · kept 3 newer versions · deleted nothing"), a
   `Go to Today` primary, and the honest line *"There's no undo. Your backup file, if you
   downloaded one, still has the previous state."*
9. **Failure mid-merge**: E-8 (§9) — *"The merge didn't finish. Nothing on this device was
   changed."* + `Try again` + `Decide later`. Never a partial-success message.

---

## 8. Component specifications

Every interactive component below is specified in all five states. `[F]` = focus-visible ring
`2px solid #F0D878, offset 2px` — it is on every one of them and is not repeated per row.

### 8.1 Button

Min height 48 (`md`) / 44 (`sm`). Radius `--fm-r-md`. `--fm-t-body` 600. Gap 8 px to icon.
Transition `background-color, color, box-shadow, transform` `--fm-dur-2` `--fm-ease-standard`.

| Variant | Default | Hover | Active | Focus | Disabled |
| --- | --- | --- | --- | --- | --- |
| **primary** | bg `#D4AF37`, ink `#0B0B0A`, `--fm-elev-accent` | bg `#F0D878` | bg `#B59521`, `scale(.97)`, elev none | `[F]` | bg `#35302A`, ink `#6B665D`, no shadow, `cursor: not-allowed` |
| **secondary** | bg `#221F1B`, ink `#F7F5F0`, 1 px `#594C21` | bg `#2B2721`, border `#8A7224` | bg `#35302A`, `scale(.97)` | `[F]` | bg `#1A1916`, ink `#6B665D`, border `#2B2721` |
| **ghost** | transparent, ink `#A8A296` | bg `#221F1B`, ink `#F7F5F0` | bg `#2B2721` | `[F]` | ink `#6B665D` |
| **danger-solid** | bg `#F05560`, ink `#0B0B0A` | bg `#F4726F` | bg `#D9414C`, `scale(.97)` | `[F]` | bg `#35302A`, ink `#6B665D` |
| **danger-quiet** | transparent, ink `#F05560`, 1 px `#F05560` | bg `#2E1D1C` | bg `#3A2422` | `[F]` | ink `#6B665D`, border `#2B2721` |

Loading: keep the width, replace the label with a 16 px spinner + the *same* label greyed
(`aria-busy="true"`, `aria-disabled="true"`), never a bare spinner. Under reduced motion the
spinner is static and the label reads "Saving…".

### 8.2 Text field / number field

Height 48. `--fm-field #221F1B`. Border 1 px `--fm-border-field #8A7224` (3.53:1 ✔).
Radius `--fm-r-sm`. Inline padding 14. Text `--fm-ink-1`, `--fm-t-body`.
Label above, `--fm-t-label`, `--fm-ink-2`. Helper below, `--fm-t-body-sm`, `--fm-ink-3`.

| State | Spec |
| --- | --- |
| Default | as above; placeholder `--fm-ink-4` (never `--fm-ink-disabled` — placeholders must be readable) |
| Hover | border `#B59521` |
| Focus | border `#D4AF37` + `[F]` ring; background unchanged |
| Filled | identical to default (no special styling — "filled" is not a state users need signalled) |
| Error | border 1.5 px `#F05560`, message below in `#F05560` with a 14 px `AlertCircle`, `aria-invalid="true"`, `aria-describedby` |
| Disabled | bg `#1A1916`, border `#2B2721`, text `#6B665D`, `cursor: not-allowed` |

Number fields keep the v2 rule (spinners hidden) and gain `inputmode="decimal"`.
**Never** rely on `type=number` for grams — use `inputmode="decimal"` + validation, so Arabic
keyboards and comma decimals behave.

### 8.3 List row (food, entry, history, settings)

Min height 56 phone / 48 desktop. Full-width tap target. `--fm-surface-1` on `--fm-black`, or
transparent inside a card with a 1 px `#2B2721` bottom rule (last child has none).

| State | Spec |
| --- | --- |
| Default | transparent |
| Hover | bg `#221F1B` |
| Active/press | bg `#2B2721` |
| Focus | `[F]` inset by 2 px so the ring is not clipped by the card |
| Selected | bg `--fm-accent-quiet #241C05`, 3 px `#D4AF37` bar on the inline-start edge |
| Disabled | ink `#6B665D`, no hover |

Swipe actions on phone (edit / delete) are **additive only** — every swipe action also exists as a
visible button in the row's overflow menu, because swipe is invisible and inaccessible.

### 8.4 Chip / filter chip / segmented

Chip: height 36 (44 px hit area via `padding-block`), radius `--fm-r-full`, `--fm-surface-3` fill,
`--fm-ink-2` text, `--fm-t-label`.
Selected: `--fm-gold-400` fill, `#0B0B0A` text, plus a 14 px `Check` glyph (shape channel).
Hover `--fm-surface-4`. Active `scale(.97)`. Disabled `--fm-ink-disabled`, no fill change.
Segmented control: a `role="radiogroup"` of chips inside a `--fm-surface-2` track,
`--fm-r-full`, 3 px inner padding; the selected pill slides `--fm-dur-2` (instant under reduced
motion).

### 8.5 Card

`--fm-surface-1`, `--fm-r-lg`, padding 20 (16 on phone for dense lists), 1 px `--fm-border`,
`--fm-elev-0`. Interactive cards (merge choices, favourites) add hover `--fm-elev-1` +
border `--fm-border-strong`, and `[F]`.

### 8.6 Bottom sheet / dialog

Sheet (phone): `.fm-glass`, block-start radius `--fm-r-xl`, drag handle 36×4 `--fm-surface-4`,
max block-size 88 dvh, scrim `--fm-scrim`, `--fm-elev-3`. Focus trapped, focus returns to the
trigger on close, `Escape` closes, scrim click closes — **except** on `/sync/merge` confirms and
the recovery-code screen.
Dialog (≥768): centred, max-inline-size 480 (or 560 for the merge confirms), `--fm-r-xl`,
`--fm-surface-1` (opaque — dialogs often hold numbers), `--fm-elev-3`.

### 8.7 Toast

`--fm-surface-2`, `--fm-r-md`, `--fm-elev-2`, 1 px `--fm-border-strong`, 16 px padding, max
inline-size 400, positioned block-end 88 px (above the tab bar) on phone, block-end 24 px
inline-end 24 px on desktop. Icon + message + optional action. `role="status"` for success,
`role="alert"` for failure. Never used for anything the user must act on.

### 8.8 SyncChip / StatusBadge

Spec in §7.10. Badge variant (used for confidence, "custom", "unverified"): height 22,
radius `--fm-r-xs`, `--fm-t-body-sm` 600, tinted background + matching ink from the
`--fm-*-bg` / `--fm-*` pairs, plus a 12 px icon.

### 8.9 Skeleton

`--fm-surface-2` fill, exact geometry of the content it replaces, `--fm-r-sm`.
Shimmer: `linear-gradient(100deg, transparent 20%, rgba(247,245,240,.05) 50%, transparent 80%)`
translating over 1.4 s. Under reduced motion the shimmer is removed and the block sits static.
`aria-hidden="true"` on the skeleton; the container carries `aria-busy="true"`.
**Skeletons only for content that is genuinely loading from a network.** Local store reads are
synchronous — do not fake a skeleton for them.

---

## 9. Empty states — all of them, drawn

Component: extend the existing `EmptyState` with an optional `secondaryAction` and `tone`
(`neutral` | `warn` | `danger`). Geometry: dashed 1 px `--fm-border` (warn: `--fm-warn` at 40 %),
`--fm-r-lg`, 40 px block padding, centred, icon in a 48 px `--fm-surface-2` rounded square,
title `--fm-t-h3`, body `--fm-t-body-sm` `--fm-ink-3` max 38ch, then actions.

| ID | Where | Icon | Title | Body | Actions |
| --- | --- | --- | --- | --- | --- |
| **E-1** | Profile → Account, signed out (sync configured) | `UserRoundPlus` | "You're not signed in" | "Modus is saving everything on this device. Create an account and your log follows you to your phone, laptop and back." | `Create account` (primary) · `Sign in` (ghost) |
| **E-2** | Progress, no data at all | `TrendingUp` | "Nothing to show yet" | "Log a few days of food and add a weight reading — your trends appear here once there's something real to draw." | `Log food` (primary) · `Add weight` (secondary) |
| **E-3** | Today / Log, nothing logged for the selected day | `UtensilsCrossed` | "Nothing logged for Wednesday" | "Search the food database, scan a photo, or copy yesterday." | `Search foods` (primary) · `Copy yesterday` (secondary, disabled + tooltip if yesterday is empty) |
| **E-4** | Profile → Account, `sync_unconfigured` | `CloudOff` | "Accounts aren't set up on this deployment" | "This copy of Modus has no database connected, so there's nothing to sign in to. Everything still works and stays on this device." | `Export my data` (secondary) |
| **E-5** | Scan, 503 `ai_unconfigured` | `CameraOff` | "Photo scanning isn't set up here" | "This deployment has no AI key, so scanning is switched off. You can still log any of the 184 foods by searching." | `Search foods` (primary) |
| **E-6** | Progress → Weight card, < 2 readings | `Scale` | "One reading — no trend yet" *(or "No weight readings yet")* | "Add another reading on a different day and the trend line appears." | `Add today's weight` (primary) |
| **E-7** | Log search, no matches | `SearchX` | "No food matches "labnehh"" | "Check the spelling, try a shorter word, or add it as your own food." | `Create "labnehh" as a custom food` (primary) |
| **E-8** | `/sync/merge`, commit failed | `AlertTriangle`, tone `danger` | "The merge didn't finish" | "Nothing on this device was changed and nothing was deleted. Your log is exactly as it was." | `Try again` (primary) · `Decide later` (ghost) |
| **E-9** | App boot, stored data could not be read | `FileWarning`, tone `warn` | "We couldn't read your saved data" | "Modus found data it doesn't recognise and hasn't touched it. You can download the raw file and start a fresh log." | `Download the raw file` (secondary) · `Start fresh` (danger-quiet, typed confirm) |
| **E-10** | Offline + never synced, on `/account` | `WifiOff`, tone `warn` | "You're offline" | "4 changes are saved on this device and will sync as soon as you're back online. Nothing is lost." | `Retry now` (secondary) |
| **E-11** | Favourites, none yet | `Star` | "No favourites yet" | "Tap the star on any food and it lands here for one-tap logging." | `Browse foods` (primary) |
| **E-12** | Custom foods, none yet | `UserRoundPen` | "No foods of your own yet" | "Add anything the database doesn't have — your own recipe, a local brand, your protein shake." | `Add a custom food` (primary) |
| **E-13** | History, nothing at all | `CalendarDays` | "No history yet" | "Days you log show up here, newest first." | `Log today` (primary) |
| **E-14** | Plan, no profile | `ClipboardList` | "Set your targets first" | "The planner builds a day from your calorie and macro targets. Two minutes of setup and it's ready." | `Set up targets` (primary) |

**Rules:** the empty-state title always names the *specific* thing that is empty (including the
day name or the search term). No illustration is invented for a state that is actually an error —
E-8/E-9/E-10 use tone + icon, not friendly art. **No empty state ever shows sample data.**

### Loading, error and success states — the pattern

| Kind | Pattern |
| --- | --- |
| **Loading (network)** | Skeletons matching final geometry. Progress screen: chart-shaped skeletons with the axis chrome already drawn. Never a full-screen spinner. |
| **Loading (local)** | None. Local store reads are synchronous — render the real thing. |
| **Loading (action)** | The button enters its loading state (§8.1); the rest of the screen stays interactive unless the action is destructive. |
| **Error (recoverable)** | Inline card at the point of failure, `--fm-danger-bg`, `AlertCircle`, the real reason in plain words, and a `Retry`. Never a toast for something that needs action. |
| **Error (field)** | §8.2 error state, focus stays in the field. |
| **Error (fatal)** | A route-level error boundary card: what broke, that local data is untouched, `Reload` + `Export my data`. |
| **Success** | Toast, `role="status"`, `--fm-ok` `CheckCircle2`, 5 s. Plus the affected number gets the 600 ms `--fm-accent-quiet` flash. Never a modal, never a full-screen confetti moment. |

---

## 10. RTL specification

Arabic is a designed direction, not a translated one.

### 10.1 Mechanics

- `<html lang="ar" dir="rtl">` set by the i18n layer; `lang`/`dir` change together, always.
- **All** directional CSS uses logical properties. Ban list for code review:
  `margin-left/right`, `padding-left/right`, `left`, `right`, `text-align: left/right`,
  `border-left/right`, `float`, and the Tailwind utilities `pl- pr- ml- mr- left- right-
  text-left text-right border-l border-r rounded-l rounded-r`.
  Use `ps- pe- ms- me- start- end- text-start text-end border-s border-e rounded-s rounded-e`.
- Font: Cairo Variable, loaded dynamically only for `ar` (§3.1).
- **Digits stay Latin** in both locales — `numberingSystem: 'latn'` on every `Intl.NumberFormat`
  and `Intl.DateTimeFormat`. Arabic-Indic digits are a v4 preference, not a default.
- Numbers, units and dates are LTR runs inside RTL text. Wrap them:
  `<bdi>` or `unicode-bidi: isolate` on every number/unit span, otherwise `165 kcal /100 g`
  scrambles next to Arabic.
- Line-height and sizes per §3.1. Never apply `letter-spacing` or `text-transform: uppercase`
  to Arabic.

### 10.2 What mirrors and what does not

| Element | RTL behaviour |
| --- | --- |
| Sidebar / icon rail | Moves to the inline-end (right) edge. Active indicator bar stays on the **inline-start** edge of the item. |
| Bottom tab bar | Item order **reverses**: Today is the rightmost tab. |
| Back chevron, breadcrumb chevrons, list-row chevrons | **Mirror** (use `ChevronLeft`/`ChevronRight` chosen by `dir`, not `transform: scaleX(-1)` — scaling flips the stroke terminals) |
| Date stepper ◄ ►| **Mirror.** "Previous day" is always the arrow pointing toward the inline-start reading direction. |
| Progress bars, macro bars, calorie ring | **Mirror.** Bars grow from the inline-start edge; the ring's fill starts at 12 o'clock and sweeps **anticlockwise** in RTL. |
| Charts (time axis) | **Mirror.** Oldest on the right, newest on the left. Y-axis labels move to the right edge. Bars grow right→left. |
| Chart implementation | Reverse the **data order and the scale range**, never `transform: scaleX(-1)` on the SVG — that mirrors the digits too. Recharts: `reversed` on the XAxis, `orientation="right"` on the YAxis, and reverse the tick array. |
| Tooltip anchor | Flips to the inline-start of the cursor. |
| Icons that are objects, not directions — camera, star, scale, utensils, trash, user | **Do not mirror.** |
| Trend arrows ▲ ▼ | **Do not mirror.** Up is up in every language. |
| Logo / wordmark | Does not mirror. |
| Toast / FAB position | Follow the inline axis (FAB goes to the inline-end = left in RTL). |
| Sheet drag handle, dialogs | Unchanged (vertical). |
| Swipe-to-delete direction | Follows the inline axis. |

### 10.3 Copy budget

Arabic UI strings run **20–35 % longer** than English. Every label container must wrap or
truncate gracefully:
- Tab labels: allow 2 lines at 10 px, or truncate with a `title`. Never let a tab label push the
  bar taller than 64 px.
- Buttons: never fixed-width; `min-inline-size` only.
- Stat tiles: the label may wrap to 2 lines; the number never shrinks.
- Test string for layout QA: `"إعادة إنشاء رمز الاسترداد"` (Account → New recovery code) and
  `"تعذّرت المزامنة. سجلّك محفوظ على هذا الجهاز."` (sync error banner).

---

## 11. 3D / WebGL — permitted, budgeted, and deliberately small

### The honest reading of the budget

the project plan §5 caps this at **≤ ~150 KB gzipped**, off the first-paint path, disabled under
reduced motion, with a static fallback, and *never* required to read a number. A tree-shaken
Three.js core alone lands in the ~110–150 KB gzipped range before you add React Three Fiber and
drei — so **R3F/Three.js does not fit this budget** and is out. The
`modern-3d-ui-design` skill's own decision table also says: *"Dashboard → bento grid, data-dense,
minimal motion, no 3D unless a dataset genuinely has 3 axes."* Modus's data has two axes.

So v3 gets **depth**, not a 3D engine.

### 11.1 Tier 1 — CSS depth (default, 0 KB, ships to everyone)

- **Surface stepping + one shadow scale** (§3.4) carries the hierarchy.
- **Onboarding hero mark**: the gold `◆` Modus mark on a `transform-style: preserve-3d`
  wrapper with `perspective: 900px`, tilting ±6° on pointer move (`rotateX`/`rotateY` driven by
  a `requestAnimationFrame`-throttled pointer handler). Desktop only, pointer devices only
  (`@media (hover: hover) and (pointer: fine)`).
- **Card lift**: interactive cards translate `-2px` on the block axis on hover with
  `--fm-elev-1 → --fm-elev-2`.
- **Ring depth**: the calorie ring gets an inner `box-shadow: inset 0 2px 6px rgba(0,0,0,.5)` on
  the track and a 1 px `rgba(240,216,121,.10)` rim highlight. That is the entire "3D" of the
  hero element.
- All of it is inside the global reduced-motion kill switch.

### 11.2 Tier 2 — one optional WebGL layer (opt-in, hard-capped)

**If** a WebGL flourish is wanted, it is exactly one thing: an **ambient gold caustic backdrop**
behind the Today hero card and the onboarding hero — a single full-quad fragment shader, no
geometry, no model, no library.

| Constraint | Value — treat as a build gate |
| --- | --- |
| Library | **none** (raw WebGL2) or **OGL** (~10 KB gz) if a helper is wanted. **Three.js / R3F are forbidden by the budget.** |
| Total added transfer | **≤ 18 KB gzipped**, verified with `vite-bundle-visualizer` in CI. If the number is higher, the feature does not ship. |
| Load timing | `IntersectionObserver` + `requestIdleCallback`, dynamic `import()`. **Never** on the first-paint path, never before the hero numbers have painted. |
| Reduced motion | The module is **not imported at all**. A static CSS radial gradient renders instead. |
| Capability gate | Skipped entirely if any of: `navigator.hardwareConcurrency < 4`, `matchMedia('(prefers-reduced-motion: reduce)')`, `navigator.connection.saveData`, `deviceMemory < 4`, no WebGL2 context, or `document.hidden`. |
| Frame budget | 30 fps cap (`setTimeout`-throttled RAF), canvas rendered at `min(devicePixelRatio, 1.5)`, resolution capped at 640×640 and CSS-scaled up — it is a blurred gradient, nobody can tell. |
| Lifecycle | `pause()` on `visibilitychange`, on tab blur, and when the canvas leaves the viewport. `dispose()` on unmount. |
| Layering | `z-index: 0`, `pointer-events: none`, always **behind** an opaque `--fm-surface-1` card. **No number, chart, label or control ever sits directly on it.** |
| Fallback | `background: radial-gradient(ellipse 120% 80% at 50% -10%, #1C1A15 0%, #0B0B0A 55%)` — i.e. exactly the v2 `--app-glow`, which is already in the repo. The fallback *is* the current design, so the failure mode is "v2's background". |
| Battery | Disabled when `navigator.getBattery()` reports `charging === false && level < 0.2`, where the API exists. |

**Definition of done for Tier 2:** if any of these is not met, ship Tier 1 and delete the module.
Tier 2 is a nice-to-have that must cost nothing when absent — which is why the fallback is the
existing background and not a new asset.

---

## 12. Accessibility contract

Beyond the non-negotiables in §0:

| Requirement | Implementation |
| --- | --- |
| Contrast | §2.3. Every pair in the app must appear in that table. |
| Touch targets | ≥ 44×44 CSS px, including chart points (invisible 44 px hit bands), star toggles, chip removes, calendar cells. |
| Focus order | Follows DOM order. Skip link (already present) stays. Sheets/dialogs trap focus and restore it to the trigger. |
| Focus visibility | `2px solid #F0D878`, offset 2, `border-radius: 4px`. 12.39:1 on surface-1 — visible on every surface in the app. |
| Keyboard | Every action reachable without a pointer. `/` focuses search on Log. `Esc` closes sheets. Arrow keys move within `Segmented`, chip groups, and chart points. Swipe actions always have a button equivalent. |
| Screen reader — numbers | Rings/bars are `aria-hidden` SVG with a real sr-only sentence beside them (the existing `MacroRing` pattern — keep it). |
| Screen reader — charts | §4.3: `<figure>` + generated `<figcaption>` + a real data `<table>` behind a disclosure. |
| Live regions | `aria-live="polite"`: sync status changes, "entry added", "targets updated", scan progress. `aria-live="assertive"`: sync failure, auth rate-limit, merge failure. Never both on one node. |
| Forms | Every input has a real `<label>`. Errors use `aria-invalid` + `aria-describedby`. Required fields marked in text, not with a red asterisk alone. |
| Motion | §3.7. OS preference **and** the in-app toggle. |
| Colour-blindness | §4.1 validated at ΔE ≥ 11.2 under deuteranopia/protanopia; status always icon + word; over-target always carries a `▲` glyph. |
| Zoom | Layout must survive 200 % browser zoom and a 320 px viewport without horizontal scrolling. Test at 320×568. |
| Language | `lang` on `<html>` switches with the locale; any inline foreign-language run (a food's Arabic name inside English UI) gets its own `lang`. |
| Reduced transparency | `@media (prefers-reduced-transparency: reduce)` → `.fm-glass` becomes opaque `#161513`, no backdrop-filter. |
| Forced colors | `@media (forced-colors: active)` → remove all decorative backgrounds/shadows, use system colours, auto-expand chart data tables. |

---

## 13. Handoff: how to land this in the repo

### 13.1 File layout

```
src/styles/tokens.css     ← NEW. §2.1 + §2.2 only. The single source of colour.
src/index.css             ← imports tokens.css; keeps the base layer, focus ring,
                             reduced-motion rules, .ambient-grid; gains .fm-glass,
                             .fm-grain, .fm-content-grid, .fm-shell.
tailwind.config.ts        ← maps semantic tokens to utility names. No raw hex.
```

Keep the v2 aliases (`--gold`, `--surface`, `--danger`, …) as pass-throughs to the new tokens
for one release so the 317 existing tests and untouched components keep working:

```css
:root {
  --black: var(--fm-black);        --surface: var(--fm-surface-1);
  --surface-2: var(--fm-surface-2); --surface-3: var(--fm-surface-3);
  --white: var(--fm-ink-1);        --gray: var(--fm-ink-3);
  --gray-soft: var(--fm-ink-4);    --gold: var(--fm-gold-400);
  --gold-light: var(--fm-gold-200); --gold-dim: var(--fm-gold-600);
  --danger: var(--fm-danger);      --success: var(--fm-ok);
  --protein: var(--fm-data-protein); --carbs: var(--fm-data-carbs); --fat: var(--fm-data-fat);
}
```

Note the three deliberate value changes an alias cannot hide: `--danger` `#E2685F → #F05560`,
`--success` `#7FC28A → #55C483`, and the three macro hues. Snapshot tests asserting those hexes
must be updated deliberately, with the reason ("re-stepped for CVD separation, see DESIGN.md §4.1").

### 13.2 Tailwind additions

```ts
screens: { /* defaults */ },
maxWidth: { app: '480px', content: '1100px', 'content-xl': '1200px', 'content-2xl': '1320px' },
borderRadius: { xs: '6px', sm: '10px', md: '14px', lg: '22px', xl: '28px' },
transitionTimingFunction: {
  emphasis: 'cubic-bezier(.22,1,.36,1)',
  standard: 'cubic-bezier(.2,0,0,1)',
  exit:     'cubic-bezier(.4,0,1,1)',
},
transitionDuration: { 1:'120ms', 2:'180ms', 3:'240ms', 4:'320ms', 5:'520ms' },
boxShadow: { e1:'…', e2:'…', e3:'…', accent:'…' },   /* §3.4 verbatim */
```
Enable Tailwind's logical-property utilities (`ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`,
`border-s`, `rounded-s`) — these are built in; the work is banning the physical ones in ESLint.

### 13.3 Suggested order of implementation (matches the project plan P3.1)

1. `tokens.css` + Tailwind map + the v2 aliases. Nothing visual changes yet; tests stay green.
2. `AppShell` → `.fm-shell` grid, sidebar + icon rail + tab bar, `/more` route, `/progress` route
   stub. Verify at 390 px and 1440 px.
3. Retokenise `Button`, `Field`, `Card`, `EmptyState`, `ScreenHeader`, `Segmented`, `MacroRing`.
4. Logical-property sweep + the ESLint ban rule (do it before RTL, not during).
5. Then P3.2 → P3.5 as planned.

### 13.4 What "done" looks like for the design

- 390 px and 1440 px screenshots of every screen in §7, in both `en` and `ar`.
- Every contrast pair used appears in §2.3.
- `node scripts/validate_palette.js` re-run and pasted into the PR if any chart colour moved.
- No `pl-/pr-/ml-/mr-/left-/right-` in `src/`.
- Reduced motion on: nothing animates, nothing is missing, no WebGL context is created.
- The Progress screen with an empty store shows E-2, not a curve.
- `/sync/merge` reachable in dev with a seeded fixture (local data + account data) and every
  number on it real.

---

## 14. Open decisions handed to other agents

| Decision | Owner | Note |
| --- | --- | --- |
| `user_settings.theme` stays in the schema but is written as `'dark'` and never exposed | backend | §2.0 — no theme toggle in v3 |
| Merge screen needs pre-commit **counts** from the sync API before it can render | backend | `/api/sync/pull` must return per-table counts and a `conflicts[]` preview (id, table, both `updated_at`s), or the client must compute them from a full first pull. §7.11 rule 1 depends on it. |
| Arabic food names (`nameAr` × 184) | frontend (P3.5) | Design assumes they exist; the Log row layout allows the Arabic name as the primary line with the English underneath in `--fm-ink-4` when `lang=ar` |
| Recovery-code format (5 × 4 chars, Crockford-style alphabet excluding `I L O U`) | backend | §7.9 renders it in mono and hyphenates every 4 — the alphabet choice is a security/UX decision that should match |
| Streak rule (±15 % of calorie target, ≥1 entry) | frontend (P3.3) | §4.2.5 states it on screen; if the implemented rule differs, the on-screen sentence must change with it |
