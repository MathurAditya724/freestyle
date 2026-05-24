# Contributing to Freestyle

Thanks for your interest in contributing.

## Setup

1. Fork and clone the repo
2. Install dependencies: `pnpm install`
3. Start development: `pnpm dev`

## Project structure

- `apps/electron` -- Electron desktop app (main process + React renderer)
- `apps/server` -- Hono API server (embedded in the Electron app)

The server is a workspace dependency of the Electron app. Turborepo ensures it's built first.

## Development workflow

1. Create a branch from `main`
2. Make your changes
3. Run `pnpm biome check .` to verify lint and formatting
4. Run `pnpm --filter @freestyle/electron typecheck:web` to verify types
5. Commit -- husky runs biome on staged files automatically
6. Open a PR against `main`

## Code style

- **Biome** for linting and formatting (not ESLint/Prettier)
- 2-space indentation, 80-char line width
- Imports are auto-sorted by Biome

## Commit messages

Follow conventional commits:

```
feat: add new feature
fix: resolve a bug
chore: maintenance task
```

## Architecture notes

- The pill window uses `focusable: false` and `showInactive()` to avoid stealing focus
- Global hotkey uses `node-global-key-listener` for key-up detection (hold-to-record)
- The server runs on a dynamic local port, exposed to the renderer via IPC
- API keys are stored in SQLite in the user data directory
