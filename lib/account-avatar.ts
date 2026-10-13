import { withBasePath } from "@/lib/browser-navigation";
import { IS_LITE } from "@/lib/lite";

/**
 * The picture of the account in cookie slot `slot`, from
 * /api/account-avatar, for that account's own avatar; undefined when the
 * server has no account-avatar service (`accountAvatarEnabled`). The slot,
 * not the address, names the account, so no address is put in a URL.
 */
export function accountAvatarSrc(enabled: boolean, slot: number | undefined): string | undefined {
  if (IS_LITE || !enabled || slot === undefined || !Number.isInteger(slot) || slot < 0) return undefined;
  return withBasePath(`/api/account-avatar?slot=${slot}`);
}
