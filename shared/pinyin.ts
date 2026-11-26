const PINYIN_LETTERS = 'ABCDEFGHJKLMNOPQRSTWXYZ'.split('');
const PINYIN_BOUNDS = [
  '阿', '芭', '擦', '搭', '蛾', '发', '噶', '哈', '击', '喀', '垃', '妈',
  '拿', '哦', '啪', '期', '然', '撒', '塌', '挖', '昔', '压', '匝',
];

const zhCollator = new Intl.Collator('zh-CN');

export function getCharPinyinInitial(ch: string): string {
  if (/[a-zA-Z0-9]/.test(ch)) {
    return ch.toLowerCase();
  }
  if (!/[\u4e00-\u9fa5]/.test(ch)) {
    return '';
  }
  for (let i = PINYIN_BOUNDS.length - 1; i >= 0; i--) {
    if (zhCollator.compare(ch, PINYIN_BOUNDS[i]) >= 0) {
      return PINYIN_LETTERS[i].toLowerCase();
    }
  }
  return '';
}

export function toPinyinInitials(text: string): string {
  let out = '';
  for (const ch of text) {
    out += getCharPinyinInitial(ch);
  }
  return out;
}

export function fuzzyScore(query: string, ...fields: Array<string | undefined>): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;

  let best = 0;
  for (const raw of fields) {
    if (!raw) continue;
    const text = raw.toLowerCase();
    if (text === q) {
      best = Math.max(best, 100);
      continue;
    }
    if (text.startsWith(q)) {
      best = Math.max(best, 85);
      continue;
    }
    const idx = text.indexOf(q);
    if (idx !== -1) {
      best = Math.max(best, 70 - Math.min(idx, 20));
      continue;
    }

    const initials = toPinyinInitials(raw);
    if (initials) {
      if (initials === q) {
        best = Math.max(best, 80);
        continue;
      }
      if (initials.startsWith(q)) {
        best = Math.max(best, 65);
        continue;
      }
      const pIdx = initials.indexOf(q);
      if (pIdx !== -1) {
        best = Math.max(best, 55 - Math.min(pIdx, 15));
        continue;
      }
    }

    // Subsequence match on text or initials
    if (isSubsequence(q, text) || (initials && isSubsequence(q, initials))) {
      best = Math.max(best, 30);
    }
  }

  return best;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (needle[i] === haystack[j]) {
      i++;
    }
  }
  return i === needle.length;
}
