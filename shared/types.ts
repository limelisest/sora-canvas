export type FolderDisplayMode = 'grid' | 'list';

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  subtitle?: string;
  icon?: string;
  faviconUrl?: string;
  accent?: string;
  tags?: string[];
  parentId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface FolderContainer {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  displayMode: FolderDisplayMode;
  isPrivate: boolean;
  icon?: string;
  accent?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GridConfig {
  cellSize: number;
  gap: number;
}

export type GridDensity = 'compact' | 'standard' | 'relaxed';
export type DefaultThemeMode = 'light' | 'dark' | 'system';
export type DotGridMode = 'always' | 'edit-only' | 'hidden';
export type OpenTargetMode = '_blank' | '_self';
export type DragOutItemSizeMode = '1x1' | 'preserve';
export type RememberDays = 7 | 30 | 90 | 365;
export type ViewportMode = 'anchor' | 'auto';
export type MobileDefaultView = 'paged' | 'canvas';
export type CanvasBgStyle = 'dot' | 'aurora' | 'wallpaper';
export type WheelMode = 'zoom' | 'pan';

export interface SiteSettings {
  siteTitle: string;
  brandAccent: string;
  homeLinkEnabled: boolean;
  homeLinkLabel: string;
  homeLinkUrl: string;
  defaultTheme: DefaultThemeMode;
  dotGridMode: DotGridMode;
  canvasBgStyle: CanvasBgStyle;
  customBgUrl: string;
  wheelMode: WheelMode;
  showFolderNav: boolean;
  openTarget: OpenTargetMode;

  defaultItemW: number;
  defaultItemH: number;
  defaultFolderW: number;
  defaultFolderH: number;
  defaultFolderMode: FolderDisplayMode;
  dragOutItemSizeMode: DragOutItemSizeMode;

  gridDensity: GridDensity;
  touchLongPressMs: number;
  hoverMergeEnabled: boolean;
  hoverMergeMs: number;
  mergedFolderTitle: string;
  allowPrivateMeta: boolean;

  rememberDays: RememberDays;
  slidingRenewal: boolean;
  desktopViewportMode: ViewportMode;
  mobileViewportMode: ViewportMode;
  mobileDefaultView: MobileDefaultView;
  viewportOrigin: { x: number; y: number } | null;
}

export interface ZoneContainer {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  accent?: string;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CarouselImageItem {
  id: string;
  url: string;
  caption?: string;
  linkUrl?: string;
}

export interface CarouselWidget {
  id: string;
  kind: 'carousel';
  title?: string;
  images: CarouselImageItem[];
  intervalSec: number;
  transition: 'slide' | 'fade';
  fit: 'cover' | 'contain';
  x: number;
  y: number;
  w: number;
  h: number;
  createdAt: string;
  updatedAt: string;
}

export interface FreeTextWidget {
  id: string;
  kind: 'text';
  text: string;
  fontSize: number;
  color?: string;
  weight: 'normal' | 'semibold' | 'bold';
  align: 'left' | 'center' | 'right';
  x: number;
  y: number;
  w: number;
  h: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteWidget {
  id: string;
  kind: 'note';
  title: string;
  content: string;
  tint?: string;
  isPrivate?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  createdAt: string;
  updatedAt: string;
}

export type CanvasWidget = CarouselWidget | FreeTextWidget | NoteWidget;

export interface CanvasDocument {
  version: 2;
  updatedAt: string;
  grid: GridConfig;
  folders: FolderContainer[];
  items: BookmarkItem[];
  zones?: ZoneContainer[];
  widgets?: CanvasWidget[];
}

export interface CanvasResponse extends CanvasDocument {
  unlocked: boolean;
  hasPrivateHidden: boolean;
  settings: SiteSettings;
}

export interface HistorySnapshotSummary {
  id: string;
  createdAt: string;
  reason: string;
  nodeCount: number;
}

export type CanvasGridEntity =
  | ({ kind: 'item' } & BookmarkItem)
  | ({ kind: 'folder' } & FolderContainer)
  | CarouselWidget
  | NoteWidget;

export type AgentOp =
  | {
      op: 'create_item';
      id?: string;
      title: string;
      url: string;
      subtitle?: string;
      icon?: string;
      faviconUrl?: string;
      accent?: string;
      tags?: string[];
      parentId?: string | null;
      folderId?: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
    }
  | {
      op: 'update_item';
      id: string;
      patch: {
        title?: string;
        url?: string;
        subtitle?: string;
        icon?: string;
        faviconUrl?: string;
        accent?: string;
        tags?: string[];
      };
    }
  | {
      op: 'delete_items';
      ids: string[];
    }
  | {
      op: 'create_folder';
      id?: string;
      title: string;
      w?: number;
      h?: number;
      displayMode?: FolderDisplayMode;
      isPrivate?: boolean;
      icon?: string;
      accent?: string;
      x?: number;
      y?: number;
    }
  | {
      op: 'update_folder';
      id: string;
      patch: {
        title?: string;
        displayMode?: FolderDisplayMode;
        isPrivate?: boolean;
        icon?: string;
        accent?: string;
      };
    }
  | {
      op: 'dissolve_folder';
      id: string;
      deleteItems?: boolean;
    }
  | {
      op: 'move_items_to_folder';
      itemIds: string[];
      folderId: string;
      index?: number;
    }
  | {
      op: 'move_items_to_canvas';
      itemIds: string[];
      x?: number;
      y?: number;
      w?: number;
      h?: number;
    }
  | {
      op: 'merge_items_to_folder';
      sourceItemId: string;
      targetItemId: string;
      title?: string;
      folderId?: string;
    }
  | {
      op: 'reorder_folder_items';
      folderId: string;
      itemIds: string[];
    }
  | {
      op: 'resize_entity';
      id: string;
      w: number;
      h: number;
    }
  | {
      op: 'move_entities';
      ids: string[];
      dx: number;
      dy: number;
    }
  | {
      op: 'place_entity';
      id: string;
      x: number;
      y: number;
    }
  | {
      op: 'create_zone';
      id?: string;
      title: string;
      x: number;
      y: number;
      w: number;
      h: number;
      accent?: string;
      isPrivate?: boolean;
    }
  | {
      op: 'update_zone';
      id: string;
      patch: {
        title?: string;
        x?: number;
        y?: number;
        w?: number;
        h?: number;
        accent?: string;
        isPrivate?: boolean;
      };
    }
  | {
      op: 'delete_zone';
      id: string;
    };
