# Trinetra Systems — Smart Weighbridge Prototype

A funding prototype of a smart weighbridge, built as **one website** with three role-based parts (weighbridge kiosk, supervisor, store officer), one backend, and an ESP32 weighbridge model. The core promise: **the backend owns the weight**, so nobody can fake it from the screen.

- Master plan: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)
- Progress: [docs/PROGRESS.md](docs/PROGRESS.md)
- Decisions: [docs/DECISIONS.md](docs/DECISIONS.md)
- Rules for Claude: [CLAUDE.md](CLAUDE.md)

**Current state:** Phase 1 (project setup). The website shows a simple home page and the backend has a health check. No weighbridge features yet.

## Folder layout

```
trinetra-prototype/
├─ apps/
│  ├─ web/            @trinetra/web: Next.js website
│  └─ server/         @trinetra/server: Fastify backend
├─ packages/
│  └─ shared/         @trinetra/shared: TypeScript used by both apps
├─ firmware/
│  ├─ esp32/          Weighbridge model code (from Phase 5)
│  └─ esp32-cam/      Front and back camera code (from Phase 5)
├─ scripts/           ESP32 simulator and demo helpers (from Phase 5)
├─ tests/e2e/         Playwright demo scenarios (added in a later phase)
└─ docs/              Build plan, progress and decisions
```

## Requirements

- **Node.js 22 LTS** (22.18 or newer). `.nvmrc` contains the version.
- **pnpm 10.** The exact version is in `package.json` (`packageManager`). Install it with Corepack or npm:

  ```powershell
  npm install -g pnpm@10
  ```

- **PostgreSQL 16**, from Phase 2 (run with Docker Desktop). Not needed yet.

## Install and run

Install the packages (from the repository root):

```powershell
pnpm install
```

Start the website and the backend together:

```powershell
pnpm dev
```

- Website: <http://localhost:3000>
- Backend health check: <http://localhost:4000/api/health>

Press `Ctrl+C` to stop both.

## Environment files

Nothing needs to be filled in for Phase 1. Later phases need:

| Copy this                  | To this               |
| -------------------------- | --------------------- |
| `apps/server/.env.example` | `apps/server/.env`    |
| `apps/web/.env.example`    | `apps/web/.env.local` |

Each variable has a comment saying which phase uses it. Never commit the filled-in files, or `secrets.h` in the firmware folders.

## Commands

Run all commands from the repository root.

| Command             | What it does                                                                    |
| ------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`          | Runs the website (:3000) and the backend (:4000) together, reloading on changes |
| `pnpm build`        | Builds the website and the backend for production                               |
| `pnpm test`         | Runs the tests (Vitest)                                                         |
| `pnpm lint`         | Checks the code with ESLint                                                     |
| `pnpm typecheck`    | Checks TypeScript types in every package                                        |
| `pnpm format`       | Formats files with Prettier (`docs/` and `CLAUDE.md` are left as written)       |
| `pnpm format:check` | Checks formatting without changing files                                        |
| `pnpm db:migrate`   | Creates or updates database tables (works from Phase 2)                         |
| `pnpm db:seed`      | Loads the demo data (works from Phase 2)                                        |

Before each commit, run `pnpm typecheck`, `pnpm lint` and `pnpm test`.

After `pnpm build`, the production versions start with `pnpm --filter @trinetra/web start` and `pnpm --filter @trinetra/server start`.
