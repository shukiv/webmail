"use client";

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { setSaveFileText } from '@/lib/save-file';

/**
 * Gives saveFile's "tap to save" toast (shown on iPhone and iPad when the
 * share sheet needs a fresh tap) the person's language. Renders nothing.
 */
export function SaveFileText() {
  const t = useTranslations('email_viewer');
  useEffect(() => {
    setSaveFileText({ ready: t('save_ready'), save: t('save_file') });
  }, [t]);
  return null;
}
