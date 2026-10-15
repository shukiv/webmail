import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const slot: { value: number | null } = { value: 0 };
vi.mock('@/lib/browser-navigation', () => ({ withBasePath: (p: string) => p }));
vi.mock('@/lib/auth/active-account-slot', () => ({ getActiveAccountSlot: () => slot.value }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const PIC = 'data:image/jpeg;base64,/9j/4A==';

function answer(pictures: Record<string, string>) {
  return new Response(JSON.stringify({ pictures }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

let mod: typeof import('@/lib/sender-avatar');

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  slot.value = 0;
  fetchMock.mockReset().mockImplementation(async () => answer({ 'bo@example.com': PIC }));
  mod = await import('@/lib/sender-avatar');
});

afterEach(() => {
  vi.useRealTimers();
});

const sent = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body).emails as string[];

describe('sender avatars in the browser', () => {
  it('asks once for a render, with the slot and no address in the URL', async () => {
    const asks = [mod.senderAvatar('Bo@Example.com'), mod.senderAvatar('cy@example.com'), mod.senderAvatar('bo@example.com')];
    expect(mod.knownSenderAvatar('bo@example.com')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(30);
    expect(await Promise.all(asks)).toEqual([PIC, null, PIC]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sender-avatars');
    expect(init.method).toBe('POST');
    expect(init.headers['X-JMAP-Cookie-Slot']).toBe('0');
    expect(sent(0)).toEqual(['bo@example.com', 'cy@example.com']);
    expect(mod.knownSenderAvatar('bo@example.com')).toBe(PIC);
    expect(mod.knownSenderAvatar('cy@example.com')).toBeNull();
  });

  it('keeps answers ten minutes, per signed-in account', async () => {
    const first = mod.senderAvatar('bo@example.com');
    await vi.advanceTimersByTimeAsync(30);
    await first;
    expect(await mod.senderAvatar('bo@example.com')).toBe(PIC);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    slot.value = 1;
    const other = mod.senderAvatar('bo@example.com');
    await vi.advanceTimersByTimeAsync(30);
    await other;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers['X-JMAP-Cookie-Slot']).toBe('1');

    slot.value = 0;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const later = mod.senderAvatar('bo@example.com');
    await vi.advanceTimersByTimeAsync(30);
    await later;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('after a failed ask, none for now and another ask in a minute', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 502 }));
    const first = mod.senderAvatar('bo@example.com');
    await vi.advanceTimersByTimeAsync(30);
    expect(await first).toBeNull();
    await mod.senderAvatar('bo@example.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(61_000);
    const again = mod.senderAvatar('bo@example.com');
    await vi.advanceTimersByTimeAsync(30);
    expect(await again).toBe(PIC);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends only what the route takes, 50 at a time', async () => {
    expect(await mod.senderAvatar('not an address')).toBeNull();
    expect(await mod.senderAvatar('a@b@c')).toBeNull();
    const asks = Array.from({ length: 51 }, (_, i) => mod.senderAvatar(`u${i}@example.com`));
    await vi.advanceTimersByTimeAsync(30);
    await Promise.all(asks);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(0)).toHaveLength(50);
    expect(sent(1)).toEqual(['u50@example.com']);
  });

  it('shows only data: image URLs', async () => {
    fetchMock.mockImplementationOnce(async () => answer({ 'bo@example.com': 'https://tracker.example/p.gif' }));
    const p = mod.senderAvatar('bo@example.com');
    await vi.advanceTimersByTimeAsync(30);
    expect(await p).toBeNull();
  });
});
