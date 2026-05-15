import type { Language } from "../types.js";

/** Stored profile gender values (English, normalized). Legacy m/f/x kept. */
export const GENDER_VALUES = [
  "boy",
  "girl",
  "trans_boy",
  "trans_girl",
  "nb_male",
  "nb_female",
  "m",
  "f",
  "x",
] as const;
export type ProfileGender = (typeof GENDER_VALUES)[number] | null;

export type PhysSex = "m" | "f" | null;

export function physSexFromGender(gender: string | null | undefined): PhysSex {
  if (!gender) return null;
  switch (gender) {
    case "m":
    case "boy":
    case "trans_boy":
    case "nb_male":
      return "m";
    case "f":
    case "girl":
    case "trans_girl":
    case "nb_female":
      return "f";
    default:
      return null;
  }
}

export type EffectiveOrientation = "straight" | "gay" | "lesbian" | "any";

export function effectiveOrientation(orientation: string | null | undefined, gender: string | null | undefined): EffectiveOrientation {
  const o = orientation?.trim() || "";
  if (!o || o === "skip") return "any";
  if (o === "bi" || o === "bisexual" || o === "other") return "any";
  const p = physSexFromGender(gender);
  if (o === "gay") {
    if (p === "m") return "gay";
    if (p === "f") return "lesbian";
    return "any";
  }
  if (o === "lesbian") return "lesbian";
  if (o === "straight") return "straight";
  return "any";
}

/** One-way: does `viewer` accept `target` presentation for dating/match filters */
export function orientationAcceptsViewer(
  viewerOrientationEff: EffectiveOrientation,
  viewerPhys: PhysSex,
  targetPhys: PhysSex
): boolean {
  if (viewerOrientationEff === "any") return true;
  if (viewerOrientationEff === "straight") {
    if (viewerPhys === "m" && targetPhys === "f") return true;
    if (viewerPhys === "f" && targetPhys === "m") return true;
    if (viewerPhys == null || targetPhys == null) return true;
    return false;
  }
  if (viewerOrientationEff === "gay") {
    if (viewerPhys === "m" && targetPhys === "m") return true;
    if (viewerPhys == null || targetPhys == null) return true;
    return false;
  }
  if (viewerOrientationEff === "lesbian") {
    if (viewerPhys === "f" && targetPhys === "f") return true;
    if (viewerPhys == null || targetPhys == null) return true;
    return false;
  }
  return true;
}

export function orientationMutualOk(
  aOrientation: string | null | undefined,
  aGender: string | null | undefined,
  bOrientation: string | null | undefined,
  bGender: string | null | undefined
): boolean {
  const ao = effectiveOrientation(aOrientation, aGender);
  const bo = effectiveOrientation(bOrientation, bGender);
  const ap = physSexFromGender(aGender);
  const bp = physSexFromGender(bGender);
  return orientationAcceptsViewer(ao, ap, bp) && orientationAcceptsViewer(bo, bp, ap);
}

export function seekGenderMatchesProfile(seek: string[] | null | undefined, targetGender: string | null | undefined): boolean {
  const set = seek?.filter(Boolean) ?? [];
  if (set.length === 0) return true;
  const tp = physSexFromGender(targetGender);
  if (tp === "m" && set.includes("m")) return true;
  if (tp === "f" && set.includes("f")) return true;
  if (tp === null && set.includes("x")) return true;
  return false;
}

export function mysterySoughtGenderMatches(sought: string | null | undefined, targetGender: string | null | undefined): boolean {
  if (!sought || sought === "any") return true;
  const p = physSexFromGender(targetGender);
  if (sought === "m") return p === "m";
  if (sought === "f") return p === "f";
  if (sought === "x") return p === null;
  return true;
}

export function ageWindowOverlaps(
  aAge: number,
  aMin: number | undefined,
  aMax: number | undefined,
  bAge: number,
  bMin: number | undefined,
  bMax: number | undefined
): boolean {
  const amin = typeof aMin === "number" && Number.isFinite(aMin) ? aMin : 15;
  const amax = typeof aMax === "number" && Number.isFinite(aMax) ? aMax : 99;
  const bmin = typeof bMin === "number" && Number.isFinite(bMin) ? bMin : 15;
  const bmax = typeof bMax === "number" && Number.isFinite(bMax) ? bMax : 99;
  return aAge >= bmin && aAge <= bmax && bAge >= amin && bAge <= amax;
}

export function genderLabel(lang: Language, g: string | null | undefined): string {
  if (!g) return "—";
  const map: Record<string, { fa: string; en: string }> = {
    m: { fa: "مرد", en: "Male" },
    f: { fa: "زن", en: "Female" },
    x: { fa: "سایر", en: "Other" },
    boy: { fa: "پسر", en: "Boy" },
    girl: { fa: "دختر", en: "Girl" },
    trans_boy: { fa: "ترنس پسر", en: "Trans boy" },
    trans_girl: { fa: "ترنس دختر", en: "Trans girl" },
    nb_male: { fa: "نون‌باینری (مرد جسم)", en: "Non-binary (physically male)" },
    nb_female: { fa: "نون‌باینری (زن جسم)", en: "Non-binary (physically female)" },
  };
  const row = map[g];
  return row ? (lang === "fa" ? row.fa : row.en) : g;
}

export function orientationLabel(lang: Language, o: string | null | undefined): string {
  if (!o || o === "skip") return "—";
  const map: Record<string, { fa: string; en: string }> = {
    straight: { fa: "مستقیم", en: "Straight" },
    gay: { fa: "همجنس‌گرا (مرد)", en: "Gay" },
    lesbian: { fa: "لزبین", en: "Lesbian" },
    bi: { fa: "دوجنس‌گرا", en: "Bisexual" },
    bisexual: { fa: "دوجنس‌گرا", en: "Bisexual" },
    other: { fa: "سایر", en: "Other" },
  };
  const row = map[o];
  return row ? (lang === "fa" ? row.fa : row.en) : o;
}
