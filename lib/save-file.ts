import { toast } from '@/stores/toast-store';

/**
 * Saves a file the app fetched or built (an attachment, a "Download all"
 * zip) to the person's device.
 *
 * Desktop and Android: the usual <a download> on a blob: URL.
 *
 * iPhone and iPad: Safari, and above all a web app opened from the home
 * screen, shows a blob: download in a preview window. That is fine for what
 * iOS can preview there (PDF, pictures, Office files, text), but an archive
 * or an unknown type comes up as a blank page with a file icon and no way to
 * keep it. That is what "Download all" did on an iPhone. Those files go to
 * the share sheet instead, where "Save to Files" works.
 *
 * iOS only opens the share sheet straight after a tap. When fetching or
 * zipping took longer than that, a toast offers a Save button, and tapping
 * it opens the sheet.
 */

/** Previewable on iOS: what its preview window shows, so <a download> works there. */
const IOS_PREVIEWABLE_EXT = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'gif', 'heic', 'heif', 'webp', 'bmp', 'tif', 'tiff', 'svg',
  'mp4', 'mov', 'm4v', 'mp3', 'm4a', 'wav', 'aac',
  'txt', 'csv', 'rtf', 'html', 'htm', 'eml',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pages', 'numbers', 'key',
]);

export function isAppleMobile(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined =
  typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  // iPadOS asks for desktop sites by default and calls itself a Mac.
  return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
}

export function iosCanPreview(name: string, type?: string): boolean {
  const t = (type || '').toLowerCase().split(';')[0].trim();
  if (t === 'application/pdf' || /^(image|video|audio|text)\//.test(t)) return true;
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return IOS_PREVIEWABLE_EXT.has(ext);
}

/** The words of the "tap to save" toast; the app sets them in the person's language. */
let text = { ready: 'Ready to save', save: 'Save' };

export function setSaveFileText(next: { ready: string; save: string }): void {
  text = next;
}

function downloadWithLink(blob: Blob, name: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked later, not at once: Safari reads the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function errorName(err: unknown): string {
  return err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
}

export async function saveFile(blob: Blob, name: string): Promise<void> {
  const fileName = name || 'download';
  if (isAppleMobile() && !iosCanPreview(fileName, blob.type)) {
    const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        const why = errorName(err);
        if (why === 'AbortError') return; // the person closed the sheet
        if (why === 'NotAllowedError') {
          // Too long since the tap: a fresh tap opens the sheet.
          toast.info(text.ready, {
            message: fileName,
            duration: 30_000,
            action: { label: text.save, onClick: () => { navigator.share({ files: [file] }).catch(() => {}); } },
          });
          return;
        }
        // Anything else: fall back to the link, as before.
      }
    }
  }
  downloadWithLink(blob, fileName);
}
