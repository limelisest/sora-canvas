import type {
  BookmarkItem,
  CanvasDocument,
  FolderContainer,
  SiteSettings,
} from '../../shared/types';
import { findNearestFreeSlot, getTopLevelEntities } from '../../shared/gridEngine';

export interface ParsedBookmarkImport {
  doc: CanvasDocument;
  importedFolders: number;
  importedItems: number;
}

function collectLinksInDl(dl: Element): Array<{ title: string; url: string }> {
  const links: Array<{ title: string; url: string }> = [];
  for (const child of Array.from(dl.children)) {
    const tag = child.tagName.toUpperCase();
    if (tag === 'DT') {
      const a = Array.from(child.children).find((el) => el.tagName.toUpperCase() === 'A');
      if (a) {
        const href = a.getAttribute('href') || '';
        const title = (a.textContent || '').trim() || href;
        if (/^https?:\/\//i.test(href)) {
          links.push({ title, url: href });
        }
      }
      const nestedDl = Array.from(child.children).find((el) => el.tagName.toUpperCase() === 'DL');
      if (nestedDl) {
        links.push(...collectLinksInDl(nestedDl));
      }
    } else if (tag === 'DL') {
      links.push(...collectLinksInDl(child));
    }
  }
  return links;
}

export function importNetscapeBookmarksHtml(
  html: string,
  currentDoc: CanvasDocument,
  settings: SiteSettings
): ParsedBookmarkImport {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, 'text/html');
  const rootDl = parsed.querySelector('dl');
  if (!rootDl) {
    throw new Error('未识别到有效的 Netscape 书签 HTML (<DL>) 结构');
  }

  const now = new Date().toISOString();
  const nextFolders = [...currentDoc.folders];
  const nextItems = [...currentDoc.items];
  const occupied = getTopLevelEntities(currentDoc).map((e) => ({
    x: e.x,
    y: e.y,
    w: e.w,
    h: e.h,
  }));

  const rootLinks: Array<{ title: string; url: string }> = [];
  const folderGroups: Array<{ title: string; links: Array<{ title: string; url: string }> }> = [];

  function walkTopDl(dl: Element) {
    for (const child of Array.from(dl.children)) {
      const tag = child.tagName.toUpperCase();
      if (tag !== 'DT') {
        if (tag === 'DL') walkTopDl(child);
        continue;
      }
      const h3 = Array.from(child.children).find((el) => el.tagName.toUpperCase() === 'H3');
      const subDl = Array.from(child.children).find((el) => el.tagName.toUpperCase() === 'DL');
      const a = Array.from(child.children).find((el) => el.tagName.toUpperCase() === 'A');

      if (h3 && subDl) {
        const folderTitle = (h3.textContent || '').trim() || '导入文件夹';
        // Check if subDl contains sub-folders vs direct links
        const directLinks: Array<{ title: string; url: string }> = [];
        const nestedSubDls: Array<{ title: string; dl: Element }> = [];

        for (const subChild of Array.from(subDl.children)) {
          if (subChild.tagName.toUpperCase() === 'DT') {
            const subH3 = Array.from(subChild.children).find(
              (el) => el.tagName.toUpperCase() === 'H3'
            );
            const subNestedDl = Array.from(subChild.children).find(
              (el) => el.tagName.toUpperCase() === 'DL'
            );
            const subA = Array.from(subChild.children).find(
              (el) => el.tagName.toUpperCase() === 'A'
            );
            if (subH3 && subNestedDl) {
              nestedSubDls.push({
                title: (subH3.textContent || '').trim() || folderTitle,
                dl: subNestedDl,
              });
            } else if (subA) {
              const href = subA.getAttribute('href') || '';
              if (/^https?:\/\//i.test(href)) {
                directLinks.push({
                  title: (subA.textContent || '').trim() || href,
                  url: href,
                });
              }
            }
          }
        }

        if (directLinks.length > 0) {
          folderGroups.push({ title: folderTitle, links: directLinks });
        }
        for (const nested of nestedSubDls) {
          const nestedLinks = collectLinksInDl(nested.dl);
          if (nestedLinks.length > 0) {
            folderGroups.push({
              title: `${folderTitle} · ${nested.title}`,
              links: nestedLinks,
            });
          }
        }
      } else if (a) {
        const href = a.getAttribute('href') || '';
        if (/^https?:\/\//i.test(href)) {
          rootLinks.push({
            title: (a.textContent || '').trim() || href,
            url: href,
          });
        }
      }
    }
  }

  walkTopDl(rootDl);

  let importedFolders = 0;
  let importedItems = 0;

  for (const group of folderGroups) {
    const slot = findNearestFreeSlot(
      occupied,
      settings.defaultFolderW,
      settings.defaultFolderH,
      0,
      0
    );
    const folderId = `folder-${crypto.randomUUID().slice(0, 8)}`;
    const folder: FolderContainer = {
      id: folderId,
      title: group.title.slice(0, 40),
      x: slot.x,
      y: slot.y,
      w: settings.defaultFolderW,
      h: settings.defaultFolderH,
      displayMode: settings.defaultFolderMode,
      isPrivate: false,
      createdAt: now,
      updatedAt: now,
    };
    nextFolders.push(folder);
    occupied.push({
      x: slot.x,
      y: slot.y,
      w: settings.defaultFolderW,
      h: settings.defaultFolderH,
    });
    importedFolders++;

    group.links.forEach((link, idx) => {
      let host: string | undefined;
      try {
        host = new URL(link.url).hostname;
      } catch {
        host = undefined;
      }
      const item: BookmarkItem = {
        id: `item-${crypto.randomUUID().slice(0, 8)}`,
        title: link.title.slice(0, 64),
        url: link.url,
        subtitle: host,
        parentId: folderId,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        order: idx,
        createdAt: now,
        updatedAt: now,
      };
      nextItems.push(item);
      importedItems++;
    });
  }

  for (const link of rootLinks) {
    const slot = findNearestFreeSlot(occupied, settings.defaultItemW, settings.defaultItemH, 0, 0);
    let host: string | undefined;
    try {
      host = new URL(link.url).hostname;
    } catch {
      host = undefined;
    }
    const item: BookmarkItem = {
      id: `item-${crypto.randomUUID().slice(0, 8)}`,
      title: link.title.slice(0, 64),
      url: link.url,
      subtitle: host,
      parentId: null,
      x: slot.x,
      y: slot.y,
      w: settings.defaultItemW,
      h: settings.defaultItemH,
      order: 0,
      createdAt: now,
      updatedAt: now,
    };
    nextItems.push(item);
    occupied.push({
      x: slot.x,
      y: slot.y,
      w: settings.defaultItemW,
      h: settings.defaultItemH,
    });
    importedItems++;
  }

  if (importedItems === 0 && importedFolders === 0) {
    throw new Error('HTML 文件中未找到可导入的 http/https 书签');
  }

  return {
    doc: {
      ...currentDoc,
      updatedAt: now,
      folders: nextFolders,
      items: nextItems,
    },
    importedFolders,
    importedItems,
  };
}
