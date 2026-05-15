# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
make run          # run the server (default port 8080)
make build        # build to bin/ryder
make test         # go test -v ./...
make lint         # golangci-lint run ./...

# DB migrations (requires `migrate` CLI and DB_URL env var)
make migrate-up
make migrate-down
```

Single test: `go test -v ./internal/backend/ -run TestFunctionName`

Set `PORT` in `.env` (copy from `.env.sample`) to override port 8080.

## Architecture

**Go backend + vanilla JS frontend, SQLite persistence.**

```
cmd/ryder/main.go              entry point: open SQLite, autoMigrate, set backend.DB, start server
internal/backend/server.go     HTTP mux, WebSocket hub, route registration
internal/backend/handler.go    all handlers, DB queries, data models
static/                        vanilla JS frontend (no build step)
migrations/                    SQL migration files (sql-migrate format, not used at runtime)
```

### Request lifecycle

Every mutating POST endpoint is wrapped by `wrapAndBroadcast` in `server.go`, which calls `go broadcast()` after the handler returns. `broadcast()` sends the string `"update"` to all connected WebSocket clients. Clients on `/ws` re-fetch `/api/dashboard` on receipt.

### Database schema

`autoMigrate` in `main.go` runs `CREATE TABLE IF NOT EXISTS` for all tables on every startup — it is the source of truth, not the `migrations/` files. Two ALTER TABLE statements at the end handle additive column additions idempotently.

Core tables: `players`, `teams`, `team_players`, `matches`, `match_players`, `scores`, `hole_results`.

Key domain rules:
- Match `status`: `prepared` → `running` → `completed`
- Match `format`: `singles`, `texas_scramble`, `foursome`
- Match `holes`: `18`, `front9`, `back9`
- `hole_results.result`: `"A"`, `"B"`, or `"AS"` (all-square) per hole
- Team scores on the dashboard are counted from `hole_results`, not from `scores` (per-player strokes exist but aren't used in scoring logic yet)
- `match_players.team_side` is `"A"` or `"B"`

### Frontend pages

| URL | File | Purpose |
|-----|------|---------|
| `/` or `/dashboard` | `dashboard.html` | Live scoreboard |
| `/adminjd` | `adminjd.html` | Admin — manage players, teams, matches |
| `/show` | `show.html` | Alternate display view |
| `/static/score.html` | `score.html` | Per-match hole-by-hole score entry |

Static assets are served directly from `static/` and `img/` via `HandleMainPage`.
