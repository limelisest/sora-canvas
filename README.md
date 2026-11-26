# sora-canvas

**An infinite-canvas Bento bookmark launcher & personal whiteboard** with `1/4`-grid edge-clamping physics, linked section zones, desktop widgets, zero-leak private isolation, and a native `/llms.txt` AI Agent API.

**基于无限画布的 Bento 书签启动器与个人桌面**：支持 `1/4` 网格贴边物理引擎、分区框整体联动、轮播图/自由文字/密码便签小部件、服务端私密隔离以及原生 AI Agent 批处理接口。

---

## Highlights / 核心特性

- **Infinite 2D Bento Canvas（无限二维画布）**
  - Smooth GPU-composited pan & zoom (`Space + Drag`, middle-click drag, or configurable scroll-wheel pan/zoom), plus independent **Desktop Auto-Fit** vs **Mobile 100% Anchor** viewport modes.
  - Quarter-grid (`0.25`) alignment with smooth edge-clamping, neighbor push on resize, composite swaps, drag-into-folder, and `600ms` hover-merge.
- **Section Zones & Desktop Widgets（区域分区框与桌面小部件）**
  - **Zones（区域标签/分区框）**: Frame folders and bookmarks into visual sections; dragging a zone moves all enclosed items together (`Alt + Drag` adjusts the frame alone).
  - **Image Carousel Widget（轮播图小部件）**: Upload local images (SHA-256 deduplicated with immutable caching) or link external URLs, with `3s` slide/fade transitions.
  - **Free Text Widget（自由文字标注）**: Borderless canvas typography with custom font size, color, weight, and alignment.
  - **Password-Gated Sticky Notes（密码保护便签）**: Multi-tint sticky notes directly on the canvas; editing prompts for admin unlock when locked.
- **Zero-Leak Server-Side Privacy（服务端零泄露私密隔离）**
  - Folders, sticky notes, and entire **Private Zones** (`isPrivate: true`) are completely stripped on the server before responses leave `/api/canvas` or SSR HTML when locked.
  - Persistent device session cookies with manual 1-click re-lock and remote device revocation.
- **AI Agent Native（原生 `/llms.txt` 自描述 API）**
  - Built-in `GET /llms.txt` and `GET /api/agent/guide` documentation plus atomic `POST /api/agent/ops` batch operations with automatic rollback snapshots.

---

## Quick Start / 快速开始

### Prerequisites
- **Node.js** `>= 20`

### Run Locally
```bash
git clone https://github.com/limelisest/sora-canvas.git
cd sora-canvas
npm install

# Build frontend + server
npm run build

# Start production server (default: http://127.0.0.1:3890)
PORT=3890 HOST=127.0.0.1 NEKO_LIKE_DATA_DIR=./data npm start
```

On first launch:
- If `NEKO_LIKE_PASSWORD` is not set, a random initial admin password is generated and written to `<DATA_DIR>/initial-password` (`0600` permissions), while hashed credentials and the Agent `apiToken` are stored in `<DATA_DIR>/config.json`.
- Once unlocked in the browser, open **Settings（设置）** to customize your site title, theme, background style (`Aurora` / `Dot` / `Wallpaper`), viewport anchor, password, and backups.

---

## Environment Variables / 环境变量

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3890` | HTTP listen port |
| `HOST` | `127.0.0.1` | Bind address (`0.0.0.0` for Docker/LAN) |
| `NEKO_LIKE_DATA_DIR` | `./data` | Persistent directory for `canvas.json`, `settings.json`, `config.json`, `history/`, and `uploads/` |
| `NEKO_LIKE_PASSWORD` | *(auto-generated)* | Optional initial admin password on first bootstrap |

---

## AI Agent Integration (`/llms.txt`)

Point any coding/automation agent to `https://<your-host>/llms.txt` to let it self-discover the schema and organize your bookmarks via `POST /api/agent/ops` using your Bearer `apiToken` (viewable in **Settings -> Agent Center**).

---

## Development & Tests

```bash
# Run typecheck, Vite bundle, and server build
npm run build

# Run automated unit & integration tests
npm test
```

## License

[MIT](./LICENSE)
