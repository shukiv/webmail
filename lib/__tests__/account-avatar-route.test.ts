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
import { GET } from '@/app/api/account-avatar/route';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';

const mockCreds = getStalwartCredentials as unknown as Mock;
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function request(headers: Record<string, string> = {}): NextRequest {
  return { headers: new Headers(headers), nextUrl: new URL('https://mail.example.com/api/account-avatar?slot=0') } as unknown as NextRequest;
}

function creds(over: Record<string, unknown> = {}) {
  return { serverUrl: 'https://mail.example.com', authHeader: 'Basic x', username: 'Ana@Example.COM', hasSessionCookie: true, slot: 0, trusted: true, ...over };
}

function picture(type = 'image/jpeg', body: Uint8Array = JPEG, extra: Record<string, string> = {}) {
  return new Response(body.slice().buffer as ArrayBuffer, { status: 200, headers: { 'Content-Type': type, ETag: '"abc"', ...extra } });
}

type R = { status: number; headers: Headers };

beforeEach(() => {
  config.values = { accountAvatarUrl: 'http://127.0.0.1:8443/internal/account-avatar', accountAvatarKey: 'k3y' };
  mockCreds.mockReset().mockResolvedValue(creds());
  fetchMock.mockReset().mockResolvedValue(picture());
});

describe('GET /api/account-avatar', () => {
  it('is off without a configured service, and asks nobody', async () => {
    config.values = {};
    const res = (await GET(request())) as unknown as R;
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('needs a session', async () => {
    mockCreds.mockResolvedValue(null);
    expect(((await GET(request())) as unknown as R).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never asks for a session on a server the admin did not configure', async () => {
    mockCreds.mockResolvedValue(creds({ trusted: false }));
    expect(((await GET(request())) as unknown as R).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks only for an address', async () => {
    for (const username of ['ana', '@example.com', 'ana@', 'a@b@c', 'an a@example.com']) {
      mockCreds.mockResolvedValue(creds({ username }));
      expect(((await GET(request())) as unknown as R).status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the signed-in address with the key, server to server, and passes the picture back', async () => {
    const res = (await GET(request())) as unknown as R;
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8443/internal/account-avatar');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body)).toEqual({ email: 'ana@example.com' });
    expect(init.headers.Authorization).toBe('Bearer k3y');
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(res.headers.get('Vary')).toBe('Cookie');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('ETag')).toBe('"abc"');
  });

  it('revalidates with the ETag', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 304 }));
    const res = (await GET(request({ 'If-None-Match': '"abc"' }))) as unknown as R;
    expect(fetchMock.mock.calls[0][1].headers['If-None-Match']).toBe('"abc"');
    expect(res.status).toBe(304);
    expect(res.headers.get('ETag')).toBe('"abc"');
  });

  it('serves nothing but a raster picture', async () => {
    const answers = [
      new Response(null, { status: 404 }),
      new Response('nope', { status: 500 }),
      picture('text/html'),
      picture('image/svg+xml'),
      picture('image/png', new Uint8Array(0)),
      picture('image/png', new Uint8Array((1 << 20) + 1)),
    ];
    for (const answer of answers) {
      fetchMock.mockResolvedValueOnce(answer);
      const res = (await GET(request())) as unknown as R;
      expect(res.status).toBe(404);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('shows the usual avatar when the service fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(((await GET(request())) as unknown as R).status).toBe(404);
  });
});
