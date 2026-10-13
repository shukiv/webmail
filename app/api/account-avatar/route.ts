import { NextRequest, NextResponse } from 'next/server';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { configManager } from '@/lib/admin/config-manager';

export const runtime = 'nodejs';

/**
 * GET /api/account-avatar?slot=N
 *
 * The picture of the account signed in to cookie slot N, from the service
 * the admin points `accountAvatarUrl` at (a hosting panel, a directory),
 * so a user's own avatar can be the one they chose there. The webmail
 * POSTs {"email": <the signed-in address>} to it server to server, with
 * `Authorization: Bearer <accountAvatarKey>`; the browser never learns
 * the service's address or key, and the address is never in a URL.
 *
 * - Off (no URL configured): 404, and the client does not ask (the
 *   `accountAvatarEnabled` flag in /api/config).
 * - Only the session's own address is asked for, and only for a session on
 *   a server the admin configured: with a custom JMAP endpoint anyone can
 *   sign in under any name, so its username proves nothing.
 * - Anything but a raster image from the service is a 404, which the
 *   Avatar component answers with its other sources and then initials.
 * - `private, no-cache` with the service's ETag: the browser asks again on
 *   each use (a 304 when unchanged), so a slot reused by another account
 *   or a picture changed at the service shows at once.
 */

const TIMEOUT_MS = 5000;
const MAX_BYTES = 1 << 20;
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const NONE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function none(status = 404) {
  return new NextResponse(null, { status, headers: NONE_HEADERS });
}

/** A mailbox address as a sign-in name: one @, nothing blank or odd. */
function signedInAddress(username: string): string | null {
  const email = username.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) return null;
  for (const c of email) {
    const code = c.codePointAt(0)!;
    if (code <= 0x20 || code === 0x7f) return null;
  }
  return email;
}

export async function GET(request: NextRequest) {
  const endpoint = configManager.get<string>('accountAvatarUrl', '').trim();
  if (!endpoint) return none();

  const creds = await getStalwartCredentials(request);
  if (!creds) return none(401);
  if (!creds.trusted) return none();
  const email = signedInAddress(creds.username);
  if (!email) return none();

  const key = configManager.get<string>('accountAvatarKey', '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const etag = request.headers.get('If-None-Match');
  if (etag) headers['If-None-Match'] = etag;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email }),
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
    });
    if (res.status === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: { 'Cache-Control': 'private, no-cache', Vary: 'Cookie', ...(etag ? { ETag: etag } : {}) },
      });
    }
    if (res.status !== 200) return none();
    const type = (res.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (!RASTER_TYPES.has(type)) return none();
    const declared = Number(res.headers.get('Content-Length') ?? '0');
    if (declared > MAX_BYTES) return none();
    const body = await res.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return none();

    const out: Record<string, string> = {
      'Content-Type': type,
      'Cache-Control': 'private, no-cache',
      Vary: 'Cookie',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    };
    const upstreamTag = res.headers.get('ETag');
    if (upstreamTag) out.ETag = upstreamTag;
    return new NextResponse(body, { status: 200, headers: out });
  } catch {
    // Timed out, refused, or redirected: the usual avatar instead.
    return none();
  } finally {
    clearTimeout(timer);
  }
}
