/**
 * Shared by the routes that ask an avatar service for pictures
 * (/api/account-avatar, /api/sender-avatars), and by the client that asks
 * /api/sender-avatars, so it never sends an address the route refuses.
 */

/** A mailbox address as a sign-in name: one @, nothing blank or odd. */
export function avatarAddress(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) return null;
  for (const c of email) {
    const code = c.codePointAt(0)!;
    if (code <= 0x20 || code === 0x7f) return null;
  }
  return email;
}

/**
 * The type of a PNG, JPEG, GIF or WebP picture by its first bytes, or null:
 * a service's word for it is not taken, and nothing else is shown.
 */
export function rasterType(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) {
    return 'image/gif';
  }
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return 'image/webp';
  }
  return null;
}
