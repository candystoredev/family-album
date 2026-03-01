# State

## Current Status
Phases 1-3 complete. Phase 4a verified. Phase 4b (post pages + OG tags + iMessage button) implemented. Individual post pages at `/posts/{slug}` with full OG metadata for iMessage/social previews, iMessage "Text us about this" button (mobile) with desktop fallback, `X-Robots-Tag` header, and `noindex` meta. Feed posts now link to individual post pages.

## Active Branch
claude/family-photo-album-plan-rEoOE

## Current Task
Phase 4b deployed — needs verification (paste URL in iMessage, check OG preview, test iMessage button)

## Blockers
- Tumblr blog handle not yet confirmed by Tom (migration script has `www.thehoecks.com` hardcoded)

## Known Issues
- Seed test posts must be deleted before running real migration
- PEOPLE set in migration script is empty (needs family names from Tom)
- FTS5 tags field always inserts empty string (trigger doesn't join tag names)

## Next Action
Verify Phase 4b (paste post URL in iMessage → preview card, tap iMessage button on phone → opens text), then clean up 3 duplicate posts via `DELETE /api/seed`, then begin Phase 4c (lightbox + photoset grids)

## Recent Changes
- Phase 4b: Post detail pages at `/posts/[slug]` with OG tags
- Phase 4b: iMessage "Text us about this" button (mobile) + desktop fallback
- Phase 4b: Feed posts link to individual post pages (title, image, date all clickable)
- Phase 4b: `X-Robots-Tag: noindex, nofollow` header + `<meta robots>` on post pages
- Seed endpoint: skip posts by title if already exists (dedup)
- Seed endpoint: DELETE handler to clean up duplicate posts
- Expanded seed script from 3 to 25 posts spanning 2023-2025 with varied layouts
- Edge-to-edge images on mobile (negative margins), rounded corners on desktop only
- PAGE_SIZE restored to 20 for proper pagination testing

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
- `apps/thehoecks/src/app/posts/[slug]/page.tsx` — individual post page with OG tags
- `apps/thehoecks/src/components/PhotoGrid.tsx` — multi-photo grid + layout parser
- `apps/thehoecks/src/components/IMessageButton.tsx` — iMessage share button
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
