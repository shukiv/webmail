import { NextRequest, NextResponse } from 'next/server';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { configManager } from '@/lib/admin/config-manager';
import { avatarAddress, rasterType } from '@/lib/avatar-service';

export const runtime = 'nodejs';

/**
 * POST /api/sender-avatars  {"emails": ["<sender>", ...]}
 *
 * Pictures for the senders on screen, from the service the admin points
 * `senderAvatarUrl` at (a hosting panel that knows its own mailboxes). The
 * webmail POSTs {"viewer": <the signed-in address>, "emails": [...]} there,
 * server to server, with `Authorization: Bearer <senderAvatarKey>` (empty =
 * the account-avatar key), and answers {"pictures": {"<email>": "data:..."}}
 * with the PNG, JPEG, GIF and WebP pictures it gets back.
 *
 * - Off (no URL configured): 404, and the client does not ask (the
 *   `senderAvatarEnabled` flag in /api/config).
 * - Which senders a viewer may see is the service's call. The viewer is
 *   the session's own address, and only for a session on a server the admin
 *   configured, so nobody can ask as someone else.
 * - Addresses travel in bodies only, never in a URL.
 * - A failure at the service is an empty answer: the Avatar goes on to its
 *   other sources.
 */

const TIMEOUT_MS = 8000;
const MAX_EMAILS = 50;
const MAX_REQUEST_BYTES = 16 << 10;
const MAX_PICTURE_BYTES = 256 << 10;
const MAX_ANSWER_BYTES = 8 << 20;

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };

function none(status: number) {
  return new NextResponse(null, { status, headers: HEADERS });
}

function pictures(found: Record<string, string>) {
  return new NextResponse(JSON.stringify({ pictures: found }), {
    status: 200,
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
  });
}

/** The senders asked for, lowercased and once each, or null if any is not an address. */
async function senders(request: NextRequest): Promise<string[] | null> {
  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) return null;
  if (Number(request.headers.get('Content-Length') ?? '0') > MAX_REQUEST_BYTES) return null;
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) return null;
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const emails = (body as { emails?: unknown } | null)?.emails;
  if (!Array.isArray(emails) || emails.length === 0 || emails.length > MAX_EMAILS) return null;
  const out = new Set<string>();
  for (const e of emails) {
    const email = typeof e === 'string' ? avatarAddress(e) : null;
    if (!email) return null;
    out.add(email);
  }
  return [...out];
}

export async function POST(request: NextRequest) {
  const endpoint = configManager.get<string>('senderAvatarUrl', '').trim();
  if (!endpoint) return none(404);

  const emails = await senders(request);
  if (!emails) return none(400);
  const creds = await getStalwartCredentials(request);
  if (!creds) return none(401);
  if (!creds.trusted) return pictures({});
  const viewer = avatarAddress(creds.username);
  if (!viewer) return pictures({});

  const key = configManager.get<string>('senderAvatarKey', '') || configManager.get<string>('accountAvatarKey', '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ viewer, emails }),
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
    });
    if (res.status !== 200) return pictures({});
    if (Number(res.headers.get('Content-Length') ?? '0') > MAX_ANSWER_BYTES) return pictures({});
    const raw = await res.arrayBuffer();
    if (raw.byteLength > MAX_ANSWER_BYTES) return pictures({});
    const answer = JSON.parse(new TextDecoder().decode(raw)) as { pictures?: unknown };
    const given = answer?.pictures;
    if (!given || typeof given !== 'object' || Array.isArray(given)) return pictures({});

    const found: Record<string, string> = {};
    for (const email of emails) {
      const b64 = (given as Record<string, unknown>)[email];
      if (typeof b64 !== 'string' || b64.length === 0 || b64.length > (MAX_PICTURE_BYTES * 4) / 3 + 4) continue;
      const bytes = Buffer.from(b64, 'base64');
      if (bytes.length === 0 || bytes.length > MAX_PICTURE_BYTES) continue;
      const type = rasterType(bytes);
      if (!type) continue;
      found[email] = `data:${type};base64,${bytes.toString('base64')}`;
    }
    return pictures(found);
  } catch {
    // Timed out, refused, redirected or not JSON: the usual avatars instead.
    return pictures({});
  } finally {
    clearTimeout(timer);
  }
}
