# Trinetra style guide

**Phases 10–14 must follow this guide.** If a screen needs something that is not here, add it to the shared components and to this guide in the same commit.

Goal: **simple and attractive.** One main thing on each screen, a lot of room, and the same part used the same way everywhere.

- Colours and effects live in [globals.css](../../apps/web/src/app/globals.css) as CSS variables.
- Components live in [apps/web/src/components](../../apps/web/src/components).
- See them in `pnpm dev`: <http://localhost:3000/dev/ui> (dashboard) and `/dev/ui?kiosk=start`, `details`, `weight`, `question`, `number` (weighbridge). Development only.
- Pictures of the screens are in [docs/screenshots/ui-update](../screenshots/ui-update). `pnpm screenshots` takes them again.
- The design references (`kiosk-reference-*.png`, `dashboard-reference.png`) are kept on the development computer only. They show names and numbers that are not ours, and the repository is public. Only their **look** was copied.

## Rules that always apply

1. **Use token names, never colour values:** `bg-card`, `text-muted-foreground`, `border-input`. The only exceptions are the decorative glows inside `ActionCard`, `LiveWeight`, the kiosk header icon and the welcome banner.
2. **A status colour always comes with an icon and a word.** Use `StatusPill`, `StatusLight` or `Banner`; never a coloured dot or coloured text alone.
3. **All screen text goes in both `en.json` and `hi.json`** and is read with `useT()`. Check every new screen in Hindi: its words are often longer.
4. **Digits are 0–9 in both languages.** Weights use `formatKg()`, times `formatIST()`.
5. **The backend owns the weight.** A component may show a weight; nothing sends one.
6. **Made-up data is marked** with `SampleTag`, uses plates starting `XX` and tickets starting `SAMPLE`, and lives only in `src/lib/sample-data.ts` (and `/dev`). Delete it when the real data arrives.

## Themes

`ThemeRoot` switches a theme on with `data-theme`. The shells do this for you. Dialogs and messages take the theme of the shell they are opened from. In class names, `kiosk:` applies only inside the kiosk theme.

| Theme       | Used for                                      | Look                                                       |
| ----------- | --------------------------------------------- | ---------------------------------------------------------- |
| `kiosk`     | `/kiosk/*`                                    | Deep navy with a faint grid and glow, glass cards, glowing |
| `dashboard` | Supervisor, store officer and every other page | Navy sidebar and top bar, light grey page, white cards     |

## Colours

### Shared

| Token                         | Value                 | Use                                                |
| ----------------------------- | --------------------- | -------------------------------------------------- |
| `nav`                         | `#06182b`             | Rail and sidebar. It matches the navy in the logo  |
| `nav-foreground`, `nav-muted` | `#ffffff`, `#aebfd6`  | Text on navy                                       |
| `nav-active` → `-to`          | `#0a62e0` → `#063f9a` | The filled pill of the current page                |
| `nav-danger`                  | `#ff7b82`             | Logout on navy                                     |

### Kiosk and dashboard

| Token                     | Kiosk                     | Dashboard             | Use                                  |
| ------------------------- | ------------------------- | --------------------- | ------------------------------------ |
| `background`              | `#040f26`                 | `#f2f6fb`             | The page                             |
| `card` (`card-solid`)     | navy glass (`#07193a`)    | `#ffffff`             | Cards                                |
| `card-border`             | blue at 42%               | `#e3eaf4`             | Card edge (glows on the kiosk)       |
| `foreground`              | `#ffffff`                 | `#0f1c33`             | Headings and values                  |
| `muted-foreground`        | `#b4c4df`                 | `#4f5d75`             | Body text and labels                 |
| `highlight`               | `#35d6ea` (cyan)          | `#0757b8`             | Subtitles; a value to notice         |
| `live`                    | `#3ef08a`                 | `#0f7a3b`             | The live weight, a good result       |
| `primary` → `primary-to`  | `#1766ee` → `#0649bd`     | `#0a6ae6` → `#0757c7` | The main button                      |
| `bar` → `bar-to`          | not used                  | `#0c1f37` → `#12315a` | Top bar                              |

### Status colours

| Tone   | Colour | Means                  | Icon      |
| ------ | ------ | ---------------------- | --------- |
| `info` | blue   | arrived, information   | i         |
| `wait` | orange | waiting, pending       | hourglass |
| `go`   | green  | done, approved         | ✓         |
| `stop` | red    | rejected, blocked      | ✕         |
| `idle` | grey   | not started            | –         |

Each tone has a solid colour, a soft background and an ink for text on it, set for each theme. `themes.test.ts` checks that text stays readable (4.5 : 1). **Add any new pair to that test.**

### KPI circles (dashboard only)

Light blue, light orange, light green and light purple (`kpi-*`). They **decorate** and do not mean a status, so do not give a bad number the green circle: it reads as good news.

## Fonts

- **Noto Sans**, with **Noto Sans Devanagari** for Hindi. They are installed with the website, not loaded from Google.
- Weights: 400 body, 600 buttons and values, 700–800 headings and big numbers.

| Text                  | Kiosk                    | Dashboard                    |
| --------------------- | ------------------------ | ---------------------------- |
| Page title            | 40 px, 800, capitals     | 24 px (18 on a phone), 700   |
| Card title / question | 40–48 px, 700            | 18 px, 700                   |
| Body, labels, buttons | **32 px** (the smallest) | 16 px; tables and notes 14   |
| Smallest              | 32 px                    | 12 px: tab names, tags, times |
| Big numbers           | live weight 112 px       | KPI 30 px (24 on a phone)    |

Size everything on the kiosk in `rem`, never fixed `px`: the 1920×1080 screen is the same layout made larger by raising the base size.

## Spacing and shape

- Spacing is in steps of 4 px. Between blocks: **12–16 px**. Inside a card: 12–16 px on the dashboard, 24 px on the kiosk.
- Corners: dashboard cards 12 px and controls 8 px; kiosk cards 24 px and buttons 16 px.
- Borders: 1 px on the dashboard, 2 px on kiosk controls.
- Shadows: `shadow-card` and `shadow-primary`, `shadow-go`, `shadow-stop`. They are soft shadows on the dashboard and glows on the kiosk.

## Driver rules (kiosk)

These are measured by `expectDriverRules()` in [tests/e2e/driver-rules.ts](../../tests/e2e/driver-rules.ts). **Every new kiosk screen needs that check at 1366×768 and 1920×1080, in English and Hindi, with its longest message showing.**

- **One screen, one question.** One sentence and one action.
- **No scrolling** at 1366×768.
- **Text at least 32 px. Buttons at least 96 px tall.**
- **No keyboard** for drivers: only the number pad (phone number) and, as a last resort, a plate keypad.
- **Yes and No** are `YesNo`: green ✓ left, red ✕ right, in the bottom bar.
- **At most three buttons in the bottom bar**, in this order: wrong or stop (`danger`), neutral (`dark`), the way forward (`primary`, rightmost).
- The language button and Help are always in the rail; do not repeat them.

With a one-line header at 1366×768, the middle has about **600 px** alone, **500 px** with a bottom bar, and **450 px** with the status lights and a bottom bar. In practice, with both: a banner plus a `DetailGrid` of 5 rows (10 items) is the most that fits. A title that wraps takes about 50 px away.

## The two shells

### `KioskShell` (`layout/kiosk-shell.tsx`)

| Part       | Content                                                                              |
| ---------- | ------------------------------------------------------------------------------------ |
| Left rail  | Logo mark, "TRINETRA SYSTEMS", the system name, the language button, **Help**         |
| Header     | `header={{ icon, title, subtitle }}`: a round glowing icon, a big title, a cyan line |
| Top right  | The date and time in India (`ClockChip`)                                             |
| `status`   | Live lights: weighbridge and connection                                              |
| Middle     | The screen's one question                                                            |
| `actions`  | The bottom bar: 1 to 3 buttons, equally wide                                         |

Keep titles to about 18 letters so they stay on one line.

**Help does not call anyone yet:** it tells the driver to go to the store office. Phase 10 connects it to `POST /api/help`.

### `DashboardShell` (`layout/dashboard-shell.tsx`)

Use it through `RoleShell`, which fills it in. The menus are in `src/lib/menus.ts`.

| Width         | Navigation                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------- |
| 768 px and up | Navy sidebar: full logo, icon + label, the current page as a blue pill, language and **Log out** (red outline) at the bottom. The menu button hides it |
| Below 768 px  | The same sidebar as a drawer behind the menu button, plus a bottom tab bar with the four pages       |

Top bar: menu button, page title with the connection light (and the subtitle on wide screens), date and time, the bell with a red count, and the user's picture with name and role (name and role on very wide screens). On a phone it keeps only the menu button, title, connection, bell and picture.

**The bell counts sample alerts** until Phases 12 and 13.

A menu may have **3 or 4 pages**; the bottom tab bar cannot hold more. Give each a short tab name.

### `AuthShell` (`layout/auth-shell.tsx`)

The full logo and one white card on navy: the staff logins and pages without a menu. Phase 14's public pages and the driver's phone upload page can use it.

## Components

### Both themes (`components/ui`)

| Component     | When to use it                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`      | Every button. `primary` the one main action · `outline` a second choice · `dark` neutral actions in the kiosk bar · `danger` wrong, reject (red outline) · `go` / `stop` yes and no, approve · `ghost` quiet · `nav`, `nav-danger` on navy. Sizes `sm` (table rows), `default`, `lg`; in the kiosk theme every size is at least 96 px |
| `YesNo`       | A yes-or-no question. Never build these two buttons another way                                                                                   |
| `Card`        | A group of related things: a white card, or a glass panel on the kiosk                                                                           |
| `Banner`      | A strip with a round icon for one or two lines: "Please check your details", a warning, a good result. At most one or two on a screen             |
| `StatusPill`  | The status **of a thing** in a list or a card: "Waiting", "Rejected"                                                                             |
| `StatusLight` | Something **live** now: the connection, the weighbridge, a stable weight                                                                         |
| `NumberPad`   | PINs and phone numbers. A real keyboard also works                                                                                               |
| `Dialog`      | A question that must be answered before going on, such as "Log out?". Not for information                                                        |
| `useToast`    | A short message that goes away by itself: "Back online". Never the only place for something that must be read                                     |
| `Spinner`     | Waiting. Always say what is awaited                                                                                                              |
| `EmptyState`  | A list or page with nothing in it, and what will appear there                                                                                    |

### Shared

| Component                        | When to use it                                                        |
| -------------------------------- | --------------------------------------------------------------------- |
| `ClockChip`                      | Already in both shells                                                |
| `LanguageSwitch`                 | Staff pages: both languages side by side (`onNavy` on navy)           |
| `LanguageToggle`                 | Already in the kiosk rail: shows the other language                   |
| `LogoutButton`                   | Already placed by `RoleShell`. It asks first                          |
| `LogoMark`, `LogoFull`           | **Only on `nav` navy:** the picture has a solid navy background       |
| `ConnectionStatusLight`, `WeighbridgeStatusLight` | This screen's connection; the ESP32 online or offline |

### Kiosk (`components/kiosk`)

| Component    | When to use it                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------- |
| `ActionCard` | One or two very big choices with a picture ("Choose language", "Find my truck"). `blue` or `teal`   |
| `DetailGrid` | A ticket's values in two columns with icons. At most 10 items. `highlight` or `live` for one value  |
| `LiveWeight` | The weighing screens: the huge green number and whether it is stable                                |
| `HelpButton` | Already in the rail                                                                                 |

For big material and supplier tiles (Phase 10), build on `ActionCard`'s style and add the tile here.

### Dashboard (`components/dashboard`)

| Component       | When to use it                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `WelcomeBanner` | Only on the dashboard home: "Welcome, name", the role, and a place chip. The picture is drawn in code; no stock photos |
| `KpiCard`       | One number that matters, with a circle colour, and optionally a small change or a progress ring. 4 in a row (2 on a phone) |
| `Panel`         | A card with a heading and optionally "View all"                                                                      |
| `DataTable`     | Any list with columns. It becomes stacked cards when narrow. Mark buttons `actions`; mark ticket numbers and plates `nowrap` |
| `AlertList`     | Recent happenings: coloured icon, title, detail, time                                                                |
| `SampleTag`     | Beside anything made up                                                                                              |

## Pictures and icons

- Icons are **lucide-react**. Mark decorative ones `aria-hidden`.
- No stock photos. The kiosk backdrop is CSS (`kiosk-backdrop`); the banner picture is an SVG.

## Checklist for a new screen

1. The right shell and theme.
2. Shared components, token colours.
3. Text in both languages; looked at in Hindi.
4. Kiosk: `expectDriverRules()` at both sizes. Dashboard: looked at 390 px wide, 768 px and 1440 px, with no sideways scrolling.
5. Status = icon + word.
6. A Playwright check, and a new screenshot if the screen is a main one.
