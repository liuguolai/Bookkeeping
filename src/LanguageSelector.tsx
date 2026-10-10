import { isLocale, languageNames, locales, setLocale, t, useLocale } from './i18n';

export function LanguageSelector() {
  const locale = useLocale();
  return (
    <label className="language-selector">
      <span>{t('界面语言')}</span>
      <select
        aria-label="语言 / Language"
        value={locale}
        onChange={(event) => {
          if (isLocale(event.target.value)) setLocale(event.target.value);
        }}
      >
        {locales.map((value) => (
          <option key={value} value={value}>
            {languageNames[value]}
          </option>
        ))}
      </select>
    </label>
  );
}
