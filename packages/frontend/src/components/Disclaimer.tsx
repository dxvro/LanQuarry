import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { de } from '../i18n/locales/de';
import { cx } from './ui';

// The German wording (kept for tests and as the reference text); the component shows the active language.
export const DISCLAIMER = de.common.disclaimer;

export function Disclaimer({ className }: { className?: string }): ReactNode {
  const { t } = useI18n();
  return <p className={cx('text-xs leading-snug text-faint', className)}>{t.common.disclaimer}</p>;
}
