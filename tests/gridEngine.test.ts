import test from 'node:test';
import assert from 'node:assert/strict';
import type { GridEntity } from '../shared/gridEngine.js';
import {
  clampZoneSize,
  findNearestFreeSlot,
  isEntityInsideZone,
  isValidZoneSize,
  solveMove,
  solveMoveZoneGroup,
  solvePlaceExternalItem,
  solveResize,
  validateCanvasDocument,
  validateEntities,
  validateNoOverlaps,
} from '../shared/gridEngine.js';
import type { CanvasDocument } from '../shared/types.js';
import {
  buildSyncedPublicLayoutFromCanonical,
  mergeLockedLayoutEdit,
  normalizePublicLayout,
  projectPublicCanvas,
  reconcilePublicLayout,
} from '../shared/dualLayout.js';

function makeEntity(id: string, x: number, y: number, w = 1, h = 1): GridEntity {
  return { id, x, y, w, h };
}

function findEntity(entities: readonly GridEntity[], id: string): GridEntity {
  const n = entities.find((item) => item.id === id);
  assert.ok(n, `Expected entity ${id} to exist`);
  return n;
}

test('solveResize: resizes freely when no neighbor overlaps', () => {
  const entities = [makeEntity('a', 0, 0, 1, 1), makeEntity('b', 4, 0, 1, 1)];
  const res = solveResize(entities, 'a', 2, 2);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.movedIds, []);
  assert.equal(findEntity(res.entities, 'a').w, 2);
  assert.equal(findEntity(res.entities, 'a').h, 2);
  assert.equal(validateNoOverlaps(res.entities).valid, true);
});

test('solveResize: pushes neighbor in expansion direction when space is available', () => {
  const entities = [makeEntity('a', 0, 0, 1, 1), makeEntity('b', 1, 0, 1, 1)];
  const res = solveResize(entities, 'a', 2, 1);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.movedIds, ['b']);
  assert.equal(findEntity(res.entities, 'a').w, 2);
  assert.equal(findEntity(res.entities, 'b').x, 2);
  assert.equal(findEntity(res.entities, 'b').y, 0);
  assert.equal(validateNoOverlaps(res.entities).valid, true);
});

test('solveResize: pushes neighbor downward if rightward slot is blocked', () => {
  const entities = [
    makeEntity('a', 0, 0, 1, 1),
    makeEntity('b', 1, 0, 1, 1),
    makeEntity('wall', 2, 0, 1, 1),
  ];
  const res = solveResize(entities, 'a', 2, 1);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.movedIds, ['b']);
  const b = findEntity(res.entities, 'b');
  assert.equal(b.x, 1);
  assert.ok(b.y === 1 || b.y === -1);
  assert.equal(validateNoOverlaps(res.entities).valid, true);
});

test('solveResize: returns surrounded failure and pushes ZERO neighbors when boxed in on all 4 sides', () => {
  const entities = [
    makeEntity('a', 0, 0, 1, 1),
    makeEntity('b', 1, 0, 1, 1),
    makeEntity('right-wall', 2, 0, 1, 1),
    makeEntity('down-wall', 1, 1, 1, 1),
    makeEntity('up-wall', 1, -1, 1, 1),
    makeEntity('left-wall', -1, 0, 1, 1),
  ];
  const snapshot = JSON.stringify(entities);
  const res = solveResize(entities, 'a', 2, 1);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'surrounded');
  assert.equal(JSON.stringify(entities), snapshot);
});

test('solveResize: rejects out-of-range dimensions', () => {
  const entities = [makeEntity('a', 0, 0, 1, 1)];
  assert.equal(solveResize(entities, 'a', 0, 1).ok, false);
  assert.equal(solveResize(entities, 'a', 7, 1).ok, false);
});

test('solveMove: moves single entity to empty negative coordinates', () => {
  const entities = [makeEntity('a', 0, 0, 1, 1)];
  const res = solveMove(entities, ['a'], -3, -2);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.mode, 'direct');
  assert.equal(findEntity(res.entities, 'a').x, -3);
  assert.equal(findEntity(res.entities, 'a').y, -2);
});

test('solveMove: 1x1 <-> 1x1 swap', () => {
  const entities = [makeEntity('a', 0, 0, 1, 1), makeEntity('b', 2, 1, 1, 1)];
  const res = solveMove(entities, ['a'], 2, 1);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.mode, 'swap_rigid');
  assert.equal(findEntity(res.entities, 'a').x, 2);
  assert.equal(findEntity(res.entities, 'a').y, 1);
  assert.equal(findEntity(res.entities, 'b').x, 0);
  assert.equal(findEntity(res.entities, 'b').y, 0);
  assert.equal(validateNoOverlaps(res.entities).valid, true);
});

test('solveMove: 2x1 <-> two adjacent 1x1s in BOTH directions', () => {
  const entities = [
    makeEntity('wide', 0, 0, 2, 1),
    makeEntity('s1', 3, 2, 1, 1),
    makeEntity('s2', 4, 2, 1, 1),
  ];

  const fwd = solveMove(entities, ['wide'], 3, 2);
  assert.equal(fwd.ok, true);
  if (!fwd.ok) return;
  assert.equal(findEntity(fwd.entities, 'wide').x, 3);
  assert.equal(findEntity(fwd.entities, 'wide').y, 2);
  assert.equal(findEntity(fwd.entities, 's1').x, 0);
  assert.equal(findEntity(fwd.entities, 's2').x, 1);
  assert.equal(validateNoOverlaps(fwd.entities).valid, true);

  const rev = solveMove(fwd.entities, ['s1', 's2'], 3, 2);
  assert.equal(rev.ok, true);
  if (!rev.ok) return;
  assert.equal(findEntity(rev.entities, 'wide').x, 0);
  assert.equal(findEntity(rev.entities, 's1').x, 3);
  assert.equal(findEntity(rev.entities, 's2').x, 4);
  assert.equal(validateNoOverlaps(rev.entities).valid, true);
});

test('solveMove: 2x2 <-> mixed smaller items swap', () => {
  const entities = [
    makeEntity('big', 0, 0, 2, 2),
    makeEntity('top', 4, 0, 2, 1),
    makeEntity('bl', 4, 1, 1, 1),
    makeEntity('br', 5, 1, 1, 1),
  ];
  const res = solveMove(entities, ['big'], 4, 0);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(findEntity(res.entities, 'big').x, 4);
  assert.equal(findEntity(res.entities, 'top').x, 0);
  assert.equal(findEntity(res.entities, 'bl').x, 0);
  assert.equal(findEntity(res.entities, 'br').x, 1);
  assert.equal(validateNoOverlaps(res.entities).valid, true);
});

test('solveMove: adjacent 1-cell overlapping slide swap via vacated-cell packing', () => {
  const entities = [makeEntity('wide', 0, 0, 2, 1), makeEntity('small', 2, 0, 1, 1)];
  const res = solveMove(entities, ['wide'], 1, 0);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.mode, 'swap_vacated');
  assert.equal(findEntity(res.entities, 'wide').x, 1);
  assert.equal(findEntity(res.entities, 'small').x, 0);
  assert.equal(validateNoOverlaps(res.entities).valid, true);
});

test('solveMove: Territory Union Partition slides 2x1 right when 1x1 at (2,0) moves onto (0,0) even with wall at (3,0)', () => {
  const entities = [
    makeEntity('wide', 0, 0, 2, 1),
    makeEntity('small', 2, 0, 1, 1),
    makeEntity('wall', 3, 0, 1, 1),
  ];
  const res = solveMove(entities, ['small'], -2, 0);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.mode, 'swap_vacated');
  assert.equal(findEntity(res.entities, 'small').x, 0);
  assert.equal(findEntity(res.entities, 'wide').x, 1);
  assert.equal(findEntity(res.entities, 'wall').x, 3);
  assert.equal(validateNoOverlaps(res.entities).valid, true);
});

test('solveMove: blocks invalid cross-boundary overlap when destination cannot swap', () => {
  const entities = [
    makeEntity('a', 0, 0, 1, 1),
    makeEntity('w1', 1, 0, 1, 1),
    makeEntity('w2', 0, 1, 1, 1),
    makeEntity('w3', 1, 1, 1, 1),
    makeEntity('big', 3, 0, 2, 2),
  ];
  const res = solveMove(entities, ['a'], 3, 0);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'blocked');
});

test('solveMove: batch-moves multiple selected entities preserving relative offsets', () => {
  const entities = [
    makeEntity('a', 0, 0, 1, 1),
    makeEntity('b', 1, 1, 1, 1),
    makeEntity('c', 5, 5, 1, 1),
  ];
  const res = solveMove(entities, ['a', 'b'], -2, 3);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(findEntity(res.entities, 'a').x, -2);
  assert.equal(findEntity(res.entities, 'a').y, 3);
  assert.equal(findEntity(res.entities, 'b').x, -1);
  assert.equal(findEntity(res.entities, 'b').y, 4);
  assert.equal(findEntity(res.entities, 'c').x, 5);
  assert.equal(validateNoOverlaps(res.entities).valid, true);
});

test('solvePlaceExternalItem: places directly on empty slot', () => {
  const entities = [makeEntity('a', 0, 0, 1, 1)];
  const res = solvePlaceExternalItem(entities, makeEntity('ext', 2, 0, 1, 1));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.movedIds, []);
  assert.equal(findEntity(res.entities, 'ext').x, 2);
  assert.equal(validateNoOverlaps(res.entities).valid, true);
});

test('solvePlaceExternalItem: pushes occupied neighbor orthogonally into open slot', () => {
  const entities = [makeEntity('occupant', 0, 0, 1, 1)];
  const res = solvePlaceExternalItem(entities, makeEntity('ext', 0, 0, 1, 1));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.movedIds, ['occupant']);
  assert.equal(findEntity(res.entities, 'ext').x, 0);
  assert.equal(findEntity(res.entities, 'ext').y, 0);
  const occ = findEntity(res.entities, 'occupant');
  assert.equal(Math.abs(occ.x) + Math.abs(occ.y), 1);
  assert.equal(validateNoOverlaps(res.entities).valid, true);
});

test('solvePlaceExternalItem: rejects surrounded drop and pushes ZERO neighbors', () => {
  const entities = [
    makeEntity('center', 0, 0, 1, 1),
    makeEntity('r', 1, 0, 1, 1),
    makeEntity('l', -1, 0, 1, 1),
    makeEntity('d', 0, 1, 1, 1),
    makeEntity('u', 0, -1, 1, 1),
  ];
  const snapshot = JSON.stringify(entities);
  const res = solvePlaceExternalItem(entities, makeEntity('ext', 0, 0, 1, 1));
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'surrounded');
  assert.equal(JSON.stringify(entities), snapshot);
});

test('findNearestFreeSlot: spirals outward to avoid occupied cells', () => {
  const entities = [makeEntity('center', 0, 0, 1, 1)];
  const slot = findNearestFreeSlot(entities, 1, 1, 0, 0);
  assert.ok(Math.abs(slot.x) <= 1 && Math.abs(slot.y) <= 1);
  assert.ok(!(slot.x === 0 && slot.y === 0));
});

test('v4 quarter-grid: accepts 0.25 aligned non-overlapping coords and rejects 0.75 overlap', () => {
  assert.equal(validateEntities([makeEntity('a', 0, 0, 1, 1), makeEntity('b', 1.25, 0, 1, 1)]).valid, true);
  assert.equal(validateEntities([makeEntity('a', 0, 0, 1, 1), makeEntity('b', 0.75, 0, 1, 1)]).valid, false);
  assert.equal(validateEntities([makeEntity('a', 0.1, 0, 1, 1)]).valid, false);
});

test('v4 solveMove: 0.25 edge-clamping ("贴边防重叠") and axis sliding', () => {
  // Moving right into obstacle at x=1.5 by dx=0.75 clamps flush at x=0.5
  const entities = [makeEntity('a', 0, 0, 1, 1), makeEntity('b', 1.5, 0, 1, 1)];
  const clamped = solveMove(entities, ['a'], 0.75, 0);
  assert.equal(clamped.ok, true);
  if (!clamped.ok) return;
  assert.equal(clamped.mode, 'direct');
  assert.equal(findEntity(clamped.entities, 'a').x, 0.5);
  assert.equal(validateNoOverlaps(clamped.entities).valid, true);

  // Moving diagonally into tall wall at x=1..2, y=0..2 slides cleanly along Y to (0, 1.25)
  const tallWall = [makeEntity('a', 0, 0, 1, 1), makeEntity('wall', 1, 0, 1, 2)];
  const slide = solveMove(tallWall, ['a'], 0.25, 1.25);
  assert.equal(slide.ok, true);
  if (!slide.ok) return;
  assert.equal(findEntity(slide.entities, 'a').x, 0);
  assert.equal(findEntity(slide.entities, 'a').y, 1.25);
});

test('v4 solveMoveZoneGroup: clamps zone group cleanly against external cards', () => {
  const zone = { x: -0.25, y: -0.25, w: 1.5, h: 1.5 };
  const inside = makeEntity('in-card', 0, 0, 1, 1);
  const outside = makeEntity('ext-card', 1.5, 0, 1, 1);
  assert.equal(isEntityInsideZone(inside, zone), true);
  assert.equal(isEntityInsideZone(outside, zone), false);

  const res = solveMoveZoneGroup([inside, outside], ['in-card'], 1, 0);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.dx, 0.5);
  assert.equal(findEntity(res.entities, 'in-card').x, 0.5);
  assert.equal(findEntity(res.entities, 'ext-card').x, 1.5);
  assert.equal(validateNoOverlaps(res.entities).valid, true);
});

test('v4 zones: isValidZoneSize accepts 0.25-step sizes 1..40 (3x1, 3.5, 8.5), rejects non-quarter decimals, allows 0.25 x/y', () => {
  assert.equal(isValidZoneSize(1), true);
  assert.equal(isValidZoneSize(2.25), true);
  assert.equal(isValidZoneSize(3), true);
  assert.equal(isValidZoneSize(3.5), true);
  assert.equal(isValidZoneSize(8.5), true);
  assert.equal(isValidZoneSize(40), true);
  assert.equal(isValidZoneSize(3.3), false);
  assert.equal(isValidZoneSize(0.75), false);
  assert.equal(isValidZoneSize(0), false);
  assert.equal(isValidZoneSize(41), false);
  assert.equal(clampZoneSize(3.33), 3.25);
  assert.equal(clampZoneSize(8.5), 8.5);
  assert.equal(clampZoneSize(0.25), 1);

  const now = new Date().toISOString();
  const valid3x1 = validateCanvasDocument({
    folders: [],
    items: [],
    zones: [
      {
        id: 'z-row',
        title: '单行分区',
        x: -0.25,
        y: 0.25,
        w: 3,
        h: 1,
        isPrivate: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'z-quarter',
        title: '跨半格分区',
        x: 0,
        y: 2,
        w: 4.5,
        h: 8.5,
        isPrivate: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  assert.equal(valid3x1.valid, true);

  const invalidNonQuarter = validateCanvasDocument({
    folders: [],
    items: [],
    zones: [
      {
        id: 'z-dec',
        title: '非0.25步进分区',
        x: 0,
        y: 0,
        w: 3.3,
        h: 2,
        isPrivate: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  assert.equal(invalidNonQuarter.valid, false);
});

test('dualLayout: projectPublicCanvas, reconcilePublicLayout, and mergeLockedLayoutEdit preserve sync and separate layouts', () => {
  const now = new Date().toISOString();
  const canonical: CanvasDocument = {
    version: 2,
    updatedAt: now,
    grid: { cellSize: 108, gap: 14 },
    folders: [
      {
        id: 'f-pub',
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
        id: 'f-priv',
        title: '私密目录',
        x: 4,
        y: 0,
        w: 2,
        h: 2,
        displayMode: 'grid',
        isPrivate: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    items: [
      {
        id: 'i-pub',
        title: 'Pub Item',
        url: 'https://pub.example',
        parentId: null,
        x: 2,
        y: 0,
        w: 1,
        h: 1,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'i-new-unrecorded',
        title: 'Unrecorded Desktop Item',
        url: 'https://new.example',
        parentId: null,
        x: 5,
        y: 5,
        w: 1,
        h: 1,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'i-priv-child',
        title: 'Private Child',
        url: 'https://secret.example',
        parentId: 'f-priv',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    zones: [
      {
        id: 'z-priv',
        title: '私密区',
        x: 10,
        y: 10,
        w: 4,
        h: 4,
        isPrivate: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    widgets: [
      {
        id: 'w-priv-note',
        kind: 'note',
        title: '私密便签',
        content: 'secret',
        isPrivate: true,
        x: 3,
        y: 2,
        w: 2,
        h: 2,
        createdAt: now,
        updatedAt: now,
      },
    ],
    publicLayout: {
      positions: {
        'f-pub': { x: 5, y: 5, w: 3, h: 2 }, // intentionally covers (5,5) to test collision fallback of i-new-unrecorded
        'i-pub': { x: 0, y: 0, w: 2, h: 1 },
        'f-priv': { x: 99, y: 99, w: 2, h: 2 }, // stale/private key should be ignored & pruned
      },
      viewportOrigin: { x: 120, y: -40 },
    },
  };

  // 1. projectPublicCanvas applies independent (x, y, w, h) & strips raw publicLayout + avoids overlaps
  const projected = projectPublicCanvas(canonical);
  assert.equal(projected.hasPrivateHidden, true);
  assert.deepEqual(projected.publicViewportOrigin, { x: 120, y: -40 });
  assert.equal('publicLayout' in projected.doc, false);
  assert.equal(validateCanvasDocument(projected.doc).valid, true);

  const projFolder = projected.doc.folders.find((f) => f.id === 'f-pub')!;
  assert.deepEqual({ x: projFolder.x, y: projFolder.y, w: projFolder.w, h: projFolder.h }, { x: 5, y: 5, w: 3, h: 2 });
  const projItem = projected.doc.items.find((i) => i.id === 'i-pub')!;
  assert.deepEqual({ x: projItem.x, y: projItem.y, w: projItem.w, h: projItem.h }, { x: 0, y: 0, w: 2, h: 1 });

  // i-new-unrecorded wanted (5,5) which f-pub occupies in locked view -> relocated without overlap
  const relocatedNew = projected.doc.items.find((i) => i.id === 'i-new-unrecorded')!;
  assert.ok(relocatedNew.x !== 5 || relocatedNew.y !== 5);

  // 2. reconcilePublicLayout prunes private key and stores relocated slot cleanly
  const reconciled = reconcilePublicLayout(canonical);
  assert.equal(reconciled.publicLayout?.positions['f-priv'], undefined);
  assert.ok(reconciled.publicLayout?.positions['i-new-unrecorded']);

  // 3. mergeLockedLayoutEdit syncs rename/addition/deletion while keeping canonical coords & private items untouched
  const lockedEdited: CanvasDocument = {
    ...projected.doc,
    folders: projected.doc.folders.map((f) =>
      f.id === 'f-pub' ? { ...f, title: '同步改名目录', x: 8, y: 8, w: 2, h: 3 } : f
    ),
    items: [
      ...projected.doc.items
        .filter((i) => i.id !== 'i-new-unrecorded')
        .map((i) => (i.id === 'i-pub' ? { ...i, title: 'Synced Title', url: 'https://synced.example', x: 1, y: 1, w: 2, h: 2 } : i)),
      {
        id: 'i-added-in-locked',
        title: 'Added In Locked',
        url: 'https://added.example',
        parentId: null,
        x: 4, // intentionally collides with f-priv (4,0,2,2) on canonical canvas!
        y: 0,
        w: 1,
        h: 1,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };

  const merged = mergeLockedLayoutEdit(reconciled, lockedEdited);
  assert.equal(validateCanvasDocument(merged).valid, true);
  assert.equal(validateCanvasDocument(projectPublicCanvas(merged).doc).valid, true);

  // Canonical coords for f-pub & i-pub remain unchanged (0,0,2,2) and (2,0,1,1), while title/url synced
  const mergedCanonFolder = merged.folders.find((f) => f.id === 'f-pub')!;
  assert.equal(mergedCanonFolder.title, '同步改名目录');
  assert.deepEqual({ x: mergedCanonFolder.x, y: mergedCanonFolder.y, w: mergedCanonFolder.w, h: mergedCanonFolder.h }, { x: 0, y: 0, w: 2, h: 2 });

  const mergedCanonItem = merged.items.find((i) => i.id === 'i-pub')!;
  assert.equal(mergedCanonItem.title, 'Synced Title');
  assert.equal(mergedCanonItem.url, 'https://synced.example');
  assert.deepEqual({ x: mergedCanonItem.x, y: mergedCanonItem.y, w: mergedCanonItem.w, h: mergedCanonItem.h }, { x: 2, y: 0, w: 1, h: 1 });

  // Private entities remain completely untouched, and i-new-unrecorded deletion synced
  assert.ok(merged.folders.some((f) => f.id === 'f-priv'));
  assert.ok(merged.items.some((i) => i.id === 'i-priv-child'));
  assert.ok((merged.widgets ?? []).some((w) => w.id === 'w-priv-note'));
  assert.equal(merged.items.some((i) => i.id === 'i-new-unrecorded'), false);

  // Added item stays at (4,0) in publicLayout, while canonical side avoids f-priv at (4,0)
  assert.deepEqual(merged.publicLayout?.positions['i-added-in-locked'], { x: 4, y: 0, w: 1, h: 1 });
  const canonAdded = merged.items.find((i) => i.id === 'i-added-in-locked')!;
  assert.ok(canonAdded.x !== 4 || canonAdded.y !== 0);
  // Existing publicLayout.viewportOrigin preserved across merge
  assert.deepEqual(merged.publicLayout?.viewportOrigin, { x: 120, y: -40 });
});

test('dualLayout: independent folder displayMode and independent publicLayout.zones (including empty zones: [])', () => {
  const now = new Date().toISOString();

  // 1. normalizePublicLayout preserves empty zones: [] even when positions & viewportOrigin are empty
  const normalizedEmptyZones = normalizePublicLayout({ positions: {}, zones: [] });
  assert.ok(normalizedEmptyZones);
  assert.deepEqual(normalizedEmptyZones?.zones, []);

  const canonical: CanvasDocument = {
    version: 2,
    updatedAt: now,
    grid: { cellSize: 108, gap: 14 },
    folders: [
      {
        id: 'f-mode',
        title: '双模式目录',
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        displayMode: 'list',
        isPrivate: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'f-in-priv-zone',
        title: '私密分区目录',
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
    items: [],
    zones: [
      {
        id: 'z-unlocked-pub',
        title: '解锁后公开分区',
        x: 0,
        y: 0,
        w: 4,
        h: 3,
        isPrivate: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'z-unlocked-priv',
        title: '解锁后私密分区',
        x: 9,
        y: 9,
        w: 5,
        h: 5,
        isPrivate: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    widgets: [],
  };

  // 2. Edit locked view: switch f-mode to 'grid', delete canonical public zone and create a locked-only zone
  const initLockedProj = projectPublicCanvas(canonical).doc;
  const lockedWithZone = mergeLockedLayoutEdit(canonical, {
    ...initLockedProj,
    folders: initLockedProj.folders.map((f) =>
      f.id === 'f-mode' ? { ...f, displayMode: 'grid' } : f
    ),
    zones: [
      {
        id: 'z-locked-only',
        title: '访客专属分区',
        x: 1,
        y: 1,
        w: 6,
        h: 4,
        isPrivate: true, // should be forced false in publicLayout.zones
        createdAt: now,
        updatedAt: now,
      },
    ],
  });

  // Canonical displayMode remains 'list', canonical zones remain completely untouched
  assert.equal(lockedWithZone.folders.find((f) => f.id === 'f-mode')?.displayMode, 'list');
  assert.deepEqual(
    (lockedWithZone.zones ?? []).map((z) => z.id),
    ['z-unlocked-pub', 'z-unlocked-priv']
  );

  // Projected public view sees 'grid' and ONLY z-locked-only (with isPrivate: false); f-in-priv-zone still filtered by canonical private zone
  const pub1 = projectPublicCanvas(lockedWithZone);
  assert.equal(pub1.doc.folders.length, 1);
  assert.equal(pub1.doc.folders[0].displayMode, 'grid');
  assert.deepEqual(
    (pub1.doc.zones ?? []).map((z) => ({ id: z.id, title: z.title, isPrivate: z.isPrivate })),
    [{ id: 'z-locked-only', title: '访客专属分区', isPrivate: false }]
  );

  // 3. Editing canonical zones afterward does NOT overwrite customized publicLayout.zones
  const unlockedZoneEdited = reconcilePublicLayout({
    ...lockedWithZone,
    zones: (lockedWithZone.zones ?? []).map((z) =>
      z.id === 'z-unlocked-pub' ? { ...z, title: '解锁后改名分区' } : z
    ),
  });
  const pub2 = projectPublicCanvas(unlockedZoneEdited);
  assert.deepEqual(
    (pub2.doc.zones ?? []).map((z) => z.id),
    ['z-locked-only']
  );

  // 4. Deleting all zones in locked layout persists zones: [] and does NOT fall back to canonical zones
  const lockedClearedZones = mergeLockedLayoutEdit(unlockedZoneEdited, {
    ...pub2.doc,
    zones: [],
  });
  assert.deepEqual(lockedClearedZones.publicLayout?.zones, []);
  assert.equal((unlockedZoneEdited.zones ?? []).length, 2);
  assert.equal((projectPublicCanvas(lockedClearedZones).doc.zones ?? []).length, 0);

  // 5. buildSyncedPublicLayoutFromCanonical copies displayMode and canonical public zones (excluding private zone)
  const syncedPl = buildSyncedPublicLayoutFromCanonical(unlockedZoneEdited);
  assert.equal(syncedPl.positions['f-mode']?.displayMode, 'list');
  assert.deepEqual(
    (syncedPl.zones ?? []).map((z) => ({ id: z.id, title: z.title })),
    [{ id: 'z-unlocked-pub', title: '解锁后改名分区' }]
  );
});
