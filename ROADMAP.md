# The Hoecks — Roadmap

## Completed
- [x] Authentication (login/session management)
- [x] Photo feed with infinite scroll
- [x] Photoset layouts (Tumblr-style grid)
- [x] R2 media storage with thumbnails
- [x] Seed script for test data
- [x] Edge-to-edge images on mobile

## In Progress
- [ ] Tumblr import pipeline

## Planned

### Admin Settings Page
- [ ] **Tech Stack Overview** — at-a-glance view of where everything lives:
  - Hosting (Vercel)
  - Database (Turso/libSQL — location)
  - Secrets management (Doppler)
  - Media storage (Cloudflare R2)
  - Domain / DNS
  - Auth provider
- [ ] **Changelog** — track what's been built and when, visible from admin UI
- [ ] **Admin tabs** — separate tabs for Settings, Tech Stack, Changelog (vs. one monolithic page)

### Feed Enhancements
- [ ] Individual post pages (`/post/[slug]`)
- [ ] Video playback support
- [ ] Full-resolution image viewer / lightbox

### Content Management
- [ ] Create new posts from admin UI
- [ ] Edit / delete posts
- [ ] Bulk import from Tumblr export

### User Management
- [ ] Invite family members
- [ ] Role-based access (admin vs. viewer)
