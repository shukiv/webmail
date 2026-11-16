import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iosCanPreview, isAppleMobile, saveFile, setSaveFileText } from '../save-file';
import { useToastStore } from '@/stores/toast-store';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';

function setNavigator(fields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(fields)) {
    Object.defineProperty(window.navigator, key, { value, configurable: true, writable: true });
  }
}

describe('isAppleMobile', () => {
  it('knows an iPhone, and an iPad asking for the desktop site', () => {
    expect(isAppleMobile({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobile({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
  });
  it('leaves a Mac and Android alone', () => {
    expect(isAppleMobile({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isAppleMobile({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false);
  });
});

describe('iosCanPreview', () => {
  it('previews PDF, pictures and Office files, by type or by name', () => {
    expect(iosCanPreview('a.pdf', 'application/pdf')).toBe(true);
    expect(iosCanPreview('a.pdf', 'application/octet-stream')).toBe(true);
    expect(iosCanPreview('scan', 'image/jpeg')).toBe(true);
    expect(iosCanPreview('report.DOCX', '')).toBe(true);
  });
  it('cannot preview archives or unknown types', () => {
    expect(iosCanPreview('Attachments.zip', 'application/zip')).toBe(false);
    expect(iosCanPreview('backup.7z', 'application/octet-stream')).toBe(false);
    expect(iosCanPreview('noext', '')).toBe(false);
  });
});

describe('saveFile', () => {
  let clicked: string[];
  let share: ReturnType<typeof vi.fn>;
  let canShare: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    share = vi.fn(async () => {});
    canShare = vi.fn(() => true);
    setNavigator({ share, canShare });
    useToastStore.getState().clearToasts();
    setSaveFileText({ ready: 'Ready to save', save: 'Save' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const zip = () => new Blob(['PK'], { type: 'application/zip' });

  it('downloads with a link on a desktop', async () => {
    setNavigator({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 });
    await saveFile(zip(), 'Attachments.zip');
    expect(clicked).toEqual(['Attachments.zip']);
    expect(share).not.toHaveBeenCalled();
  });

  it('hands a zip to the share sheet on an iPhone', async () => {
    setNavigator({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 });
    await saveFile(zip(), 'Attachments.zip');
    expect(clicked).toEqual([]);
    expect(share).toHaveBeenCalledTimes(1);
    const files = (share.mock.calls[0][0] as { files: File[] }).files;
    expect(files[0].name).toBe('Attachments.zip');
    expect(files[0].type).toBe('application/zip');
  });

  it('keeps the preview for a PDF on an iPhone', async () => {
    setNavigator({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 });
    await saveFile(new Blob(['%PDF'], { type: 'application/pdf' }), 'Invoice.pdf');
    expect(clicked).toEqual(['Invoice.pdf']);
    expect(share).not.toHaveBeenCalled();
  });

  it('offers a Save button when the tap is too old for the share sheet', async () => {
    setNavigator({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 });
    share.mockRejectedValueOnce(Object.assign(new Error('no activation'), { name: 'NotAllowedError' }));
    await saveFile(zip(), 'Attachments.zip');
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe('Ready to save');
    expect(toasts[0].message).toBe('Attachments.zip');
    expect(toasts[0].action?.label).toBe('Save');
    toasts[0].action?.onClick();
    expect(share).toHaveBeenCalledTimes(2);
    expect(clicked).toEqual([]);
  });

  it('does nothing more when the person closes the sheet', async () => {
    setNavigator({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 });
    share.mockRejectedValueOnce(Object.assign(new Error('closed'), { name: 'AbortError' }));
    await saveFile(zip(), 'Attachments.zip');
    expect(clicked).toEqual([]);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('falls back to the link when the share sheet cannot take the file', async () => {
    setNavigator({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 });
    canShare.mockReturnValue(false);
    await saveFile(zip(), 'Attachments.zip');
    expect(clicked).toEqual(['Attachments.zip']);
    expect(share).not.toHaveBeenCalled();
  });
});
