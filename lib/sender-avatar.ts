import { withBasePath } from '@/lib/browser-navigation';
import { getActiveAccountSlot } from '@/lib/auth/active-account-slot';
import { avatarAddress } from '@/lib/avatar-service';

/**
 * Senders' pictures from /api/sender-avatars, for the Avatar component.
 *
 * Each address is asked about once per signed-in account (cookie slot) and
 * then kept ten minutes, a picture or none alike; after a failed ask, one
 * minute. The asks of one render go out together, up to 50 at a time.
 * Addresses go in the request body, never in a URL.
 */

const BATCH_MS = 25;
const MAX_BATCH = 50;
const KEEP_MS = 10 * 60_000;
const RETRY_MS = 60_000;
const MAX_KEPT = 1000;

interface Entry {
  at: number;
  ttl: number;
  /** undefined until the answer is in. */
  src?: string | null;
  value: Promise<string | null>;
}

interface Batch {
  emails: Map<string, { entry: Entry; resolve: (src: string | null) => void }>;
  timer: ReturnType<typeof setTimeout>;
}

const kept = new Map<string, Entry>();
const batches = new Map<string, Batch>();

function slotKey(): string {
  const slot = getActiveAccountSlot();
  return slot === null ? '' : String(slot);
}

function live(key: string): Entry | undefined {
  const e = kept.get(key);
  if (e && Date.now() - e.at < e.ttl) return e;
  return undefined;
}

/**
 * The picture already known for `email`: a data: URL, null for none, or
 * undefined when it has not been asked about (or the answer is not in yet).
 */
export function knownSenderAvatar(email: string): string | null | undefined {
  const addr = avatarAddress(email);
  return addr ? live(`${slotKey()} ${addr}`)?.src : null;
}

/** The picture for `email`, or null for none. */
export function senderAvatar(email: string): Promise<string | null> {
  // One address the route refuses would cost the whole batch its answer.
  const addr = avatarAddress(email);
  if (!addr) return Promise.resolve(null);
  const slot = slotKey();
  const key = `${slot} ${addr}`;
  const hit = live(key);
  if (hit) return hit.value;

  const entry = { at: Date.now(), ttl: KEEP_MS } as Entry;
  entry.value = new Promise<string | null>((resolve) => {
    let batch = batches.get(slot);
    if (!batch) {
      batch = { emails: new Map(), timer: setTimeout(() => void flush(slot), BATCH_MS) };
      batches.set(slot, batch);
    }
    batch.emails.set(addr, { entry, resolve });
    if (batch.emails.size >= MAX_BATCH) void flush(slot);
  });
  kept.delete(key);
  kept.set(key, entry);
  if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value!);
  return entry.value;
}

async function flush(slot: string): Promise<void> {
  const batch = batches.get(slot);
  if (!batch) return;
  batches.delete(slot);
  clearTimeout(batch.timer);
  const asked = [...batch.emails];

  let given: Record<string, unknown> | null = null;
  try {
    const res = await fetch(withBasePath('/api/sender-avatars'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(slot ? { 'X-JMAP-Cookie-Slot': slot } : {}) },
      body: JSON.stringify({ emails: asked.map(([email]) => email) }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as { pictures?: unknown };
      if (data?.pictures && typeof data.pictures === 'object') given = data.pictures as Record<string, unknown>;
    }
  } catch {
    // Offline or refused: none for now, and asked again in a minute.
  }
  for (const [email, { entry, resolve }] of asked) {
    const src = given?.[email];
    entry.src = typeof src === 'string' && src.startsWith('data:image/') ? src : null;
    if (!given) entry.ttl = RETRY_MS;
    resolve(entry.src);
  }
}
