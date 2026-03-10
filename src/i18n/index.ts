import translations, { type Locale, DEFAULT_LOCALE, SUPPORTED_LOCALES } from './translations';

/**
 * Detect locale from Accept-Language header.
 * Falls back to DEFAULT_LOCALE ('en') if no match.
 */
export function detectLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  // Parse Accept-Language: "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7"
  const languages = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, qPart] = part.trim().split(';');
      const q = qPart ? parseFloat(qPart.replace('q=', '')) : 1.0;
      return { tag: tag.trim().toLowerCase(), q };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of languages) {
    // Try exact match first (e.g., "it", "fr")
    const short = tag.split('-')[0] as Locale;
    if (SUPPORTED_LOCALES.includes(short)) {
      return short;
    }
  }

  return DEFAULT_LOCALE;
}

/**
 * Create a translation function bound to a specific locale.
 * Returns the translated string, falling back to English, then the key itself.
 */
export function createT(locale: Locale): (key: string) => string {
  const dict = translations[locale] ?? translations[DEFAULT_LOCALE];
  const fallback = translations[DEFAULT_LOCALE];

  return (key: string) => dict[key] ?? fallback[key] ?? key;
}

export { type Locale, DEFAULT_LOCALE, SUPPORTED_LOCALES };
