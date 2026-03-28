# Not Ur Coach — Claude Code Context

See @AGENTS.md for full project context, stack, architecture decisions, and build order.

---

## Claude-Specific Skills to Install
All skills install into `./skills/` — the shared skills folder for all agents.
```bash
# Core Gemini API (analysis, structured output, embeddings, Files API)
claude skills install google-gemini/gemini-skills/skills/gemini-api-dev --path ./skills

# Live API (Block 10 — real-time coaching WebSocket)
claude skills install google-gemini/gemini-skills/skills/gemini-live-api-dev --path ./skills

# Gemini Interactions API (chat with server-side state, streaming)
claude skills install google-gemini/gemini-skills/skills/gemini-interactions-api --path ./skills

# Convex (rules file in ./skills/convex_rules.txt)
# See: https://docs.convex.dev/ai#convex-ai-rules

# Clerk (Vite SPA setup + webhook to sync users to Convex)
npx skills add clerk/skills --skill clerk-setup --path ./skills
npx skills add clerk/skills --skill clerk-webhooks --path ./skills
```

## Other Reference Files (in `docs/`)
- `docs/gemini-usage.md` — all Gemini API code patterns (new `@google/genai` SDK)
- `docs/viable-options.md` — hackathon track options + deferred features
- `docs/final-spec.md` — full locked decisions with rationale
- `docs/skills.md` — full skills install guide
