import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const SESSION_COOKIE_NAME = 'neko_like_session';
export const DEFAULT_REMEMBER_DAYS = 365;
const SESSION_ONLY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthConfig {
  passwordSalt: string;
  passwordHash: string;
  cookieSecret: string;
  apiToken: string;
  createdAt: string;
}

export interface SessionPayload {
  role: 'admin';
  remember: boolean;
  iat: number;
  exp: number;
}

function generateInitialPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

async function writeAuthConfig(dataDir: string, config: AuthConfig): Promise<void> {
  const configPath = path.join(dataDir, 'config.json');
  const tmpPath = `${configPath}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(tmpPath, 0o600);
  await fs.rename(tmpPath, configPath);
}

export async function ensureAuthConfig(
  dataDir: string,
  overridePassword?: string
): Promise<AuthConfig> {
  await fs.mkdir(dataDir, { recursive: true });
  const configPath = path.join(dataDir, 'config.json');

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as AuthConfig;
    if (parsed.passwordSalt && parsed.passwordHash && parsed.cookieSecret && parsed.apiToken) {
      return parsed;
    }
  } catch {
    // Initialize below
  }

  const envPassword = overridePassword ?? process.env.NEKO_LIKE_PASSWORD;
  const password = envPassword && envPassword.length > 0 ? envPassword : generateInitialPassword();

  if (!envPassword || envPassword.length === 0) {
    const pwPath = path.join(dataDir, 'initial-password');
    await fs.writeFile(pwPath, `${password}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(pwPath, 0o600);
  }

  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const config: AuthConfig = {
    passwordSalt,
    passwordHash: hashPassword(password, passwordSalt),
    cookieSecret: crypto.randomBytes(32).toString('hex'),
    apiToken: crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };

  await writeAuthConfig(dataDir, config);
  return config;
}

export async function updatePassword(
  dataDir: string,
  config: AuthConfig,
  newPassword: string
): Promise<AuthConfig> {
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const updated: AuthConfig = {
    ...config,
    passwordSalt,
    passwordHash: hashPassword(newPassword, passwordSalt),
  };
  await writeAuthConfig(dataDir, updated);
  return updated;
}

export async function rotateCookieSecret(
  dataDir: string,
  config: AuthConfig
): Promise<AuthConfig> {
  const updated: AuthConfig = {
    ...config,
    cookieSecret: crypto.randomBytes(32).toString('hex'),
  };
  await writeAuthConfig(dataDir, updated);
  return updated;
}

export async function rotateApiToken(
  dataDir: string,
  config: AuthConfig
): Promise<AuthConfig> {
  const updated: AuthConfig = {
    ...config,
    apiToken: crypto.randomBytes(32).toString('hex'),
  };
  await writeAuthConfig(dataDir, updated);
  return updated;
}

export function verifyPassword(config: AuthConfig, candidate: string): boolean {
  if (!candidate || typeof candidate !== 'string') return false;
  const derived = crypto.scryptSync(candidate, config.passwordSalt, 64);
  const expected = Buffer.from(config.passwordHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function verifyBearerToken(request: FastifyRequest, config: AuthConfig): boolean {
  const header = request.headers.authorization;
  if (!header || typeof header !== 'string') return false;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const token = match[1].trim();
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(config.apiToken, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function signSessionToken(payloadStr: string, secret: string): string {
  const encoded = Buffer.from(payloadStr, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function unsignSessionToken(token: string, secret: string): string | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!encoded || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

export function parseSessionCookie(
  request: FastifyRequest,
  config: AuthConfig
): SessionPayload | null {
  const raw = request.cookies?.[SESSION_COOKIE_NAME];
  if (!raw || typeof raw !== 'string') return null;
  const decoded = unsignSessionToken(raw, config.cookieSecret);
  if (!decoded) return null;
  try {
    const payload = JSON.parse(decoded) as Partial<SessionPayload>;
    if (payload.role !== 'admin') return null;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return {
      role: 'admin',
      remember: payload.remember !== false,
      iat: typeof payload.iat === 'number' ? payload.iat : Date.now(),
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function verifySessionCookie(request: FastifyRequest, config: AuthConfig): boolean {
  return parseSessionCookie(request, config) !== null;
}

export function isAuthenticated(request: FastifyRequest, config: AuthConfig): boolean {
  return verifyBearerToken(request, config) || verifySessionCookie(request, config);
}

function isRequestHttps(request: FastifyRequest): boolean {
  if (request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https') {
    return true;
  }
  const cfVisitor = request.headers['cf-visitor'];
  if (typeof cfVisitor === 'string' && cfVisitor.includes('"https"')) {
    return true;
  }
  return false;
}

export function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AuthConfig,
  remember = true,
  rememberDays = DEFAULT_REMEMBER_DAYS
): void {
  const now = Date.now();
  const maxAgeSeconds = rememberDays * 24 * 60 * 60;
  const payload: SessionPayload = {
    role: 'admin',
    remember,
    iat: now,
    exp: now + (remember ? maxAgeSeconds * 1000 : SESSION_ONLY_TTL_MS),
  };

  const token = signSessionToken(JSON.stringify(payload), config.cookieSecret);
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isRequestHttps(request),
    ...(remember ? { maxAge: maxAgeSeconds } : {}),
  });
}

export function clearSessionCookie(request: FastifyRequest, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isRequestHttps(request),
  });
}
