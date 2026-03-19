export const SUPPORTED_LANGUAGES = {
  zh: 'Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  de: 'German',
  fr: 'French',
  ru: 'Russian',
  pt: 'Portuguese',
  es: 'Spanish',
  it: 'Italian',
  he: 'Hebrew',
  ar: 'Arabic',
  da: 'Danish',
  el: 'Greek',
  fi: 'Finnish',
  hi: 'Hindi',
  ms: 'Malay',
  nl: 'Dutch',
  no: 'Norwegian',
  pl: 'Polish',
  sv: 'Swedish',
  sw: 'Swahili',
  tr: 'Turkish',
} as const;

export type LanguageCode = keyof typeof SUPPORTED_LANGUAGES;
export type TranscriptionLanguageCode = LanguageCode | 'auto';

export const LANGUAGE_CODES = Object.keys(SUPPORTED_LANGUAGES) as LanguageCode[];

export const LANGUAGE_OPTIONS = LANGUAGE_CODES.map((code) => ({
  value: code,
  label: SUPPORTED_LANGUAGES[code],
}));

export const TRANSCRIPTION_LANGUAGE_OPTIONS: Array<{
  value: TranscriptionLanguageCode;
  label: string;
}> = [{ value: 'auto', label: 'Auto-detect' }, ...LANGUAGE_OPTIONS];

export function getLanguageLabel(language: string): string {
  return SUPPORTED_LANGUAGES[language as LanguageCode] ?? language;
}
