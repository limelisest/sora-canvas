import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp } from '../server/app.js';
import { normalizeDocument, pruneOrphanedUploads } from '../server/store.js';
import { DEFAULT_SITE_SETTINGS, normalizeSiteSettings } from '../shared/settings.js';

let tmpDir: string;
let app: FastifyInstance;
let initialPassword: string;
let apiToken: string;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neko-like-test-'));
  app = await buildApp({ dataDir: tmpDir, serveStatic: false });

  initialPassword = (await fs.readFile(path.join(tmpDir, 'initial-password'), 'utf8')).trim();
  const cfg = JSON.parse(await fs.readFile(path.join(tmpDir, 'config.json'), 'utf8')) as {
    apiToken: string;
  };
  apiToken = cfg.apiToken;
});

after(async () => {
  await app.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function extractSessionCookie(setCookieHeader: string | string[] | undefined): string {
  const list = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  const raw = list.find((c) => c.startsWith('neko_like_session='));
  assert.ok(raw, 'Expected neko_like_session cookie');
  return raw.split(';')[0];
}

test('auth files: initial-password and config.json created with 0600 permissions', async () => {
  const pwStat = await fs.stat(path.join(tmpDir, 'initial-password'));
  const cfgStat = await fs.stat(path.join(tmpDir, 'config.json'));
  assert.equal(pwStat.mode & 0o777, 0o600);
  assert.equal(cfgStat.mode & 0o777, 0o600);
  assert.equal(initialPassword.length, 16);
  assert.equal(apiToken.length, 64);
});

test('security: unauthenticated GET /api/canvas strips private folders AND private items with zero leak', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/canvas' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.version, 2);
  assert.equal(body.unlocked, false);
  assert.equal(body.hasPrivateHidden, true);

  const rawText = res.body;
  assert.equal(rawText.includes('私密收藏'), false);
  assert.equal(rawText.includes('vault.internal.example'), false);
  assert.equal(rawText.includes('私密密码库'), false);
  assert.equal(rawText.includes('notes.internal.example'), false);
  assert.equal(body.folders.some((f: { isPrivate?: boolean }) => f.isPrivate === true), false);
  assert.equal(
    body.items.some((i: { parentId?: string | null }) => i.parentId === 'seed-private-vault'),
    false
  );
});

test('security: unauthenticated writes are blocked with 401', async () => {
  const putRes = await app.inject({
    method: 'PUT',
    url: '/api/canvas',
    payload: { folders: [], items: [] },
  });
  assert.equal(putRes.statusCode, 401);

  const opsRes = await app.inject({
    method: 'POST',
    url: '/api/agent/ops',
    payload: { ops: [{ op: 'create_item', title: 'test', url: 'https://example.com' }] },
  });
  assert.equal(opsRes.statusCode, 401);
});

test('auth flow: unlock reveals private folders and items, lock hides them again', async () => {
  const badRes = await app.inject({
    method: 'POST',
    url: '/api/auth/unlock',
    payload: { password: 'wrong-password' },
  });
  assert.equal(badRes.statusCode, 401);

  const unlockRes = await app.inject({
    method: 'POST',
    url: '/api/auth/unlock',
    payload: { password: initialPassword },
  });
  assert.equal(unlockRes.statusCode, 200);
  const cookie = extractSessionCookie(unlockRes.headers['set-cookie']);

  const unlockedCanvas = await app.inject({
    method: 'GET',
    url: '/api/canvas',
    headers: { cookie },
  });
  assert.equal(unlockedCanvas.statusCode, 200);
  const unlockedBody = unlockedCanvas.json();
  assert.equal(unlockedBody.unlocked, true);
  assert.equal(unlockedBody.hasPrivateHidden, false);
  assert.ok(unlockedBody.folders.some((f: { id: string }) => f.id === 'seed-private-vault'));
  assert.ok(
    unlockedBody.items.some((i: { parentId: string | null }) => i.parentId === 'seed-private-vault')
  );

  const lockRes = await app.inject({
    method: 'POST',
    url: '/api/auth/lock',
    headers: { cookie },
  });
  assert.equal(lockRes.statusCode, 200);
  const clearedCookie = extractSessionCookie(lockRes.headers['set-cookie']);

  const afterLockCanvas = await app.inject({
    method: 'GET',
    url: '/api/canvas',
    headers: { cookie: clearedCookie },
  });
  const afterLockBody = afterLockCanvas.json();
  assert.equal(afterLockBody.unlocked, false);
  assert.equal(afterLockBody.hasPrivateHidden, true);
  assert.equal(afterLockBody.folders.some((f: { id: string }) => f.id === 'seed-private-vault'), false);
  assert.equal(
    afterLockBody.items.some(
      (i: { parentId: string | null }) => i.parentId === 'seed-private-vault'
    ),
    false
  );
});

test('migration: automatically converts legacy v1 nodes[] canvas.json losslessly to v2', async () => {
  const migDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neko-like-mig-'));
  try {
    const legacyV1 = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      grid: { cellSize: 108, gap: 14 },
      nodes: [
        {
          id: 'v1-link',
          type: 'link',
          x: 0,
          y: 0,
          w: 2,
          h: 1,
          title: 'Legacy Link',
          url: 'https://legacy.example',
        },
        {
          id: 'v1-folder',
          type: 'folder',
          x: 2,
          y: 0,
          w: 2,
          h: 2,
          title: 'Legacy Private',
          displayMode: 'grid',
          isPrivate: true,
          children: [
            { id: 'v1-c1', title: 'Secret 1', url: 'https://secret1.example' },
            { id: 'v1-c2', title: 'Secret 2', url: 'https://secret2.example' },
          ],
        },
      ],
    };
    await fs.writeFile(path.join(migDir, 'canvas.json'), JSON.stringify(legacyV1), 'utf8');

    const migApp = await buildApp({ dataDir: migDir, password: 'mig-password', serveStatic: false });
    try {
      const pubRes = await migApp.inject({ method: 'GET', url: '/api/canvas' });
      const pubBody = pubRes.json();
      assert.equal(pubBody.version, 2);
      assert.equal(pubBody.hasPrivateHidden, true);
      assert.equal(pubBody.folders.length, 0);
      assert.equal(pubBody.items.length, 1);
      assert.equal(pubBody.items[0].id, 'v1-link');

      const unlock = await migApp.inject({
        method: 'POST',
        url: '/api/auth/unlock',
        payload: { password: 'mig-password' },
      });
      const cookie = extractSessionCookie(unlock.headers['set-cookie']);
      const fullRes = await migApp.inject({
        method: 'GET',
        url: '/api/canvas',
        headers: { cookie },
      });
      const fullBody = fullRes.json();
      assert.equal(fullBody.folders.length, 1);
      assert.equal(fullBody.folders[0].id, 'v1-folder');
      assert.equal(fullBody.items.length, 3);
      const c1 = fullBody.items.find((i: { id: string }) => i.id === 'v1-c1');
      assert.equal(c1.parentId, 'v1-folder');
      assert.equal(c1.order, 0);
    } finally {
      await migApp.close();
    }
  } finally {
    await fs.rm(migDir, { recursive: true, force: true });
  }
});

test('agent v2 ops: ID stability across desktop <-> folder <-> merge <-> dissolve, resize push, 409 surrounded, and history restore', async () => {
  const guideJson = await app.inject({ method: 'GET', url: '/api/agent/guide?format=json' });
  assert.equal(guideJson.statusCode, 200);
  assert.equal(guideJson.json().version, 2);

  // 1. Create items + folder and verify autoPlace & ID stability
  const step1 = await app.inject({
    method: 'POST',
    url: '/api/agent/ops',
    headers: { authorization: `Bearer ${apiToken}` },
    payload: {
      reason: 'v2_create_entities',
      ops: [
        {
          op: 'create_item',
          id: 'stable-item',
          title: 'Stable Bookmark',
          url: 'https://stable.example',
        },
        {
          op: 'create_item',
          id: 'merge-target',
          title: 'Merge Target',
          url: 'https://target.example',
          x: 15,
          y: 15,
          w: 1,
          h: 1,
        },
        {
          op: 'create_folder',
          id: 'test-folder',
          title: 'Test Folder',
          x: 18,
          y: 15,
          w: 2,
          h: 2,
        },
      ],
    },
  });
  assert.equal(step1.statusCode, 200);
  assert.ok(step1.json().canvas.items.some((i: { id: string }) => i.id === 'stable-item'));

  // 2. Move stable-item into folder -> back out to canvas pushing neighbor -> merge -> dissolve
  const step2 = await app.inject({
    method: 'POST',
    url: '/api/agent/ops',
    headers: { authorization: `Bearer ${apiToken}` },
    payload: {
      ops: [
        { op: 'move_items_to_folder', itemIds: ['stable-item'], folderId: 'test-folder' },
      ],
    },
  });
  assert.equal(step2.statusCode, 200);
  const inFolder = step2.json().canvas.items.find((i: { id: string }) => i.id === 'stable-item');
  assert.equal(inFolder.parentId, 'test-folder');

  // Drop stable-item directly onto merge-target's coordinates (15,15) -> pushes merge-target orthogonally!
  const step3 = await app.inject({
    method: 'POST',
    url: '/api/agent/ops',
    headers: { authorization: `Bearer ${apiToken}` },
    payload: {
      ops: [{ op: 'move_items_to_canvas', itemIds: ['stable-item'], x: 15, y: 15 }],
    },
  });
  assert.equal(step3.statusCode, 200);
  const backOnDesktop = step3.json().canvas.items.find((i: { id: string }) => i.id === 'stable-item');
  const pushedTarget = step3.json().canvas.items.find((i: { id: string }) => i.id === 'merge-target');
  assert.equal(backOnDesktop.parentId, null);
  assert.equal(backOnDesktop.x, 15);
  assert.equal(backOnDesktop.y, 15);
  assert.equal(Math.abs(pushedTarget.x - 15) + Math.abs(pushedTarget.y - 15), 1);

  // Merge stable-item onto merge-target into a new folder, then dissolve folder keeping both items
  const step4 = await app.inject({
    method: 'POST',
    url: '/api/agent/ops',
    headers: { authorization: `Bearer ${apiToken}` },
    payload: {
      ops: [
        {
          op: 'merge_items_to_folder',
          sourceItemId: 'stable-item',
          targetItemId: 'merge-target',
          folderId: 'merged-folder',
          title: 'Merged',
        },
      ],
    },
  });
  assert.equal(step4.statusCode, 200);
  const mergedItems = step4.json().canvas.items;
  assert.equal(mergedItems.find((i: { id: string }) => i.id === 'stable-item').parentId, 'merged-folder');
  assert.equal(mergedItems.find((i: { id: string }) => i.id === 'merge-target').parentId, 'merged-folder');

  const step5 = await app.inject({
    method: 'POST',
    url: '/api/agent/ops',
    headers: { authorization: `Bearer ${apiToken}` },
    payload: {
      ops: [{ op: 'dissolve_folder', id: 'merged-folder', deleteItems: false }],
    },
  });
  assert.equal(step5.statusCode, 200);
  assert.equal(
    step5.json().canvas.folders.some((f: { id: string }) => f.id === 'merged-folder'),
    false
  );
  const dissolvedStable = step5.json().canvas.items.find((i: { id: string }) => i.id === 'stable-item');
  const dissolvedTarget = step5.json().canvas.items.find((i: { id: string }) => i.id === 'merge-target');
  assert.equal(dissolvedStable.parentId, null);
  assert.equal(dissolvedTarget.parentId, null);

  // 3. Surrounded resize & surrounded external drop both return 409 Conflict
  await app.inject({
    method: 'POST',
    url: '/api/agent/ops',
    headers: { authorization: `Bearer ${apiToken}` },
    payload: {
      ops: [
        { op: 'create_item', id: 's-c', title: 'c', url: 'https://e.co', x: 30, y: 30 },
        { op: 'create_item', id: 's-r', title: 'r', url: 'https://e.co', x: 31, y: 30 },
        { op: 'create_item', id: 's-l', title: 'l', url: 'https://e.co', x: 29, y: 30 },
        { op: 'create_item', id: 's-d', title: 'd', url: 'https://e.co', x: 30, y: 31 },
        { op: 'create_item', id: 's-u', title: 'u', url: 'https://e.co', x: 30, y: 29 },
        { op: 'create_item', id: 's-r2', title: 'r2', url: 'https://e.co', x: 32, y: 30 },
        { op: 'create_item', id: 's-rd', title: 'rd', url: 'https://e.co', x: 31, y: 31 },
        { op: 'create_item', id: 's-ru', title: 'ru', url: 'https://e.co', x: 31, y: 29 },
        { op: 'create_item', id: 'folder-child', title: 'fc', url: 'https://e.co', parentId: 'test-folder' },
      ],
    },
  });

  const resizeConflict = await app.inject({
    method: 'POST',
    url: '/api/agent/ops',
    headers: { authorization: `Bearer ${apiToken}` },
    payload: { ops: [{ op: 'resize_entity', id: 's-c', w: 2, h: 1 }] },
  });
  assert.equal(resizeConflict.statusCode, 409);
  assert.equal(resizeConflict.json().reason, 'surrounded');

  const dropConflict = await app.inject({
    method: 'POST',
    url: '/api/agent/ops',
    headers: { authorization: `Bearer ${apiToken}` },
    payload: { ops: [{ op: 'move_items_to_canvas', itemIds: ['folder-child'], x: 30, y: 30 }] },
  });
  assert.equal(dropConflict.statusCode, 409);
  assert.equal(dropConflict.json().reason, 'surrounded');

  // 4. Snapshot history & restore
  const histRes = await app.inject({
    method: 'GET',
    url: '/api/history',
    headers: { authorization: `Bearer ${apiToken}` },
  });
  assert.equal(histRes.statusCode, 200);
  const histItems = histRes.json().items as Array<{ id: string }>;
  assert.ok(histItems.length >= 3);

  const earliest = histItems[histItems.length - 1];
  const restoreRes = await app.inject({
    method: 'POST',
    url: '/api/history/restore',
    headers: { authorization: `Bearer ${apiToken}` },
    payload: { id: earliest.id },
  });
  assert.equal(restoreRes.statusCode, 200);
  assert.equal(
    restoreRes.json().canvas.items.some((i: { id: string }) => i.id === 'stable-item'),
    false
  );
});

test('auth persistence: 365-day remember cookie, session-only cookie, sliding renewal, HTTPS-safe lock, and password change', async () => {
  // 1. Default remember=true sets Max-Age=31536000
  const rememberRes = await app.inject({
    method: 'POST',
    url: '/api/auth/unlock',
    payload: { password: initialPassword, remember: true },
  });
  assert.equal(rememberRes.statusCode, 200);
  const rememberSetCookie = String(rememberRes.headers['set-cookie']);
  assert.ok(rememberSetCookie.includes('Max-Age=31536000'), rememberSetCookie);
  const persistentCookie = extractSessionCookie(rememberRes.headers['set-cookie']);

  // Sliding renewal on GET /api/canvas re-issues 365-day Set-Cookie
  const renewRes = await app.inject({
    method: 'GET',
    url: '/api/canvas',
    headers: { cookie: persistentCookie },
  });
  assert.equal(renewRes.statusCode, 200);
  assert.equal(renewRes.json().unlocked, true);
  assert.ok(String(renewRes.headers['set-cookie']).includes('Max-Age=31536000'));

  // 2. remember=false omits Max-Age (session-only cookie) and does NOT sliding-renew
  const tempRes = await app.inject({
    method: 'POST',
    url: '/api/auth/unlock',
    payload: { password: initialPassword, remember: false },
  });
  assert.equal(tempRes.statusCode, 200);
  const tempSetCookie = String(tempRes.headers['set-cookie']);
  assert.equal(tempSetCookie.includes('Max-Age='), false, tempSetCookie);
  const tempCookie = extractSessionCookie(tempRes.headers['set-cookie']);

  const tempCanvas = await app.inject({
    method: 'GET',
    url: '/api/canvas',
    headers: { cookie: tempCookie },
  });
  assert.equal(tempCanvas.json().unlocked, true);
  assert.equal(tempCanvas.headers['set-cookie'], undefined);

  // 3. HTTPS-safe manual lock behind reverse proxy emits Secure on cleared cookie
  const httpsLockRes = await app.inject({
    method: 'POST',
    url: '/api/auth/lock',
    headers: {
      cookie: persistentCookie,
      'x-forwarded-proto': 'https',
    },
  });
  assert.equal(httpsLockRes.statusCode, 200);
  const clearedHeader = String(httpsLockRes.headers['set-cookie']);
  assert.ok(clearedHeader.includes('Secure'), clearedHeader);
  const clearedCookie = extractSessionCookie(httpsLockRes.headers['set-cookie']);
  const afterLock = await app.inject({
    method: 'GET',
    url: '/api/canvas',
    headers: { cookie: clearedCookie },
  });
  assert.equal(afterLock.json().unlocked, false);

  // 4. Password update via POST /api/auth/password
  const badCurrent = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: { cookie: persistentCookie },
    payload: { currentPassword: 'wrong', newPassword: 'new-password-123' },
  });
  assert.equal(badCurrent.statusCode, 401);

  const tooShort = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: { cookie: persistentCookie },
    payload: { currentPassword: initialPassword, newPassword: '123' },
  });
  assert.equal(tooShort.statusCode, 400);

  const okChange = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: { cookie: persistentCookie },
    payload: { currentPassword: initialPassword, newPassword: 'new-password-123' },
  });
  assert.equal(okChange.statusCode, 200);

  const cfgStat = await fs.stat(path.join(tmpDir, 'config.json'));
  assert.equal(cfgStat.mode & 0o777, 0o600);

  const oldUnlock = await app.inject({
    method: 'POST',
    url: '/api/auth/unlock',
    payload: { password: initialPassword },
  });
  assert.equal(oldUnlock.statusCode, 401);

  const newUnlock = await app.inject({
    method: 'POST',
    url: '/api/auth/unlock',
    payload: { password: 'new-password-123' },
  });
  assert.equal(newUnlock.statusCode, 200);
});

test('v3 settings, /llms.txt discovery, token rotation, device revoke-all, and backup export/import', async () => {
  // 1. Public /llms.txt returns 200 Markdown with curl examples
  const llmsRes = await app.inject({ method: 'GET', url: '/llms.txt' });
  assert.equal(llmsRes.statusCode, 200);
  assert.ok(llmsRes.headers['content-type']?.includes('text/markdown'));
  assert.ok(llmsRes.body.includes('POST /api/agent/ops'));
  assert.ok(llmsRes.body.includes('curl'));

  // 2. Unauthenticated access to all v3 sensitive endpoints blocked with 401
  assert.equal((await app.inject({ method: 'PUT', url: '/api/settings', payload: {} })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/agent/credentials' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/agent/rotate-token' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/backup/export' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/backup/import', payload: {} })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/revoke-all', payload: {} })).statusCode, 401);

  // Unlock two separate client cookies using updated password
  const unlockA = await app.inject({
    method: 'POST',
    url: '/api/auth/unlock',
    payload: { password: 'new-password-123', remember: true },
  });
  const cookieA = extractSessionCookie(unlockA.headers['set-cookie']);

  const unlockB = await app.inject({
    method: 'POST',
    url: '/api/auth/unlock',
    payload: { password: 'new-password-123', remember: true },
  });
  const cookieB = extractSessionCookie(unlockB.headers['set-cookie']);

  // 3. PUT /api/settings updates siteTitle, defaultFolderW/H, mobileDefaultView, and syncs gridDensity -> canvas.grid
  assert.equal(normalizeSiteSettings({ siteTitle: 'Legacy' }).mobileDefaultView, 'paged');

  const initialCanvasSettings = await app.inject({ method: 'GET', url: '/api/canvas' });
  assert.equal(initialCanvasSettings.json().settings.mobileDefaultView, 'paged');

  const setRes = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { cookie: cookieA },
    payload: {
      siteTitle: 'My Neko Space',
      defaultFolderW: 3,
      defaultFolderH: 3,
      gridDensity: 'compact',
      mobileDefaultView: 'canvas',
    },
  });
  assert.equal(setRes.statusCode, 200);
  assert.equal(setRes.json().settings.siteTitle, 'My Neko Space');
  assert.equal(setRes.json().settings.defaultFolderW, 3);
  assert.equal(setRes.json().settings.mobileDefaultView, 'canvas');
  assert.deepEqual(setRes.json().grid, { cellSize: 92, gap: 12 });

  const canvasWithSettings = await app.inject({ method: 'GET', url: '/api/canvas' });
  assert.equal(canvasWithSettings.json().settings.siteTitle, 'My Neko Space');
  assert.equal(canvasWithSettings.json().settings.mobileDefaultView, 'canvas');
  assert.deepEqual(canvasWithSettings.json().grid, { cellSize: 92, gap: 12 });

  const restorePagedRes = await app.inject({
    method: 'PUT',
    url: '/api/settings',
    headers: { cookie: cookieA },
    payload: { mobileDefaultView: 'paged' },
  });
  assert.equal(restorePagedRes.statusCode, 200);
  assert.equal(restorePagedRes.json().settings.mobileDefaultView, 'paged');

  // 4. Agent credentials & token rotation invalidates old token and accepts new token
  const credRes = await app.inject({
    method: 'GET',
    url: '/api/agent/credentials',
    headers: { cookie: cookieA },
  });
  assert.equal(credRes.statusCode, 200);
  assert.equal(credRes.json().apiToken, apiToken);

  const rotateRes = await app.inject({
    method: 'POST',
    url: '/api/agent/rotate-token',
    headers: { cookie: cookieA },
  });
  assert.equal(rotateRes.statusCode, 200);
  const newToken = rotateRes.json().apiToken as string;
  assert.notEqual(newToken, apiToken);
  assert.equal(newToken.length, 64);

  const oldTokenCall = await app.inject({
    method: 'GET',
    url: '/api/agent/credentials',
    headers: { authorization: `Bearer ${apiToken}` },
  });
  assert.equal(oldTokenCall.statusCode, 401);

  const newTokenCall = await app.inject({
    method: 'GET',
    url: '/api/agent/credentials',
    headers: { authorization: `Bearer ${newToken}` },
  });
  assert.equal(newTokenCall.statusCode, 200);
  apiToken = newToken;

  // 5. Revoke all other devices keeps caller unlocked (keepCurrent: true) and revokes cookieB
  const revokeRes = await app.inject({
    method: 'POST',
    url: '/api/auth/revoke-all',
    headers: { cookie: cookieA },
    payload: { keepCurrent: true },
  });
  assert.equal(revokeRes.statusCode, 200);
  assert.equal(revokeRes.json().keptCurrent, true);
  const refreshedCookieA = extractSessionCookie(revokeRes.headers['set-cookie']);

  const checkB = await app.inject({
    method: 'GET',
    url: '/api/canvas',
    headers: { cookie: cookieB },
  });
  assert.equal(checkB.json().unlocked, false);

  const checkA = await app.inject({
    method: 'GET',
    url: '/api/canvas',
    headers: { cookie: refreshedCookieA },
  });
  assert.equal(checkA.json().unlocked, true);

  // 6. Backup export & import restores canvas + settings cleanly with automatic snapshot
  const exportRes = await app.inject({
    method: 'GET',
    url: '/api/backup/export',
    headers: { cookie: refreshedCookieA },
  });
  assert.equal(exportRes.statusCode, 200);
  const exported = exportRes.json();
  assert.equal(exported.version, 2);
  assert.equal(exported.settings.siteTitle, 'My Neko Space');

  // Mutate canvas via Agent op, then restore exported backup
  const addRes = await app.inject({
    method: 'POST',
    url: '/api/agent/ops',
    headers: { authorization: `Bearer ${newToken}` },
    payload: {
      ops: [{ op: 'create_item', id: 'temp-before-import', title: 'Temp', url: 'https://temp.example' }],
    },
  });
  assert.equal(addRes.statusCode, 200);

  const importRes = await app.inject({
    method: 'POST',
    url: '/api/backup/import',
    headers: { cookie: refreshedCookieA },
    payload: { canvas: exported.canvas, settings: exported.settings },
  });
  assert.equal(importRes.statusCode, 200);
  assert.equal(
    importRes.json().canvas.items.some((i: { id: string }) => i.id === 'temp-before-import'),
    false
  );
});

test('v3.1 snapshot 5-minute coalescing, manual snapshot/delete, and viewportOrigin persistence', async () => {
  const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neko-like-v31-'));
  const isolatedApp = await buildApp({ dataDir: isolatedDir, serveStatic: false });
  try {
    const cfg = JSON.parse(await fs.readFile(path.join(isolatedDir, 'config.json'), 'utf8')) as {
      apiToken: string;
    };
    const authHeaders = { authorization: `Bearer ${cfg.apiToken}` };

    // Start from current canvas
    const initialRes = await isolatedApp.inject({
      method: 'GET',
      url: '/api/canvas',
      headers: authHeaders,
    });
    assert.equal(initialRes.statusCode, 200);
    const baseCanvas = initialRes.json();
    assert.equal(baseCanvas.settings.viewportOrigin, null);

    // 1. Rapid consecutive PUT /api/canvas saves within 5 minutes coalesce into a single canvas_put snapshot
    const putPayload1 = {
      version: 2,
      updatedAt: new Date().toISOString(),
      grid: baseCanvas.grid,
      folders: baseCanvas.folders,
      items: baseCanvas.items,
    };
    assert.equal(
      (
        await isolatedApp.inject({
          method: 'PUT',
          url: '/api/canvas',
          headers: authHeaders,
          payload: putPayload1,
        })
      ).statusCode,
      200
    );
    assert.equal(
      (
        await isolatedApp.inject({
          method: 'PUT',
          url: '/api/canvas',
          headers: authHeaders,
          payload: putPayload1,
        })
      ).statusCode,
      200
    );
    assert.equal(
      (
        await isolatedApp.inject({
          method: 'PUT',
          url: '/api/canvas',
          headers: authHeaders,
          payload: putPayload1,
        })
      ).statusCode,
      200
    );

    const histAfterPuts = await isolatedApp.inject({
      method: 'GET',
      url: '/api/history',
      headers: authHeaders,
    });
    assert.equal(histAfterPuts.statusCode, 200);
    const putSnapshots = histAfterPuts
      .json()
      .items.filter((x: { reason: string }) => x.reason === 'canvas_put');
    assert.equal(putSnapshots.length, 1);

    // 2. POST /api/history creates a manual snapshot immediately even within the 5-minute window
    const manualRes = await isolatedApp.inject({
      method: 'POST',
      url: '/api/history',
      headers: authHeaders,
      payload: { label: '排版前检查点' },
    });
    assert.equal(manualRes.statusCode, 200);
    const manualSnap = manualRes.json().snapshot;
    assert.equal(manualSnap.reason, 'manual:排版前检查点');

    // Another PUT /api/canvas after a manual snapshot starts a new edit baseline
    assert.equal(
      (
        await isolatedApp.inject({
          method: 'PUT',
          url: '/api/canvas',
          headers: authHeaders,
          payload: putPayload1,
        })
      ).statusCode,
      200
    );

    const histAfterManual = await isolatedApp.inject({
      method: 'GET',
      url: '/api/history',
      headers: authHeaders,
    });
    assert.equal(histAfterManual.json().items.length, 3);

    // 3. DELETE /api/history/:id removes the manual snapshot
    const delRes = await isolatedApp.inject({
      method: 'DELETE',
      url: `/api/history/${manualSnap.id}`,
      headers: authHeaders,
    });
    assert.equal(delRes.statusCode, 200);

    const histAfterDelete = await isolatedApp.inject({
      method: 'GET',
      url: '/api/history',
      headers: authHeaders,
    });
    assert.equal(histAfterDelete.json().items.length, 2);
    assert.equal(
      histAfterDelete.json().items.some((x: { id: string }) => x.id === manualSnap.id),
      false
    );

    // 4. PUT /api/settings persists viewportOrigin { x, y } and resets back to null
    const setOriginRes = await isolatedApp.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeaders,
      payload: { viewportOrigin: { x: 142.4, y: -88.7 } },
    });
    assert.equal(setOriginRes.statusCode, 200);
    assert.deepEqual(setOriginRes.json().settings.viewportOrigin, { x: 142, y: -89 });

    const canvasCheck1 = await isolatedApp.inject({ method: 'GET', url: '/api/canvas' });
    assert.deepEqual(canvasCheck1.json().settings.viewportOrigin, { x: 142, y: -89 });

    const clearOriginRes = await isolatedApp.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { ...authHeaders },
      payload: { viewportOrigin: null },
    });
    assert.equal(clearOriginRes.statusCode, 200);
    assert.equal(clearOriginRes.json().settings.viewportOrigin, null);
  } finally {
    await isolatedApp.close();
    await fs.rm(isolatedDir, { recursive: true, force: true });
  }
});

test('v4 quarter-grid, private zones isolation, image uploads, and carousel/text/note widgets', async () => {
  const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neko-like-v4-'));
  const isolatedApp = await buildApp({ dataDir: isolatedDir, serveStatic: false });
  try {
    const cfg = JSON.parse(await fs.readFile(path.join(isolatedDir, 'config.json'), 'utf8')) as {
      apiToken: string;
    };
    const authHeaders = { authorization: `Bearer ${cfg.apiToken}` };
    const now = new Date().toISOString();

    // 1. Image upload requires auth; valid upload stores SHA-256 file and serves immutable image
    const unauthUpload = await isolatedApp.inject({
      method: 'POST',
      url: '/api/uploads/image',
      payload: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
    });
    assert.equal(unauthUpload.statusCode, 401);

    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
      'hex'
    );
    const uploadRes = await isolatedApp.inject({
      method: 'POST',
      url: '/api/uploads/image',
      headers: authHeaders,
      payload: { dataUrl: `data:image/png;base64,${pngBytes.toString('base64')}` },
    });
    assert.equal(uploadRes.statusCode, 200);
    const uploadedUrl = uploadRes.json().url as string;
    assert.match(uploadedUrl, /^\/api\/uploads\/[a-f0-9]{24}\.webp$/);

    const getImgRes = await isolatedApp.inject({ method: 'GET', url: uploadedUrl });
    assert.equal(getImgRes.statusCode, 200);
    assert.equal(getImgRes.headers['content-type'], 'image/webp');
    assert.equal(getImgRes.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(getImgRes.rawPayload.subarray(0, 4).toString('ascii'), 'RIFF');

    // Large 2400x1600 PNG is automatically downscaled <= 1600px wide and transcoded to smaller WebP
    const rawPixels = Buffer.alloc(2400 * 1600 * 3);
    for (let i = 0; i < rawPixels.length; i += 3) {
      rawPixels[i] = (i * 13) & 0xff;
      rawPixels[i + 1] = ((i >> 2) * 29) & 0xff;
      rawPixels[i + 2] = ((i >> 5) * 47) & 0xff;
    }
    const largePng = await sharp(rawPixels, {
      raw: { width: 2400, height: 1600, channels: 3 },
    })
      .png()
      .toBuffer();

    const largeUploadRes = await isolatedApp.inject({
      method: 'POST',
      url: '/api/uploads/image',
      headers: authHeaders,
      payload: { dataUrl: `data:image/png;base64,${largePng.toString('base64')}` },
    });
    assert.equal(largeUploadRes.statusCode, 200);
    const largeUrl = largeUploadRes.json().url as string;
    assert.match(largeUrl, /^\/api\/uploads\/[a-f0-9]{24}\.webp$/);

    const largeFetched = await isolatedApp.inject({ method: 'GET', url: largeUrl });
    assert.equal(largeFetched.statusCode, 200);
    assert.equal(largeFetched.headers['content-type'], 'image/webp');
    assert.ok(largeFetched.rawPayload.length < largePng.length);
    const webpMeta = await sharp(largeFetched.rawPayload).metadata();
    assert.equal(webpMeta.format, 'webp');
    assert.ok((webpMeta.width ?? 0) <= 1600);
    assert.ok((webpMeta.height ?? 0) <= 1600);

    // Reject path traversal / invalid filenames
    const badFileRes = await isolatedApp.inject({
      method: 'GET',
      url: '/api/uploads/bad..name.png',
    });
    assert.equal(badFileRes.statusCode, 400);

    // 2. Quarter-grid overlap rejection (0.75) vs acceptance (1.25)
    const badOverlapPut = await isolatedApp.inject({
      method: 'PUT',
      url: '/api/canvas',
      headers: authHeaders,
      payload: {
        folders: [],
        items: [
          {
            id: 'i1',
            title: 'A',
            url: 'https://a.example',
            parentId: null,
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            order: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'i2',
            title: 'B',
            url: 'https://b.example',
            parentId: null,
            x: 0.75,
            y: 0,
            w: 1,
            h: 1,
            order: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    });
    assert.equal(badOverlapPut.statusCode, 409);

    // 3. Persist zones (1 public, 1 private), quarter-grid items/folders, and 3 widget types
    const v4Payload = {
      folders: [
        {
          id: 'pub-folder',
          title: '公开目录',
          x: 0,
          y: 0,
          w: 2,
          h: 2,
          displayMode: 'grid',
          isPrivate: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'zone-folder',
          title: '私密区内的目录',
          x: 10,
          y: 10,
          w: 2,
          h: 2,
          displayMode: 'grid',
          isPrivate: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      items: [
        {
          id: 'pub-item',
          title: 'Quarter Bookmark',
          url: 'https://quarter.example',
          parentId: null,
          x: 2.25,
          y: 0,
          w: 1,
          h: 1,
          order: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'zone-child-item',
          title: 'Hidden Child',
          url: 'https://secret-child.example',
          parentId: 'zone-folder',
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          order: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'zone-top-item',
          title: 'Secret Top Item',
          url: 'https://secret-top.example',
          parentId: null,
          x: 12.25,
          y: 10,
          w: 1,
          h: 1,
          order: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
      zones: [
        {
          id: 'pub-zone',
          title: '工作分区',
          x: -0.25,
          y: -0.25,
          w: 4,
          h: 3,
          isPrivate: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'priv-zone',
          title: '隐藏私密区',
          x: 9.5,
          y: 9.5,
          w: 6,
          h: 5,
          isPrivate: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
      widgets: [
        {
          id: 'w-carousel',
          kind: 'carousel',
          title: 'Gallery',
          images: [{ id: 'img-1', url: uploadedUrl, caption: 'Shot' }],
          intervalSec: 3,
          transition: 'slide',
          fit: 'cover',
          x: 0,
          y: 3.25,
          w: 3,
          h: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'w-text',
          kind: 'text',
          text: 'Section Heading',
          fontSize: 28,
          weight: 'bold',
          align: 'left',
          x: -0.25,
          y: -1.25,
          w: 3,
          h: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'w-note-pub',
          kind: 'note',
          title: 'Public Memo',
          content: 'Hello world',
          tint: '#fef3c7',
          isPrivate: false,
          x: 3.5,
          y: 0,
          w: 2,
          h: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'w-note-priv',
          kind: 'note',
          title: 'Secret Memo',
          content: 'API secret',
          isPrivate: true,
          x: 6,
          y: 0,
          w: 2,
          h: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'w-text-in-priv-zone',
          kind: 'text',
          text: 'Secret Zone Label',
          fontSize: 20,
          weight: 'bold',
          align: 'left',
          x: 10,
          y: 12.5,
          w: 3,
          h: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };

    const putRes = await isolatedApp.inject({
      method: 'PUT',
      url: '/api/canvas',
      headers: authHeaders,
      payload: v4Payload,
    });
    assert.equal(putRes.statusCode, 200);

    // 4. Unauthenticated GET /api/canvas strips private zone + everything inside it + private note, keeping public entities intact
    const pubCanvasRes = await isolatedApp.inject({ method: 'GET', url: '/api/canvas' });
    assert.equal(pubCanvasRes.statusCode, 200);
    const pub = pubCanvasRes.json();
    assert.equal(pub.unlocked, false);
    assert.equal(pub.hasPrivateHidden, true);
    assert.deepEqual(
      pub.zones.map((z: { id: string }) => z.id),
      ['pub-zone']
    );
    assert.deepEqual(
      pub.folders.map((f: { id: string }) => f.id),
      ['pub-folder']
    );
    assert.deepEqual(
      pub.items.map((i: { id: string }) => i.id),
      ['pub-item']
    );
    assert.equal(pub.items[0].x, 2.25);
    assert.deepEqual(
      pub.widgets.map((w: { id: string }) => w.id).sort(),
      ['w-carousel', 'w-note-pub', 'w-text']
    );

    // 5. Authenticated GET /api/canvas returns everything; unauthenticated note/canvas edit returns 401
    const privCanvasRes = await isolatedApp.inject({
      method: 'GET',
      url: '/api/canvas',
      headers: authHeaders,
    });
    assert.equal(privCanvasRes.statusCode, 200);
    assert.equal(privCanvasRes.json().zones.length, 2);
    assert.equal(privCanvasRes.json().widgets.length, 5);
    assert.equal(privCanvasRes.json().items.length, 3);

    const unauthNoteEdit = await isolatedApp.inject({
      method: 'PUT',
      url: '/api/canvas',
      payload: v4Payload,
    });
    assert.equal(unauthNoteEdit.statusCode, 401);

    // 6. Legacy non-quarter/sub-1 zone sizes migrate smoothly on normalizeDocument, while PUT accepts 0.25 steps and rejects 3.3 with 409
    const migrated = normalizeDocument({
      version: 2,
      updatedAt: now,
      grid: { cellSize: 108, gap: 14 },
      folders: [],
      items: [],
      zones: [
        {
          id: 'legacy-dec-zone',
          title: '旧版非0.25小数分区',
          x: 0.25,
          y: -0.25,
          w: 3.33,
          h: 8.5,
          isPrivate: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'tiny-zone',
          title: '极小分区',
          x: 0,
          y: 0,
          w: 0.5,
          h: 1.2,
          isPrivate: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      widgets: [],
    });
    assert.ok(migrated);
    assert.equal(migrated.migrated, true);
    assert.equal(migrated.doc.zones?.[0].w, 3.25);
    assert.equal(migrated.doc.zones?.[0].h, 8.5);
    assert.equal(migrated.doc.zones?.[1].w, 1);
    assert.equal(migrated.doc.zones?.[1].h, 1.25);

    const quarterZonePut = await isolatedApp.inject({
      method: 'PUT',
      url: '/api/canvas',
      headers: authHeaders,
      payload: {
        folders: [],
        items: [],
        zones: [
          {
            id: 'ok-quarter-zone',
            title: 'Quarter Zone',
            x: 0,
            y: 0,
            w: 3.5,
            h: 8.5,
            isPrivate: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    });
    assert.equal(quarterZonePut.statusCode, 200);

    const badDecimalZonePut = await isolatedApp.inject({
      method: 'PUT',
      url: '/api/canvas',
      headers: authHeaders,
      payload: {
        folders: [],
        items: [],
        zones: [
          {
            id: 'bad-dec-zone',
            title: 'Bad',
            x: 0,
            y: 0,
            w: 3.3,
            h: 2,
            isPrivate: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    });
    assert.equal(badDecimalZonePut.statusCode, 409);

    // 7. Orphaned uploads GC keeps canvas + settings + history refs and prunes unreferenced uploads
    const makePng = (r: number, g: number, b: number) =>
      sharp({ create: { width: 2, height: 2, channels: 3, background: { r, g, b } } })
        .png()
        .toBuffer();

    const [bgBuf, orphanBuf, histOnlyBuf] = await Promise.all([
      makePng(10, 20, 30),
      makePng(110, 120, 130),
      makePng(210, 220, 230),
    ]);
    const uploadBuf = async (buf: Buffer) => {
      const res = await isolatedApp.inject({
        method: 'POST',
        url: '/api/uploads/image',
        headers: authHeaders,
        payload: { dataUrl: `data:image/png;base64,${buf.toString('base64')}` },
      });
      assert.equal(res.statusCode, 200);
      return res.json().url as string;
    };

    const settingsBgUrl = await uploadBuf(bgBuf);
    const orphanUrl = await uploadBuf(orphanBuf);
    const histOnlyUrl = await uploadBuf(histOnlyBuf);

    // Reference settingsBgUrl in settings.json and histOnlyUrl only in a saved history snapshot
    const bgSettingsRes = await isolatedApp.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: authHeaders,
      payload: { canvasBgStyle: 'wallpaper', customBgUrl: `https://example.com${settingsBgUrl}` },
    });
    assert.equal(bgSettingsRes.statusCode, 200);

    const histCanvasRes = await isolatedApp.inject({
      method: 'PUT',
      url: '/api/canvas',
      headers: authHeaders,
      payload: {
        folders: [],
        items: [],
        zones: [],
        widgets: [
          {
            id: 'w-hist-carousel',
            kind: 'carousel',
            images: [{ id: 'hi-1', url: histOnlyUrl }],
            intervalSec: 3,
            transition: 'slide',
            fit: 'cover',
            x: 0,
            y: 0,
            w: 2,
            h: 2,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    });
    assert.equal(histCanvasRes.statusCode, 200);

    // Snapshot into history and overwrite canvas without histOnlyUrl (keeping uploadedUrl)
    const snapRes = await isolatedApp.inject({
      method: 'POST',
      url: '/api/history',
      headers: authHeaders,
      payload: { label: 'keep-hist-img' },
    });
    assert.equal(snapRes.statusCode, 200);
    const restoreV4Res = await isolatedApp.inject({
      method: 'PUT',
      url: '/api/canvas',
      headers: authHeaders,
      payload: v4Payload,
    });
    assert.equal(restoreV4Res.statusCode, 200);

    const gcRes = await pruneOrphanedUploads(isolatedDir, 0);
    const orphanName = orphanUrl.split('/').pop()!;
    const canvasRefName = uploadedUrl.split('/').pop()!;
    const bgRefName = settingsBgUrl.split('/').pop()!;
    const histRefName = histOnlyUrl.split('/').pop()!;

    assert.ok(gcRes.removed.includes(orphanName));
    assert.ok(!gcRes.removed.includes(canvasRefName));
    assert.ok(!gcRes.removed.includes(bgRefName));
    assert.ok(!gcRes.removed.includes(histRefName));

    assert.equal((await isolatedApp.inject({ method: 'GET', url: orphanUrl })).statusCode, 404);
    assert.equal((await isolatedApp.inject({ method: 'GET', url: uploadedUrl })).statusCode, 200);
    assert.equal((await isolatedApp.inject({ method: 'GET', url: settingsBgUrl })).statusCode, 200);
    assert.equal((await isolatedApp.inject({ method: 'GET', url: histOnlyUrl })).statusCode, 200);
  } finally {
    await isolatedApp.close();
    await fs.rm(isolatedDir, { recursive: true, force: true });
  }
});

test('backup export bundles referenced uploads and import restores exact bytes to a fresh instance', async () => {
  const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'neko-backup-a-'));
  const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'neko-backup-b-'));
  const appA = await buildApp({ dataDir: dirA, password: 'pwA', serveStatic: false });
  const appB = await buildApp({ dataDir: dirB, password: 'pwB', serveStatic: false });
  const now = new Date().toISOString();

  try {
    const unlockA = await appA.inject({
      method: 'POST',
      url: '/api/auth/unlock',
      payload: { password: 'pwA' },
    });
    assert.equal(unlockA.statusCode, 200);
    const cookieA = unlockA.headers['set-cookie'] as string;

    const unlockB = await appB.inject({
      method: 'POST',
      url: '/api/auth/unlock',
      payload: { password: 'pwB' },
    });
    assert.equal(unlockB.statusCode, 200);
    const cookieB = unlockB.headers['set-cookie'] as string;

    const pngBuf = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 85, b: 0 } },
    })
      .png()
      .toBuffer();
    const uploadRes = await appA.inject({
      method: 'POST',
      url: '/api/uploads/image',
      headers: { cookie: cookieA },
      payload: { dataUrl: `data:image/png;base64,${pngBuf.toString('base64')}` },
    });
    assert.equal(uploadRes.statusCode, 200);
    const uploadedUrl = uploadRes.json().url as string;
    const filename = uploadedUrl.split('/').pop()!;

    const putRes = await appA.inject({
      method: 'PUT',
      url: '/api/canvas',
      headers: { cookie: cookieA },
      payload: {
        folders: [],
        items: [],
        zones: [],
        widgets: [
          {
            id: 'carousel-backup-1',
            kind: 'carousel',
            title: 'Backup Carousel',
            images: [{ id: 'img-1', url: uploadedUrl }],
            intervalSec: 4,
            transition: 'fade',
            fit: 'cover',
            x: 0,
            y: 0,
            w: 2,
            h: 2,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    });
    assert.equal(putRes.statusCode, 200);

    const bytesResA = await appA.inject({ method: 'GET', url: uploadedUrl });
    assert.equal(bytesResA.statusCode, 200);

    const exportRes = await appA.inject({
      method: 'GET',
      url: '/api/backup/export',
      headers: { cookie: cookieA },
    });
    assert.equal(exportRes.statusCode, 200);
    const exportedJson = exportRes.json() as {
      canvas: unknown;
      settings: unknown;
      uploads?: Record<string, string>;
    };
    assert.ok(exportedJson.uploads && typeof exportedJson.uploads[filename] === 'string');

    // Fresh instance B does not have the upload yet
    assert.equal((await appB.inject({ method: 'GET', url: uploadedUrl })).statusCode, 404);

    // Import into instance B and verify exact file bytes are served
    const importRes = await appB.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: { cookie: cookieB },
      payload: exportedJson,
    });
    assert.equal(importRes.statusCode, 200);

    const bytesResB = await appB.inject({ method: 'GET', url: uploadedUrl });
    assert.equal(bytesResB.statusCode, 200);
    assert.equal(Buffer.compare(bytesResA.rawPayload, bytesResB.rawPayload), 0);
  } finally {
    await appA.close();
    await appB.close();
    await fs.rm(dirA, { recursive: true, force: true });
    await fs.rm(dirB, { recursive: true, force: true });
  }
});

test('defaultTheme defaults to system and boot HTML injects data-default-theme + auto anti-flash script', async () => {
  assert.equal(DEFAULT_SITE_SETTINGS.defaultTheme, 'system');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neko-boot-theme-'));
  const bootApp = await buildApp({ dataDir: dir, password: 'pw', serveStatic: true });
  try {
    const res = await bootApp.inject({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200);
    const html = res.body;
    assert.ok(html.includes('data-default-theme="system"'));
    assert.ok(html.includes("getAttribute('data-default-theme')"));
    assert.ok(html.includes("t === 'auto'"));
    assert.ok(html.includes('(prefers-color-scheme: dark)'));

    const unlockRes = await bootApp.inject({
      method: 'POST',
      url: '/api/auth/unlock',
      payload: { password: 'pw' },
    });
    assert.equal(unlockRes.statusCode, 200);
    const cookie = unlockRes.headers['set-cookie'] as string;

    const putSettings = await bootApp.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { defaultTheme: 'dark' },
    });
    assert.equal(putSettings.statusCode, 200);

    const resDark = await bootApp.inject({ method: 'GET', url: '/' });
    assert.equal(resDark.statusCode, 200);
    assert.ok(resDark.body.includes('data-default-theme="dark"'));
  } finally {
    await bootApp.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
