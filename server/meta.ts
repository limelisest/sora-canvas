import dns from 'node:dns/promises';
import net from 'node:net';

export interface UrlMetadata {
  url: string;
  title: string;
  faviconUrl: string;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80')
    );
  }
  return true;
}

async function assertPublicHostIfConfigured(
  hostname: string,
  allowPrivate = false
): Promise<void> {
  if (allowPrivate || process.env.NEKO_LIKE_ALLOW_PRIVATE_META === '1') return;

  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) {
    throw new Error('安全策略默认禁止抓取内网地址元数据');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error('安全策略默认禁止抓取内网 IP 元数据');
    }
    return;
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    for (const rec of records) {
      if (isPrivateIp(rec.address)) {
        throw new Error('目标域名解析到内网地址，已拦截');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('内网')) throw err;
    // Allow fetch attempt to surface standard network error if DNS fails
  }
}

function extractTagContent(html: string, pattern: RegExp): string | undefined {
  const match = html.match(pattern);
  return match?.[1]?.trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAttr(tag: string, attr: string): string | undefined {
  const re = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = tag.match(re);
  return m?.[1] ?? m?.[2] ?? m?.[3];
}

export async function fetchUrlMetadata(
  rawUrl: string,
  allowPrivate = false
): Promise<UrlMetadata> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('无效的 URL 格式');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅支持 http 或 https 协议');
  }

  await assertPublicHostIfConfigured(parsed.hostname, allowPrivate);

  const fallbackFavicon = `${parsed.origin}/favicon.ico`;
  const fallbackTitle = parsed.hostname;

  try {
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': 'neko-like-metadata-fetcher/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      return { url: parsed.toString(), title: fallbackTitle, faviconUrl: fallbackFavicon };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('xhtml')) {
      return { url: parsed.toString(), title: fallbackTitle, faviconUrl: fallbackFavicon };
    }

    const text = (await response.text()).slice(0, 256 * 1024);

    const ogTitle = extractTagContent(
      text,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i
    );
    const titleTag = extractTagContent(text, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = decodeHtmlEntities(ogTitle || titleTag || fallbackTitle) || fallbackTitle;

    let faviconUrl = fallbackFavicon;
    const linkMatches = text.match(/<link\b[^>]*>/gi) ?? [];
    for (const tag of linkMatches) {
      const rel = (extractAttr(tag, 'rel') ?? '').toLowerCase();
      if (rel.includes('icon')) {
        const href = extractAttr(tag, 'href');
        if (href) {
          try {
            faviconUrl = new URL(href, response.url || parsed.toString()).toString();
            break;
          } catch {
            // Keep fallback
          }
        }
      }
    }

    return {
      url: response.url || parsed.toString(),
      title,
      faviconUrl,
    };
  } catch {
    return {
      url: parsed.toString(),
      title: fallbackTitle,
      faviconUrl: fallbackFavicon,
    };
  }
}
