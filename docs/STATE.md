# State

## Current Status
Phases 1-4 complete. Tumblr migration completed against production on 2026-03-07. All posts migrated, FTS index rebuilt. Site live at dev.thehoecks.com with full content. All crawler blocking layers active site-wide (robots.txt, noindex meta, X-Robots-Tag header).

Phase 4i (delight & polish) in progress. Addressing Tom's feedback on feed layout, lightbox animation, On This Day, and iMessage bubble.

## Active Branch
claude/family-photo-album-plan-rEoOE

## Current Task
Phase 4i polish: On This Day shows 3 posts from 2+ years, bubble centered + iMessage-shaped, post spacing tightened, dot divider, lightbox swipe animation improved. Review queue feature added to Phase 5 roadmap.

## Blockers
None

## Known Issues
None

## Next Action
Tom reviews Phase 4i changes, then Phase 5a (single photo upload).

## Recent Changes
- Phase 4i: On This Day returns 3 posts from at least 2 different years
- Phase 4i: iMessage bubble vertically centered in caption area, redesigned to match iPhone Messages shape
- Phase 4i: Post divider changed from line to subtle dot, spacing between posts reduced
- Phase 4i: Lightbox swipe animation improved with slide+fade transition and smoother easing
- Phase 4i: Post flagging & review queue added to Phase 5 roadmap (5d-flag)
- Phase 4h: Feed images now serve originals instead of 400px thumbnails
- Phase 4h: Desktop sidebar — persistent left nav at 35% opacity, full on hover (lg+ breakpoint)
- Phase 4h: Mobile keeps FAB + slide-out panel unchanged
- Phase 4h: Removed sticky headers from all 8 pages
- Phase 4h: Added BannerMessage component (reads `banner_message` from site_settings)
- Phase 4h: Logout + admin badge moved to sidebar bottom
- 2026-03-07: Full Tumblr migration completed against production, FTS index rebuilt
- Phase 4f: FTS5 search — search bar in slide-out panel, `/search?q=` results page
- Phase 4f: Search API at `/api/search` with FTS5 ranking, offset pagination
- Phase 4f: FTS5 fixed — standalone table indexing title, body, tags, and people names
- Phase 4e: Floating archive menu button (FAB) with slide-out panel
- Phase 4e: Panel includes "The Latest", "Featured" (albums), and year/month timeline
- Phase 4e: FAB hides on scroll-down, shows on scroll-up with jitter threshold
- Phase 4e: Archive index page at `/archive` — year/month grid with post counts
- Phase 4e: Month pages at `/archive/{year}/{month}` — oldest-first feed with infinite scroll
- Phase 4e: Previous/next month navigation on month pages
- Phase 4e: Feed API extended with `year`+`month` params, oldest-first ordering
- Seed data cleaned from dev site (`DELETE /api/seed?clean=all`) — only real migrated content remains
- Clean-all seed endpoint added to remove seed posts, media, tags, people, and albums
- Schema init hardened: tumblr_id index created after migration to avoid conflicts
- Migration script hardened: transactions, slug dedup, seed cleanup
- Tumblr OAuth key renamed to match Vercel env convention
- Tumblr blog ID and family people list configured for migration
- Phase 4d: Tag/people/album filtered pages with cursor-based infinite scroll
- Phase 4d: Feed API extended with filter params, returns tags/people per post
- Phase 4d: Clickable `@person` and `#tag` links in feed
- Phase 4d: Shared `lib/feed.ts` for server-side feed fetching
- Fullscreen lightbox with swipe, keyboard arrows, dot indicators
- iMessage chat bubble on feed posts
- Post detail page simplified to permalink-only (OG tags for link previews)

## Relevant Files
- `apps/thehoecks/src/app/page.tsx` — home feed (SSR first page)
- `apps/thehoecks/src/components/Feed.tsx` — infinite scroll client component with tag/people links
- `apps/thehoecks/src/app/api/feed/route.ts` — cursor-based feed API with filter support
- `apps/thehoecks/src/lib/feed.ts` — shared server-side feed fetching logic
- `apps/thehoecks/src/app/tags/[slug]/page.tsx` — tag filtered page
- `apps/thehoecks/src/app/people/[slug]/page.tsx` — person filtered page
- `apps/thehoecks/src/app/albums/[slug]/page.tsx` — album filtered page
- `apps/thehoecks/src/app/archive/page.tsx` — archive index (year/month grid)
- `apps/thehoecks/src/app/archive/[year]/[month]/page.tsx` — month page (oldest-first)
- `apps/thehoecks/src/app/api/archive/route.ts` — archive API (years/months/counts + albums)
- `apps/thehoecks/src/components/ArchiveMenu.tsx` — floating menu button + slide-out panel + search
- `apps/thehoecks/src/app/api/search/route.ts` — FTS5 search API
- `apps/thehoecks/src/app/search/page.tsx` — search results page (server wrapper)
- `apps/thehoecks/src/app/search/SearchResults.tsx` — search results client component
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
- Migration has not yet been re-run on production (DB is clean)
- dev.thehoecks.com is the production site (old Tumblr site still on www.thehoecks.com)
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
