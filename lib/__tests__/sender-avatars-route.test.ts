import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ── module mocks (hoisted) ───────────────────────────────────────────────────
vi.mock('next/server', () => {
  class NextResponse {
    status: number;
    headers: Headers;
    body: unknown;
    constructor(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new Headers(init?.headers);
    }
  }
  return { NextResponse, NextRequest: class {} };
});
vi.mock('@/lib/stalwart/credentials', () => ({ getStalwartCredentials: vi.fn() }));
const config: { values: Record<string, unknown> } = { values: {} };
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: { get: (key: string, fallback?: unknown) => (key in config.values ? config.values[key] : fallback) },
}));

import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/sender-avatars/route';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';

const mockCreds = getStalwartCredentials as unknown as Mock;
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

function request(body: unknown, headers: Record<string, string> = { 'Content-Type': 'application/json' }): NextRequest {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    headers: new Headers(headers),
    text: async () => text,
    nextUrl: new URL('https://mail.example.com/api/sender-avatars'),
  } as unknown as NextRequest;
}

function creds(over: Record<string, unknown> = {}) {
  return { serverUrl: 'https://mail.example.com', authHeader: 'Basic x', username: 'Ana@Example.COM', hasSessionCookie: true, slot: 0, trusted: true, ...over };
}

function service(pictures: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ pictures, type: 'image/jpeg' }), { status, headers: { 'Content-Type': 'application/json' } });
}

type R = { status: number; headers: Headers; body: unknown };
const pics = (res: R) => (JSON.parse(res.body as string) as { pictures: Record<string, string> }).pictures;
const ask = async (body: unknown, headers?: Record<string, string>) => (await POST(request(body, headers))) as unknown as R;

beforeEach(() => {
  config.values = { senderAvatarUrl: 'http://127.0.0.1:8443/internal/sender-avatars', accountAvatarKey: 'k3y' };
  mockCreds.mockReset().mockResolvedValue(creds());
  fetchMock.mockReset().mockResolvedValue(service({ 'bo@example.com': JPEG.toString('base64') }));
});

describe('POST /api/sender-avatars', () => {
  it('is off without a configured service, and asks nobody', async () => {
    config.values = { accountAvatarUrl: 'http://127.0.0.1:8443/internal/account-avatar' };
    expect((await ask({ emails: ['bo@example.com'] })).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('takes a JSON list of 1 to 50 addresses only', async () => {
    const bad: Array<[unknown, Record<string, string>?]> = [
      [{ emails: ['bo@example.com'] }, { 'Content-Type': 'text/plain' }],
      ['not json'],
      [{}],
      [{ emails: [] }],
      [{ emails: 'bo@example.com' }],
      [{ emails: [7] }],
      [{ emails: ['bo@example.com', 'no address'] }],
      [{ emails: ['bo@example.com', 'a@b@c'] }],
      [{ emails: Array.from({ length: 51 }, (_, i) => `u${i}@example.com`) }],
      [{ emails: ['bo@example.com'], pad: 'x'.repeat(17 << 10) }],
    ];
    for (const [body, headers] of bad) {
      expect((await ask(body, headers)).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('needs a session', async () => {
    mockCreds.mockResolvedValue(null);
    expect((await ask({ emails: ['bo@example.com'] })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never asks for a session on a server the admin did not configure, or a name that is not an address', async () => {
    for (const c of [creds({ trusted: false }), creds({ username: 'ana' })]) {
      mockCreds.mockResolvedValue(c);
      const res = await ask({ emails: ['bo@example.com'] });
      expect(res.status).toBe(200);
      expect(pics(res)).toEqual({});
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the viewer and the senders with the key, server to server', async () => {
    const res = await ask({ emails: [' Bo@Example.com', 'bo@example.com', 'cy@example.com'] });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8443/internal/sender-avatars');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body)).toEqual({ viewer: 'ana@example.com', emails: ['bo@example.com', 'cy@example.com'] });
    expect(init.headers.Authorization).toBe('Bearer k3y');

    config.values.senderAvatarKey = 'own-k3y';
    await ask({ emails: ['bo@example.com'] });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer own-k3y');
  });

  it('passes back pictures by their bytes, for the senders asked about only', async () => {
    fetchMock.mockResolvedValue(
      service({
        'bo@example.com': JPEG.toString('base64'),
        'cy@example.com': PNG.toString('base64'),
        'di@example.com': SVG.toString('base64'),
        'ed@example.com': 42,
        'fy@example.com': Buffer.concat([JPEG, Buffer.alloc(257 << 10)]).toString('base64'),
        'zz@example.com': JPEG.toString('base64'),
      }),
    );
    const res = await ask({ emails: ['bo@example.com', 'cy@example.com', 'di@example.com', 'ed@example.com', 'fy@example.com', 'gu@example.com'] });
    expect(pics(res)).toEqual({
      'bo@example.com': `data:image/jpeg;base64,${JPEG.toString('base64')}`,
      'cy@example.com': `data:image/png;base64,${PNG.toString('base64')}`,
    });
  });

  it('answers none when the service fails', async () => {
    const failures = [
      () => fetchMock.mockResolvedValue(service({}, 401)),
      () => fetchMock.mockResolvedValue(new Response('<html>', { status: 200 })),
      () => fetchMock.mockResolvedValue(new Response(JSON.stringify({ pictures: ['x'] }), { status: 200 })),
      () => fetchMock.mockRejectedValue(new TypeError('redirect')),
    ];
    for (const fail of failures) {
      fail();
      const res = await ask({ emails: ['bo@example.com'] });
      expect(res.status).toBe(200);
      expect(pics(res)).toEqual({});
    }
  });
});
