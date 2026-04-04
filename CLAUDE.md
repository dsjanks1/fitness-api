# FitCoach API

Express + TypeScript API server for the FitCoach app. Runs via `tsx` (no build step).

## Stack
- **Runtime**: Node.js 20+ with `tsx` (TypeScript executed directly, no compilation)
- **Framework**: Express
- **AI**: Anthropic SDK (`claude-sonnet-4-5`) with SSE streaming
- **Database**: Supabase (Postgres) — service role key, server-only
- **Client**: React Native (no browser — CORS is not applicable)
- **Hosting**: Railway

## Architecture
- `index.ts` — Express server, CORS config, routes
- `chatHandler.ts` — Single POST `/api/chat` handler: fetches user data from Supabase, builds system prompt, streams Claude response via SSE

## Key Patterns
- SSE streaming: `res.setHeader('Content-Type', 'text/event-stream')`, writes `data: {...}\n\n` chunks, ends with `data: [DONE]\n\n`
- System prompt is built per-request from live Supabase data (user profile, weight history, active goal)
- `CURRENT_USER_ID = 1` — MVP single-user hardcode
- Workout responses use `[WORKOUT_CARD]...[/WORKOUT_CARD]` markers for frontend parsing

## Environment Variables
See `.env.example`. Required:
- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY` — service role, never expose to frontend
- `PORT` — set automatically by Railway

## Commands
```bash
npm run dev    # local dev with --watch
npm start      # production (used by Railway)
```
