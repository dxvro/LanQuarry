import type { ReactNode } from 'react';
import { LANGS, LANGUAGE_NAMES, useI18n, type Lang } from '../i18n';
import { cx, Section } from './ui';

// Compact language select; its accessible name is bilingual so it can be found before the language is understood.
export function LanguageSwitcher({ className }: { className?: string }): ReactNode {
  const { lang, setLang, t } = useI18n();
  return (
    <select
      aria-label={t.shell.languageLabel}
      title={t.shell.languageLabel}
      value={lang}
      onChange={(event) => setLang(event.target.value as Lang)}
      className={cx('input w-auto min-h-9 py-1 pr-8 text-sm', className)}
    >
      {LANGS.map((code) => (
        <option key={code} value={code} lang={code}>
          {LANGUAGE_NAMES[code]}
        </option>
      ))}
    </select>
  );
}

export function LanguageSection(): ReactNode {
  const { t } = useI18n();
  return (
    <Section title={t.shell.languageTitle} description={t.shell.languageDescription}>
      <div className="space-y-2">
        <LanguageSwitcher />
        <p className="hint">{t.shell.languageNote}</p>
      </div>
    </Section>
  );
}
