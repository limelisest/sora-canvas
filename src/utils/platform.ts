export function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaDataPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  if (typeof uaDataPlatform === 'string' && uaDataPlatform.length > 0) {
    return /^mac/i.test(uaDataPlatform);
  }
  const platform = navigator.platform || '';
  if (/^mac/i.test(platform)) {
    // iPadOS desktop mode sometimes reports MacIntel with touch points
    if (platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
      return false;
    }
    return true;
  }
  const ua = navigator.userAgent || '';
  if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad|iPod|Android|Windows/i.test(ua)) {
    return true;
  }
  // Fallback to Windows style whenever unrecognized
  return false;
}

export const IS_MAC = isMacOS();
export const SHORTCUT_SEARCH = IS_MAC ? '⌘K' : 'Ctrl+K';
export const SHORTCUT_UNDO = IS_MAC ? '⌘Z' : 'Ctrl+Z';
export const SHORTCUT_REDO = IS_MAC ? '⌘⇧Z' : 'Ctrl+Y';
