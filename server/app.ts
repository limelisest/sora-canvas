import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import sharp from 'sharp';
import type { AgentOp, CanvasDocument, CanvasResponse, SiteSettings } from '../shared/types.js';
import { GRID_DENSITY_MAP } from '../shared/settings.js';
import { validateCanvasDocument } from '../shared/gridEngine.js';
import {
  normalizePublicLayout,
  projectPublicCanvas,
  reconcilePublicLayout,
} from '../shared/dualLayout.js';
import {
  clearSessionCookie,
  ensureAuthConfig,
  isAuthenticated,
  parseSessionCookie,
  rotateApiToken,
  rotateCookieSecret,
  setSessionCookie,
  updatePassword,
  verifyBearerToken,
  verifyPassword,
} from './auth.js';
import {
  collectUploadRefsFromText,
  createManualSnapshot,
  deleteHistorySnapshot,
  listHistory,
  loadCanvas,
  loadSettings,
  normalizeDocument,
  restoreHistorySnapshot,
  sanitizeCanvasForPublic,
  saveCanvas,
  saveSettings,
  UPLOAD_FILE_RE,
} from './store.js';
import { fetchUrlMetadata } from './meta.js';
import {
  AgentOpError,
  applyAgentOps,
  buildAgentGuideJson,
  buildAgentGuideMarkdown,
} from './agentOps.js';

export interface BuildAppOptions {
  dataDir?: string;
  password?: string;
  logger?: boolean;
  serveStatic?: boolean;
}

function resolveStaticDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'dist'),
    path.resolve(import.meta.dirname, '../dist'),
    path.resolve(import.meta.dirname, '../../dist'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return null;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const dataDir = path.resolve(
    options.dataDir ?? process.env.NEKO_LIKE_DATA_DIR ?? path.resolve(process.cwd(), 'data')
  );

  let authConfig = await ensureAuthConfig(dataDir, options.password);
  await loadCanvas(dataDir);

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 15 * 1024 * 1024,
  });

  await app.register(fastifyCookie);

  // Tolerate empty JSON or proxy-injected content-types on bodyless POST endpoints (e.g. /api/auth/lock)
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const trimmed = typeof body === 'string' ? body.trim() : '';
      if (!trimmed) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(trimmed));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    const trimmed = typeof body === 'string' ? body.trim() : '';
    if (!trimmed) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(trimmed));
    } catch {
      done(null, {});
    }
  });

  app.get('/llms.txt', async (_request, reply) => {
    return reply.type('text/markdown; charset=utf-8').send(buildAgentGuideMarkdown());
  });

  app.get('/api/health', async () => {
    const doc = await loadCanvas(dataDir);
    const { doc: publicDoc } = sanitizeCanvasForPublic(doc);
    return {
      ok: true,
      status: 'healthy',
      version: doc.version,
      publicFolderCount: publicDoc.folders.length,
      publicItemCount: publicDoc.items.length,
      updatedAt: doc.updatedAt,
    };
  });

  app.get('/api/auth/status', async (request) => {
    return {
      unlocked: isAuthenticated(request, authConfig),
    };
  });

  app.post<{ Body: { password?: string; remember?: boolean } }>(
    '/api/auth/unlock',
    async (request, reply) => {
      const password = request.body?.password ?? '';
      if (!verifyPassword(authConfig, password)) {
        return reply.code(401).send({ ok: false, error: '管理密码错误' });
      }
      const settings = await loadSettings(dataDir);
      const remember = request.body?.remember !== false;
      setSessionCookie(request, reply, authConfig, remember, settings.rememberDays);
      return { ok: true, unlocked: true, remember };
    }
  );

  app.post('/api/auth/lock', async (request, reply) => {
    clearSessionCookie(request, reply);
    return { ok: true, unlocked: false };
  });

  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>(
    '/api/auth/password',
    async (request, reply) => {
      if (!isAuthenticated(request, authConfig)) {
        return reply.code(401).send({ ok: false, error: '需要鉴权后才能修改密码' });
      }
      const currentPassword = request.body?.currentPassword ?? '';
      const newPassword = request.body?.newPassword ?? '';
      if (!verifyPassword(authConfig, currentPassword)) {
        return reply.code(401).send({ ok: false, error: '当前密码错误' });
      }
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return reply.code(400).send({ ok: false, error: '新密码长度不能少于 6 位' });
      }
      const session = parseSessionCookie(request, authConfig);
      const settings = await loadSettings(dataDir);
      authConfig = await updatePassword(dataDir, authConfig, newPassword);
      if (session) {
        setSessionCookie(request, reply, authConfig, session.remember, settings.rememberDays);
      }
      return { ok: true };
    }
  );

  app.post<{ Body: { keepCurrent?: boolean } }>(
    '/api/auth/revoke-all',
    async (request, reply) => {
      if (!isAuthenticated(request, authConfig)) {
        return reply.code(401).send({ ok: false, error: '需要鉴权后才能撤销设备' });
      }
      const session = parseSessionCookie(request, authConfig);
      const settings = await loadSettings(dataDir);
      authConfig = await rotateCookieSecret(dataDir, authConfig);

      const keepCurrent = request.body?.keepCurrent !== false;
      if (keepCurrent && session) {
        setSessionCookie(request, reply, authConfig, session.remember, settings.rememberDays);
      } else if (!keepCurrent) {
        clearSessionCookie(request, reply);
      }
      return { ok: true, keptCurrent: Boolean(keepCurrent && session) };
    }
  );

  app.get('/api/canvas', async (request, reply): Promise<CanvasResponse> => {
    const [doc, settings] = await Promise.all([loadCanvas(dataDir), loadSettings(dataDir)]);
    const session = parseSessionCookie(request, authConfig);
    const unlocked = Boolean(session) || verifyBearerToken(request, authConfig);
    if (unlocked) {
      if (session?.remember && settings.slidingRenewal) {
        setSessionCookie(request, reply, authConfig, true, settings.rememberDays);
      }
      return {
        ...doc,
        unlocked: true,
        hasPrivateHidden: false,
        settings,
      };
    }
    const { doc: publicDoc, hasPrivateHidden, publicViewportOrigin } = sanitizeCanvasForPublic(doc);
    return {
      ...publicDoc,
      unlocked: false,
      hasPrivateHidden,
      settings: {
        ...settings,
        viewportOrigin: publicViewportOrigin,
      },
    };
  });

  app.put<{ Body: Partial<CanvasDocument>; Querystring: { compact?: string } }>(
    '/api/canvas',
    async (request, reply) => {
      if (!isAuthenticated(request, authConfig)) {
        return reply.code(401).send({ ok: false, error: '需要解锁验证后才能保存画布' });
      }

      const body = request.body;
      if (!body || !Array.isArray(body.folders) || !Array.isArray(body.items)) {
        return reply.code(400).send({ ok: false, error: '请求体必须包含 folders 与 items 数组' });
      }

      const [existing, settings] = await Promise.all([loadCanvas(dataDir), loadSettings(dataDir)]);
      const normalizedPublicLayout = normalizePublicLayout(body.publicLayout);
      const rawNextDoc: CanvasDocument = {
        version: 2,
        updatedAt: new Date().toISOString(),
        grid: body.grid ?? existing.grid,
        folders: body.folders,
        items: body.items,
        zones: Array.isArray(body.zones) ? body.zones : [],
        widgets: Array.isArray(body.widgets) ? body.widgets : [],
        ...(normalizedPublicLayout ? { publicLayout: normalizedPublicLayout } : {}),
      };

      const nextDoc = reconcilePublicLayout(rawNextDoc);
      const check = validateCanvasDocument(nextDoc);
      if (!check.valid) {
        return reply.code(409).send({ ok: false, error: check.error || '画布实体存在重叠或非法参数' });
      }
      const publicCheck = validateCanvasDocument(projectPublicCanvas(nextDoc).doc);
      if (!publicCheck.valid) {
        return reply
          .code(409)
          .send({ ok: false, error: publicCheck.error || '公开布局存在重叠或非法参数' });
      }

      const saved = await saveCanvas(dataDir, nextDoc, 'canvas_put');
      if (request.query?.compact === '1') {
        return {
          ok: true,
          version: saved.version,
          updatedAt: saved.updatedAt,
          grid: saved.grid,
          unlocked: true,
          hasPrivateHidden: false,
        };
      }
      return {
        ...saved,
        unlocked: true,
        hasPrivateHidden: false,
        settings,
      };
    }
  );

  app.put<{ Body: Partial<SiteSettings> }>('/api/settings', async (request, reply) => {
    if (!isAuthenticated(request, authConfig)) {
      return reply.code(401).send({ ok: false, error: '需要鉴权后才能修改设置' });
    }
    const patch = request.body ?? {};
    const prevSettings = await loadSettings(dataDir);
    const nextSettings = await saveSettings(dataDir, patch);

    let doc = await loadCanvas(dataDir);
    const targetGrid = GRID_DENSITY_MAP[nextSettings.gridDensity];
    if (
      prevSettings.gridDensity !== nextSettings.gridDensity ||
      doc.grid.cellSize !== targetGrid.cellSize ||
      doc.grid.gap !== targetGrid.gap
    ) {
      doc = await saveCanvas(
        dataDir,
        {
          ...doc,
          grid: { ...targetGrid },
        },
        'settings_grid_density'
      );
    }

    return {
      ok: true,
      settings: nextSettings,
      grid: doc.grid,
    };
  });

  const IMAGE_MIME_EXT: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  };
  const EXT_MIME_MAP: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
  };

  app.post<{ Body: { dataUrl?: string; mimeType?: string; dataBase64?: string } }>(
    '/api/uploads/image',
    async (request, reply) => {
      if (!isAuthenticated(request, authConfig)) {
        return reply.code(401).send({ ok: false, error: '需要鉴权后才能上传图片' });
      }
      const body = request.body ?? {};
      let mime = '';
      let base64Str = '';

      if (typeof body.dataUrl === 'string' && body.dataUrl.trim()) {
        const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif|avif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(
          body.dataUrl.trim()
        );
        if (!match) {
          return reply.code(400).send({
            ok: false,
            error: '仅支持 png/jpg/webp/gif/avif Base64 Data URL',
          });
        }
        mime = match[1].toLowerCase();
        base64Str = match[2].replace(/\s+/g, '');
      } else if (typeof body.mimeType === 'string' && typeof body.dataBase64 === 'string') {
        mime = body.mimeType.trim().toLowerCase();
        base64Str = body.dataBase64.replace(/\s+/g, '');
      } else {
        return reply.code(400).send({ ok: false, error: '缺少图片数据 dataUrl 或 dataBase64' });
      }

      const ext = IMAGE_MIME_EXT[mime];
      if (!ext) {
        return reply.code(400).send({ ok: false, error: '不支持的图片格式' });
      }

      const buffer = Buffer.from(base64Str, 'base64');
      if (!buffer || buffer.length === 0) {
        return reply.code(400).send({ ok: false, error: '图片内容为空或 Base64 无效' });
      }
      if (buffer.length > 10 * 1024 * 1024) {
        return reply.code(413).send({ ok: false, error: '单张图片大小不能超过 10 MB' });
      }

      let outputBuffer: Buffer = buffer;
      let outputExt = ext;
      if (mime !== 'image/gif') {
        try {
          outputBuffer = await sharp(buffer)
            .rotate()
            .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 84 })
            .toBuffer();
          outputExt = 'webp';
        } catch {
          return reply.code(400).send({ ok: false, error: '图片解析或 WebP 转码失败' });
        }
      }

      const hash = crypto.createHash('sha256').update(outputBuffer).digest('hex').slice(0, 24);
      const filename = `${hash}.${outputExt}`;
      const uploadsDir = path.join(dataDir, 'uploads');
      await fsp.mkdir(uploadsDir, { recursive: true });
      const targetPath = path.join(uploadsDir, filename);
      const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}`;
      await fsp.writeFile(tmpPath, outputBuffer);
      await fsp.rename(tmpPath, targetPath);

      return { ok: true, url: `/api/uploads/${filename}` };
    }
  );

  app.get<{ Params: { filename: string } }>('/api/uploads/:filename', async (request, reply) => {
    const filename = request.params.filename;
    if (!/^[a-f0-9]{16,64}\.(png|jpg|jpeg|webp|gif|avif)$/i.test(filename)) {
      return reply.code(400).send({ ok: false, error: '非法文件名' });
    }
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const mime = EXT_MIME_MAP[ext];
    if (!mime) {
      return reply.code(400).send({ ok: false, error: '非法图片扩展名' });
    }
    const filePath = path.join(dataDir, 'uploads', filename);
    try {
      const data = await fsp.readFile(filePath);
      return reply
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .type(mime)
        .send(data);
    } catch {
      return reply.code(404).send({ ok: false, error: '图片不存在' });
    }
  });

  app.post<{ Body: { url?: string } }>('/api/meta/fetch', async (request, reply) => {
    if (!isAuthenticated(request, authConfig)) {
      return reply.code(401).send({ ok: false, error: '需要鉴权' });
    }
    const url = request.body?.url;
    if (!url || typeof url !== 'string') {
      return reply.code(400).send({ ok: false, error: '缺少 url 参数' });
    }
    try {
      const settings = await loadSettings(dataDir);
      const meta = await fetchUrlMetadata(url, settings.allowPrivateMeta);
      return { ok: true, ...meta };
    } catch (err) {
      return reply.code(400).send({
        ok: false,
        error: err instanceof Error ? err.message : '抓取元数据失败',
      });
    }
  });

  app.get<{ Querystring: { format?: string } }>('/api/agent/guide', async (request, reply) => {
    const accept = request.headers.accept ?? '';
    if (request.query?.format === 'json' || accept.includes('application/json')) {
      return buildAgentGuideJson();
    }
    return reply.type('text/markdown; charset=utf-8').send(buildAgentGuideMarkdown());
  });

  app.get('/api/agent/credentials', async (request, reply) => {
    if (!isAuthenticated(request, authConfig)) {
      return reply.code(401).send({ ok: false, error: '需要鉴权' });
    }
    return {
      ok: true,
      apiToken: authConfig.apiToken,
    };
  });

  app.post('/api/agent/rotate-token', async (request, reply) => {
    if (!isAuthenticated(request, authConfig)) {
      return reply.code(401).send({ ok: false, error: '需要鉴权' });
    }
    authConfig = await rotateApiToken(dataDir, authConfig);
    return {
      ok: true,
      apiToken: authConfig.apiToken,
    };
  });

  app.post<{ Body: { ops?: AgentOp[]; reason?: string } | AgentOp[] }>(
    '/api/agent/ops',
    async (request, reply) => {
      if (!isAuthenticated(request, authConfig)) {
        return reply.code(401).send({ ok: false, error: '需要 Session Cookie 或 Bearer Token 鉴权' });
      }

      const body = request.body;
      const ops = Array.isArray(body) ? body : body?.ops;
      const reason = Array.isArray(body) ? 'agent_ops' : body?.reason || 'agent_ops';

      if (!Array.isArray(ops) || ops.length === 0) {
        return reply.code(400).send({ ok: false, error: '请求体必须提供非空 ops 数组' });
      }

      const [currentDoc, settings] = await Promise.all([
        loadCanvas(dataDir),
        loadSettings(dataDir),
      ]);
      try {
        const nextDoc = applyAgentOps(currentDoc, ops);
        const saved = await saveCanvas(dataDir, nextDoc, reason);
        return {
          ok: true,
          applied: ops.length,
          canvas: {
            ...saved,
            unlocked: true,
            hasPrivateHidden: false,
            settings,
          },
        };
      } catch (err) {
        if (err instanceof AgentOpError) {
          return reply.code(err.statusCode).send({
            ok: false,
            error: err.message,
            reason: err.reason,
            opIndex: err.opIndex,
          });
        }
        return reply.code(500).send({
          ok: false,
          error: err instanceof Error ? err.message : '执行 Agent 操作失败',
        });
      }
    }
  );

  app.get('/api/history', async (request, reply) => {
    if (!isAuthenticated(request, authConfig)) {
      return reply.code(401).send({ ok: false, error: '需要鉴权' });
    }
    const items = await listHistory(dataDir);
    return { ok: true, items };
  });

  app.post<{ Body?: { label?: string } }>('/api/history', async (request, reply) => {
    if (!isAuthenticated(request, authConfig)) {
      return reply.code(401).send({ ok: false, error: '需要鉴权' });
    }
    const label = typeof request.body?.label === 'string' ? request.body.label : undefined;
    const snapshot = await createManualSnapshot(dataDir, label);
    return { ok: true, snapshot };
  });

  app.delete<{ Params: { id: string } }>('/api/history/:id', async (request, reply) => {
    if (!isAuthenticated(request, authConfig)) {
      return reply.code(401).send({ ok: false, error: '需要鉴权' });
    }
    try {
      await deleteHistorySnapshot(dataDir, request.params.id);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除快照失败';
      return reply.code(msg === '无效的快照 ID' ? 400 : 404).send({
        ok: false,
        error: msg,
      });
    }
  });

  app.post<{ Body: { id?: string } }>('/api/history/restore', async (request, reply) => {
    if (!isAuthenticated(request, authConfig)) {
      return reply.code(401).send({ ok: false, error: '需要鉴权' });
    }
    const id = request.body?.id;
    if (!id || typeof id !== 'string') {
      return reply.code(400).send({ ok: false, error: '缺少快照 id' });
    }
    try {
      const [restored, settings] = await Promise.all([
        restoreHistorySnapshot(dataDir, id),
        loadSettings(dataDir),
      ]);
      return {
        ok: true,
        canvas: {
          ...restored,
          unlocked: true,
          hasPrivateHidden: false,
          settings,
        },
      };
    } catch (err) {
      return reply.code(404).send({
        ok: false,
        error: err instanceof Error ? err.message : '恢复快照失败',
      });
    }
  });

  app.get('/api/backup/export', async (request, reply) => {
    if (!isAuthenticated(request, authConfig)) {
      return reply.code(401).send({ ok: false, error: '需要鉴权' });
    }
    const [canvas, settings] = await Promise.all([loadCanvas(dataDir), loadSettings(dataDir)]);
    const referenced = new Set<string>();
    collectUploadRefsFromText(JSON.stringify(canvas), referenced);
    collectUploadRefsFromText(JSON.stringify(settings), referenced);

    const uploadsDir = path.join(dataDir, 'uploads');
    const uploads: Record<string, string> = {};
    for (const filename of referenced) {
      if (!UPLOAD_FILE_RE.test(filename)) continue;
      try {
        const buf = await fsp.readFile(path.join(uploadsDir, filename));
        if (buf.length > 0) {
          uploads[filename] = buf.toString('base64');
        }
      } catch {
        // Ignore missing upload files referenced in data
      }
    }

    const dateSlug = new Date().toISOString().slice(0, 10);
    reply.header('Content-Disposition', `attachment; filename="neko-like-backup-${dateSlug}.json"`);
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      settings,
      canvas,
      uploads,
    };
  });

  app.post<{
    Body: {
      canvas?: unknown;
      settings?: Partial<SiteSettings>;
      uploads?: Record<string, unknown>;
    };
  }>(
    '/api/backup/import',
    { bodyLimit: 64 * 1024 * 1024 },
    async (request, reply) => {
      if (!isAuthenticated(request, authConfig)) {
        return reply.code(401).send({ ok: false, error: '需要鉴权' });
      }
      const rawBody = request.body;
      const normalized = normalizeDocument(rawBody?.canvas ?? rawBody);
      if (!normalized) {
        return reply.code(400).send({ ok: false, error: '无效的备份画布数据结构' });
      }

      const validation = validateCanvasDocument(normalized.doc);
      if (!validation.valid) {
        return reply.code(409).send({
          ok: false,
          error: validation.error || '备份画布存在网格重叠或引用错误',
        });
      }

      const rawUploads = rawBody?.uploads;
      if (rawUploads && typeof rawUploads === 'object' && !Array.isArray(rawUploads)) {
        const uploadsDir = path.join(dataDir, 'uploads');
        await fsp.mkdir(uploadsDir, { recursive: true });
        for (const [filename, b64] of Object.entries(rawUploads)) {
          if (!UPLOAD_FILE_RE.test(filename) || typeof b64 !== 'string' || !b64) continue;
          const buf = Buffer.from(b64, 'base64');
          if (buf.length <= 0 || buf.length > 10 * 1024 * 1024) continue;
          const dest = path.join(uploadsDir, filename);
          const tmp = path.join(uploadsDir, `.${filename}.tmp-${process.pid}-${Date.now()}`);
          await fsp.writeFile(tmp, buf);
          await fsp.rename(tmp, dest);
        }
      }

      const savedCanvas = await saveCanvas(dataDir, normalized.doc, 'backup_import');
      const savedSettings = rawBody?.settings
        ? await saveSettings(dataDir, rawBody.settings)
        : await loadSettings(dataDir);

      return {
        ok: true,
        canvas: {
          ...savedCanvas,
          unlocked: true,
          hasPrivateHidden: false,
          settings: savedSettings,
        },
        settings: savedSettings,
      };
    }
  );

  if (options.serveStatic !== false) {
    const staticDir = resolveStaticDir();
    if (staticDir) {
      const indexHtmlPath = path.join(staticDir, 'index.html');
      const indexHtmlTemplate = fs.readFileSync(indexHtmlPath, 'utf8');

      const escapeHtmlTitle = (str: string) =>
        str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const sendBootHtml = async (
        request: Parameters<typeof parseSessionCookie>[0],
        reply: Parameters<typeof setSessionCookie>[1]
      ) => {
        const [doc, settings] = await Promise.all([loadCanvas(dataDir), loadSettings(dataDir)]);
        const session = parseSessionCookie(request, authConfig);
        const unlocked = Boolean(session) || verifyBearerToken(request, authConfig);
        let bootPayload: CanvasResponse;
        if (unlocked) {
          if (session?.remember && settings.slidingRenewal) {
            setSessionCookie(request, reply, authConfig, true, settings.rememberDays);
          }
          bootPayload = {
            ...doc,
            unlocked: true,
            hasPrivateHidden: false,
            settings,
          };
        } else {
          const { doc: publicDoc, hasPrivateHidden, publicViewportOrigin } =
            sanitizeCanvasForPublic(doc);
          bootPayload = {
            ...publicDoc,
            unlocked: false,
            hasPrivateHidden,
            settings: {
              ...settings,
              viewportOrigin: publicViewportOrigin,
            },
          };
        }

        const safeJson = JSON.stringify(bootPayload).replace(/</g, '\\u003c');
        const html = indexHtmlTemplate
          .replace('<html ', `<html data-default-theme="${settings.defaultTheme}" `)
          .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtmlTitle(settings.siteTitle)}</title>`)
          .replace(
            '</head>',
            `<script id="neko-boot" type="application/json">${safeJson}</script></head>`
          );

        return reply
          .header('Cache-Control', 'private, no-store')
          .type('text/html; charset=utf-8')
          .send(html);
      };

      await app.register(fastifyStatic, {
        root: staticDir,
        prefix: '/',
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      });

      app.get('/', async (request, reply) => sendBootHtml(request, reply));

      app.setNotFoundHandler(async (request, reply) => {
        if (request.url.startsWith('/api/') || request.url === '/llms.txt') {
          return reply.code(404).send({ ok: false, error: 'API 路由不存在' });
        }
        return sendBootHtml(request, reply);
      });
    }
  }

  return app;
}
