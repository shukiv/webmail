import { routing } from './routing';

/**
 * Pick the best supported locale for a first-time visitor from their browser
 * language preferences. Returns `fallback` (English default) when the browser
 * prefers English, prefers nothing we support, or is unavailable (SSR) — so we
 * only auto-switch AWAY from English when the browser clearly prefers another
 * language we ship. A user's explicit choice is persisted separately and is
 * never overridden by this.
 */
export function detectBrowserLocale(fallback: string): string {
  if (typeof navigator === 'undefined') return fallback;
  const supported = new Set<string>(routing.locales as readonly string[]);
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of prefs) {
    if (!tag) continue;
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'en') return fallback;    // English is the top preference -> keep default
    if (supported.has(base)) return base;  // first supported non-English preference wins
  }
  return fallback;
}
