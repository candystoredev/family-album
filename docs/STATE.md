# State

## Current Status
Phases 1-3 complete. Phase 4a-4d implemented. Feed shows tag/people links on every post. Filtered pages at `/tags/{slug}`, `/people/{slug}`, `/albums/{slug}` with cursor-based infinite scroll. Album pages show cover image when set.

## Active Branch
claude/family-photo-album-plan-rEoOE

## Current Task
Phase 4d deployed — needs verification (tag/people/album pages, clickable links in feed, pagination within filters)

## Blockers
- Tumblr blog handle not yet confirmed by Tom (migration script has `www.thehoecks.com` hardcoded)

## Known Issues
- Seed test posts must be deleted before running real migration
- PEOPLE set in migration script is empty (needs family names from Tom)
- FTS5 tags field always inserts empty string (trigger doesn't join tag names)
- Seed posts don't have tags/people/albums, so tag/people links won't appear in seeded feed

## Next Action
Verify filtered pages work with real tagged/peopled data. Then begin Phase 4e (year/month timeline navigation).

## Recent Changes
- Phase 4d: Tag filtered page at `/tags/[slug]` with cursor-based infinite scroll
- Phase 4d: People filtered page at `/people/[slug]` with cursor-based infinite scroll
- Phase 4d: Album filtered page at `/albums/[slug]` with cover image and cursor-based infinite scroll
- Phase 4d: Feed API extended with `tag`, `person`, `album` filter query params
- Phase 4d: Feed API now returns tags and people per post (for rendering links)
- Phase 4d: Feed component shows clickable `@person` and `#tag` links below each post
- Phase 4d: Extracted shared `getInitialFeed()` into `lib/feed.ts` to reduce duplication
- Phase 4d: Back arrow navigation on all filtered pages
- Fullscreen lightbox: tap any image → fullscreen view, swipe left/right for photosets, dot indicators, keyboard arrows on desktop, body scroll lock
- iMessage chat bubble: blue icon next to each post's caption, opens pre-filled SMS with post URL
- Post detail page simplified to permalink-only (OG tags for link previews, no iMessage button)
- Feed images no longer link to post pages — tap opens lightbox instead

## Relevant Files
- `apps/thehoecks/src/app/page.tsx` — home feed (SSR first page)
- `apps/thehoecks/src/components/Feed.tsx` — infinite scroll client component with tag/people links
- `apps/thehoecks/src/app/api/feed/route.ts` — cursor-based feed API with filter support
- `apps/thehoecks/src/lib/feed.ts` — shared server-side feed fetching logic
- `apps/thehoecks/src/app/tags/[slug]/page.tsx` — tag filtered page
- `apps/thehoecks/src/app/people/[slug]/page.tsx` — person filtered page
- `apps/thehoecks/src/app/albums/[slug]/page.tsx` — album filtered page
- `apps/thehoecks/tests/cursor-pagination.test.ts` — cursor pagination tests
- `apps/thehoecks/src/app/login/page.tsx` — login page
- `apps/thehoecks/src/middleware.ts` — auth middleware
- `apps/thehoecks/src/lib/auth.ts` — session/JWT/password logic
- `apps/thehoecks/src/lib/db.ts` — Turso client
- `apps/thehoecks/src/lib/r2.ts` — R2 upload/delete
- `apps/thehoecks/src/lib/schema.ts` — all table definitions + FTS5
- `apps/thehoecks/src/app/posts/[slug]/page.tsx` — individual post page with OG tags
- `apps/thehoecks/src/components/PhotoGrid.tsx` — multi-photo grid + layout parser
- `apps/thehoecks/src/components/Lightbox.tsx` — fullscreen image viewer with swipe
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
