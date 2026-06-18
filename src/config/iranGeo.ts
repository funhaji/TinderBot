/** Normalized country for Iran-based selections */
export const IRAN_COUNTRY_EN = "Iran";

/**
 * Iranian provinces for wizard UI (labels are display-only; logic uses `id`).
 * Order: roughly population / UX grouping, not administrative numbering.
 */
export const IRAN_PROVINCES: readonly { id: string; fa: string; en: string }[] = [
  { id: "tehran", fa: "تهران", en: "Tehran" },
  { id: "alborz", fa: "البرز", en: "Alborz" },
  { id: "isfahan", fa: "اصفهان", en: "Isfahan" },
  { id: "fars", fa: "فارس", en: "Fars" },
  { id: "khuzestan", fa: "خوزستان", en: "Khuzestan" },
  { id: "east_azerbaijan", fa: "آذربایجان شرقی", en: "East Azerbaijan" },
  { id: "west_azerbaijan", fa: "آذربایجان غربی", en: "West Azerbaijan" },
  { id: "mazandaran", fa: "مازندران", en: "Mazandaran" },
  { id: "gilan", fa: "گیلان", en: "Gilan" },
  { id: "kerman", fa: "کرمان", en: "Kerman" },
  { id: "razavi_khorasan", fa: "خراسان رضوی", en: "Razavi Khorasan" },
  { id: "south_khorasan", fa: "خراسان جنوبی", en: "South Khorasan" },
  { id: "north_khorasan", fa: "خراسان شمالی", en: "North Khorasan" },
  { id: "yazd", fa: "یزد", en: "Yazd" },
  { id: "markazi", fa: "مرکزی", en: "Markazi" },
  { id: "hamadan", fa: "همدان", en: "Hamadan" },
  { id: "kermanshah", fa: "کرمانشاه", en: "Kermanshah" },
  { id: "lorestan", fa: "لرستان", en: "Lorestan" },
  { id: "ilam", fa: "ایلام", en: "Ilam" },
  { id: "kurdistan", fa: "کردستان", en: "Kurdistan" },
  { id: "zanjan", fa: "زنجان", en: "Zanjan" },
  { id: "ardabil", fa: "اردبیل", en: "Ardabil" },
  { id: "qazvin", fa: "قزوین", en: "Qazvin" },
  { id: "qom", fa: "قم", en: "Qom" },
  { id: "semnan", fa: "سمنان", en: "Semnan" },
  { id: "golestan", fa: "گلستان", en: "Golestan" },
  { id: "bushehr", fa: "بوشهر", en: "Bushehr" },
  { id: "hormozgan", fa: "هرمزگان", en: "Hormozgan" },
  { id: "chaharmahal_bakhtiari", fa: "چهارمحال و بختیاری", en: "Chaharmahal and Bakhtiari" },
  { id: "sistan_baluchestan", fa: "سیستان و بلوچستان", en: "Sistan and Baluchestan" },
  { id: "kohgiluyeh_boyer", fa: "کهگیلویه و بویراحمد", en: "Kohgiluyeh and Boyer-Ahmad" },
] as const;

export function provinceLabel(id: string, lang: "fa" | "en"): string {
  const row = IRAN_PROVINCES.find((p) => p.id === id);
  if (!row) return id;
  return lang === "fa" ? row.fa : row.en;
}
