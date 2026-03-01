# State

## Current Status
Phases 1-3 complete. Phase 4a (polished feed + cursor-based infinite scroll) implemented and deployed. Feed uses cursor-based pagination with `(date, id)` tiebreaker, IntersectionObserver-based infinite scroll, sticky header, edge-to-edge images on mobile, and polished dark theme styling. 25-post seed script for testing pagination.

## Active Branch
claude/family-photo-album-plan-rEoOE

## Current Task
Phase 4a complete — verifying infinite scroll with expanded seed data, then Phase 4b

## Blockers
- Tumblr blog handle not yet confirmed by Tom (migration script has `www.thehoecks.com` hardcoded)

## Known Issues
- No individual post pages
- No OG tags for iMessage previews
- Seed test posts must be deleted before running real migration
- PEOPLE set in migration script is empty (needs family names from Tom)
- FTS5 tags field always inserts empty string (trigger doesn't join tag names)

## Next Action
Verify Phase 4a (scroll loads next page seamlessly, no dupes/skips, works on phone), then begin Phase 4b (post pages + OG tags)

## Recent Changes
- Expanded seed script from 3 to 25 posts spanning 2023-2025 with varied layouts
- Edge-to-edge images on mobile (negative margins), rounded corners on desktop only
- PAGE_SIZE restored to 20 for proper pagination testing
- Consolidated project docs under `apps/thehoecks/docs/`
- Created CLAUDE.md for AI agent orientation

## Relevant Files
- `apps/thehoecks/src/app/page.tsx` — home feed (SSR first page)
- `apps/thehoecks/src/components/Feed.tsx` — infinite scroll client component
- `apps/thehoecks/src/app/api/feed/route.ts` — cursor-based feed API
- `apps/thehoecks/tests/cursor-pagination.test.ts` — cursor pagination tests
- `apps/thehoecks/src/app/login/page.tsx` — login page
- `apps/thehoecks/src/middleware.ts` — auth middleware
- `apps/thehoecks/src/lib/auth.ts` — session/JWT/password logic
- `apps/thehoecks/src/lib/db.ts` — Turso client
- `apps/thehoecks/src/lib/r2.ts` — R2 upload/delete
- `apps/thehoecks/src/lib/schema.ts` — all table definitions + FTS5
- `apps/thehoecks/src/components/PhotoGrid.tsx` — multi-photo grid + layout parser
- `apps/thehoecks/src/components/LogoutButton.tsx` — logout UI
- `apps/thehoecks/src/components/SeedButton.tsx` — seed test data UI
- `apps/thehoecks/src/app/api/init/route.ts` — schema init + settings seed
- `apps/thehoecks/src/app/api/seed/route.ts` — test data seeder (25 posts)
- `apps/thehoecks/src/app/api/auth/login/route.ts` — login endpoint
- `apps/thehoecks/src/app/api/auth/logout/route.ts` — logout endpoint
- `apps/thehoecks/src/app/robots.txt/route.ts` — crawler blocking
- `apps/thehoecks/scripts/migrate.ts` — Tumblr migration script

## AI Guardrails
Assumptions:
- Phases 1-3 are considered complete per ROADMAP.md phase definitions
- Migration script has not been run against real Tumblr data yet
- Dev deployment at dev.thehoecks.com is the primary test target
- Tom is the primary admin user

Constraints:
- All changes must work within Vercel free tier limits
- Media uploads must go through presigned R2 URLs (not through Vercel)
- All passwords must be bcrypt hashed, never plaintext
- Post pages must remain publicly accessible (for OG previews)
- Do not break existing auth flow

Do Not:
- Add new services or paid dependencies without explicit approval
- Change the database schema without updating `schema.ts` and ARCHITECTURE.md
- Modify auth middleware behavior without re-verifying all access paths
- Run the migration script against production without Tom's confirmation
- Remove crawler blocking from post pages
- Store plaintext passwords anywhere
- Add features from the V2 backlog during current phases
