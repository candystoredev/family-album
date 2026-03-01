# Decisions

## Stack & Infrastructure

### 2025-01-01
Decision: Host on Vercel free tier
Reason: Smoother Next.js support, auto-deploy from GitHub
Alternatives Considered: Self-hosting, Netlify, Cloudflare Pages
Impact: Imposes 10-second function timeout, 4.5MB body limit, 1,000 image optimizations/month

### 2025-01-01
Decision: Use Cloudflare R2 for media storage
Reason: Zero egress fees — critical for a media-heavy site
Alternatives Considered: AWS S3, Cloudflare Images, Vercel Blob
Impact: ~$0-2/month even at scale; requires S3-compatible SDK

### 2025-01-01
Decision: Use Turso (SQLite) for database
Reason: Simple, free tier, FTS5 built-in for search
Alternatives Considered: PlanetScale, Supabase, Neon
Impact: Embedded full-text search with no additional service

### 2025-01-01
Decision: Next.js App Router + Tailwind CSS for frontend
Reason: Modern SSR, dark theme from start, good Vercel integration
Alternatives Considered: Remix, Astro, plain React SPA
Impact: App Router patterns for data fetching and routing

## Media & Performance

### 2025-01-01
Decision: Pre-generate thumbnails via `sharp` stored in R2 (not Vercel Image Optimization)
Reason: Vercel free tier caps at 1,000 optimizations/month — far too low for a photo site
Alternatives Considered: Vercel Image Optimization, Cloudflare Image Resizing, client-side resize
Impact: Server-side `sharp` after upload; thumbnails served directly from R2 CDN

### 2025-01-01
Decision: Presigned R2 URLs for uploads
Reason: Bypasses Vercel 4.5MB body limit; direct client-to-R2 upload
Alternatives Considered: Server-side proxy upload, chunked upload
Impact: Two-step flow (get presigned URL, then upload to R2, then create post)

### 2025-01-01
Decision: Direct R2 serve for video, no transcoding
Reason: No cost or latency for encoding; modern devices handle MP4 natively
Alternatives Considered: Cloudflare Stream, Mux, server-side ffmpeg
Impact: Video quality depends on source; no adaptive bitrate

### 2025-01-01
Decision: R2 key convention `media/{media_id}/original.{ext}` with per-asset directories
Reason: Clean, extensible — future variants added as sibling files without schema changes
Alternatives Considered: Flat key structure, hash-based paths
Impact: Supports multiple sizes, format conversion later

### 2025-01-01
Decision: Server-side `sharp` for thumbnails after R2 upload (not client-side)
Reason: Future-proof — supports multiple sizes, format conversion, smart cropping later
Alternatives Considered: Client-side resize before upload, on-demand resize
Impact: Slight server-side cost per upload but consistent quality and flexibility

## Identity & URLs

### 2025-01-01
Decision: nanoid for all primary keys (non-sequential random strings)
Reason: Post pages are publicly accessible for OG previews; sequential IDs would make archive scrapeable
Alternatives Considered: Auto-increment integer, UUID, cuid
Impact: All PKs are text type; URL-safe by default

### 2025-01-01
Decision: Slug-based post URLs (`/posts/happy-steaksgiving`)
Reason: Human-readable, better iMessage preview cards
Alternatives Considered: ID-based URLs, date-based URLs
Impact: Slug dedup logic needed (suffix `-2`, `-3`); untitled posts use date-based fallback

## Authentication & Privacy

### 2025-01-01
Decision: Session JWT / cookie-based auth for browsers
Reason: Simple family access, no external auth provider needed
Alternatives Considered: OAuth, passkeys, magic links
Impact: 90-day session cookies; dual login (viewer vs admin)

### 2025-01-01
Decision: Bearer token for API/iOS Shortcut auth
Reason: iOS Shortcut requirement — simple header-based auth
Alternatives Considered: OAuth, API keys with rotation
Impact: Single ADMIN_API_TOKEN env var; no rotation mechanism in v1

### 2025-01-01
Decision: Invite links + shared password fallback for viewer access
Reason: Invite links for frictionless family access; password for direct visitors
Alternatives Considered: Invite-only (no password), individual accounts, public with obscurity
Impact: Admin manages invite links (label, expire, revoke) + single shared password

### 2025-01-01
Decision: bcrypt for password hashing, stored in `site_settings`
Reason: Industry standard; never store plaintext passwords
Alternatives Considered: argon2, scrypt
Impact: bcryptjs dependency; hash-on-set, compare-on-login pattern

### 2025-01-01
Decision: `robots.txt` + `noindex` meta + `X-Robots-Tag` header for crawler blocking
Reason: Post pages must be publicly accessible for iMessage OG previews but not indexed by search engines
Alternatives Considered: Auth-wall everything (breaks OG previews), Cloudflare WAF rules
Impact: Three-layer defense; iMessage/social crawlers intentionally bypass (desired behavior)

## Content & UX

### 2025-01-01
Decision: No comments — iMessage feedback instead
Reason: Privacy, no moderation burden, natural family conversation
Alternatives Considered: Built-in comments, Disqus, email notifications
Impact: Pre-filled `sms:` URI with post URL; phone numbers stored in DB settings

### 2025-01-01
Decision: No Tumblr URL redirects — let old URLs 404
Reason: Clean break, no redirect maintenance
Alternatives Considered: 301 redirects from Tumblr URL patterns
Impact: Any existing Tumblr links will break

### 2025-01-01
Decision: Responsive web for admin (not PWA)
Reason: PWA on iOS is unreliable
Alternatives Considered: PWA, native iOS app
Impact: Admin works in browser; iOS Shortcut handles mobile uploads

### 2025-01-01
Decision: Cursor-based infinite scroll for pagination
Reason: Correct for chronological feeds; offset-based skips posts on insert
Alternatives Considered: Offset-based pagination, page numbers
Impact: Home feed newest-first; month pages oldest-first (different cursor directions)

### 2025-01-01
Decision: Dark theme matching Tumblr concept but refined
Reason: Keep the feel families are used to, modernize execution
Alternatives Considered: Light theme, theme toggle
Impact: Consistent dark theme throughout; photos pop against dark background

## Migration

### 2025-01-01
Decision: Use Tumblr API as migration source (not scraping)
Reason: Official, complete, preserves all metadata
Alternatives Considered: Web scraping, Tumblr export file
Impact: OAuth credentials required; handles all post types

### 2025-01-01
Decision: Use Tumblr timestamps for post dates (not EXIF)
Reason: Tumblr strips EXIF from uploads
Alternatives Considered: Re-derive from filename patterns
Impact: Dates accurate to Tumblr posting time, not photo capture time

### 2025-01-01
Decision: Pre-defined people list for migration tag routing
Reason: Deterministic — Tom provides names, script maps matching tags
Alternatives Considered: AI-based name detection, manual post-migration assignment
Impact: Migration config contains people array; matches route to `people` table, rest to `tags`

### 2025-01-01
Decision: FTS5 external content mode with rowid backing
Reason: Standard SQLite approach for FTS5 with non-integer PKs (nanoid text PK)
Alternatives Considered: Regular FTS5 table, separate search index
Impact: Requires sync triggers on INSERT/UPDATE/DELETE; content_rowid=rowid (implicit integer)

### 2025-01-01
Decision: Project lives at `apps/thehoecks/` in the monorepo
Reason: Alongside other apps in `tom-playground` monorepo
Alternatives Considered: Separate repository, root-level project
Impact: Vercel root directory set to `apps/thehoecks`; deploy workflow scoped to `apps/**`

### 2025-01-01
Decision: EXIF date extraction on new posts via iOS (not server)
Reason: iOS natively provides EXIF data; avoids server-side EXIF parsing
Alternatives Considered: Server-side EXIF extraction after upload
Impact: iOS Shortcut pre-fills post date from EXIF; admin panel allows manual date override

### 2025-01-01
Decision: Admin settings stored in DB `site_settings` table, not env vars
Reason: Change password, manage invites, update iMessage numbers — no redeploy needed
Alternatives Considered: Environment variables for all settings, config file
Impact: Admin panel settings page required; viewer password, iMessage recipients, site metadata all runtime-changeable

## Open Questions

- Tumblr blog handle: exact identifier needed for API — **pending from Tom** (currently hardcoded as `www.thehoecks.com` in migration script)
