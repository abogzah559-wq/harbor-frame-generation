// Harbor is Arabic only. "en" stays in the type for old saved settings,
// which are read and then switched to Arabic.
export type UiLanguage = "en" | "ar" | "pt";

export type LanguageOption = {
  code: UiLanguage;
  label: string;
  nativeLabel: string;
  rtl: boolean;
};

export const LANGUAGES: LanguageOption[] = [
  { code: "ar", label: "Arabic", nativeLabel: "العربية", rtl: true },
];

export function isRtl(_lang: UiLanguage): boolean {
  return true;
}
