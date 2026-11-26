# sora-canvas — Project Guide for AI Agents

## Overview

`sora-canvas` is a self-hosted infinite-canvas Bento bookmark launcher and personal whiteboard built with **React 19 + Tailwind CSS v4 + Fastify v5 + TypeScript**.

### Key Modules
- `shared/types.ts`: Shared interfaces for `BookmarkItem`, `FolderContainer`, `ZoneContainer`, `CanvasWidget` (`carousel` | `text` | `note`), `SiteSettings`, and `AgentOp`.
- `shared/gridEngine.ts`: Pure deterministic 2D physics & quarter-grid (`0.25`) layout engine shared by frontend live preview and backend validation (`solveResize`, `solveMove`, `solveMoveZoneGroup`, `solvePlaceExternalItem`, `findNearestFreeSlot`).
- `server/app.ts` & `server/index.ts`: Fastify v5 server, SSR initial boot hydration, image upload storage (`/api/uploads/image`), authentication, history snapshots, backup import/export, and self-describing `/llms.txt` Agent API.
- `server/auth.ts`: `crypto.scryptSync` password hashing, signed `HttpOnly` session cookies, and `Authorization: Bearer <apiToken>` verification.
- `server/store.ts`: Atomic JSON persistence, `mtimeMs` memory cache, automatic snapshot coalescing, and `sanitizeCanvasForPublic` zero-leak private folder/zone stripping.
- `src/`: Infinite canvas UI with GPU-composited pan/zoom, mobile long-press protection, right-click context menu, quick-jump folder directory, and desktop widgets.

## Development & Verification Commands

- Install dependencies: `npm install`
- Dev backend: `npm run dev`
- Dev frontend: `npm run dev:web`
- Production build & typecheck: `npm run build`
- Automated test suite: `npm test`
- Start production server: `npm start`
