# AGENTS.md — echolocation

## Product

**Echolocation** — dark-cave browser game. Player navigates with limited vision: send sonar pings to briefly reveal walls/objects. High uniqueness + high replayability (return visits).

### Design pillars

1. **Vision is earned** — world black by default; ping reveals briefly then fades
2. **Info economy** — ping costs resource; spam is unsafe or expensive
3. **One-more-run** — short runs, instant restart, fair death
4. **Run variety** — procedural caves / seeds (after core feel works)
5. **Clear score** — depth, time, pings used, survival

### Not goals (for now)

- Mobile native app
- Multiplayer
- Long story campaign
- Heavy meta RPG
- Puzzle-only fixed levels with no replay loop

### Core loop (target)

```
enter cave → move in dark → ping sparingly → go deeper / grab goal
→ die or escape → score + best depth → new run (new seed)
```

### MVP order

1. Move + walls + ping reveal/fade + death (void/spike)
2. Energy limit on pings + score + instant restart
3. Simple procgen + localStorage best depth
4. Later: sound-sensitive hazard, daily seed, small modifiers

## Stack

| Layer | Choice |
|-------|--------|
| Platform | Browser only (desktop-first; touch optional later) |
| Render | Canvas 2D |
| Language | Vanilla JS (TypeScript only if explicitly requested) |
| Build | None for MVP (`index.html` + modules/scripts). Vite only if approved |
| Audio | Web Audio API when needed |
| Persist | `localStorage` |
| Deploy | Static files (nginx/VPS or any static host). **Not** tied to Vercel |

### Dependency policy

- No new packages without asking first
- Prefer zero dependencies for MVP
- Never commit secrets, `.env` with values, or machine-specific paths
- Never remove, delete or destructive action about the project, machine, etc.

## Repo layout (expected)

```
echolocation/
  AGENTS.md
  .gitignore
  index.html
  src/          # or flat files if tiny
  assets/       # optional
  README.md     # when public-facing docs needed
```

Keep structure flat until complexity forces folders.

## Git & authorship (mandatory)

- **Never** add AI co-author trailers or attribution in commits, PRs, or tags:
  - no `Co-authored-by: ...`
  - no `Signed-off-by:` for agents
  - no `Made-with:`, `Generated-by:`, `Assisted-by:`, Cursor/Copilot/Claude/Codex/Grok trailers
- Commit messages: human style only — short, clear, no “AI” branding
- Author must remain repo config: `srmdn` / `mail@saidwp.com` (local git config)
- Do not amend published history unless user asks
- Do not force-push unless user asks

## Agent workflow

- Read this file before non-trivial changes
- Small, verifiable diffs; no drive-by refactors
- Ask before destructive git ops or dependency adds
- Shell: prefer `rtk` wrappers when available
- Do not invent deploy credentials or VPS details in docs

## Quality bar

- Game must be playable from static open/`index.html` (or documented local serve)
- 60fps target on modest hardware for MVP scope
- Fail states and controls obvious without a manual
- Replay hook present early: score + restart, not only “finish level once”
