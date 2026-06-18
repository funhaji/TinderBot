import { InlineKeyboard } from "grammy";
import type { Language, ProfileWizardStep } from "../types.js";
import { t } from "../i18n/index.js";
import { cb } from "./keyboards.js";

export type ProfileEditField =
  | "name"
  | "age"
  | "gender"
  | "orientation"
  | "looking_for"
  | "seek_genders"
  | "location"
  | "bio"
  | "personal_traits"
  | "partner_traits"
  | "interests"
  | "photos";

const FIELD_I18N: Record<ProfileEditField, string> = {
  name: "profile.editField.name",
  age: "profile.editField.age",
  gender: "profile.editField.gender",
  orientation: "profile.editField.orientation",
  looking_for: "profile.editField.lookingFor",
  seek_genders: "profile.editField.seekGenders",
  location: "profile.editField.location",
  bio: "profile.editField.bio",
  personal_traits: "profile.editField.personalTraits",
  partner_traits: "profile.editField.partnerTraits",
  interests: "profile.editField.interests",
  photos: "profile.editField.photos",
};

const FIELD_START: Record<ProfileEditField, ProfileWizardStep> = {
  name: "name",
  age: "age_category",
  gender: "gender",
  orientation: "orientation",
  looking_for: "looking_for",
  seek_genders: "seek_genders",
  location: "loc_entry",
  bio: "bio",
  personal_traits: "personal_traits",
  partner_traits: "partner_traits",
  interests: "interests",
  photos: "photos",
};

const FIELD_COMPLETE: Record<ProfileEditField, ProfileWizardStep> = {
  name: "name",
  age: "age_pick",
  gender: "gender",
  orientation: "orientation",
  looking_for: "looking_for",
  seek_genders: "seek_genders",
  location: "location",
  bio: "bio",
  personal_traits: "personal_traits",
  partner_traits: "partner_traits",
  interests: "interests",
  photos: "photos",
};

export function profileEditStartStep(field: ProfileEditField): ProfileWizardStep {
  return FIELD_START[field];
}

export function shouldCompleteSingleFieldEdit(
  editField: ProfileEditField | undefined,
  completedStep: ProfileWizardStep
): boolean {
  if (!editField) return false;
  return FIELD_COMPLETE[editField] === completedStep;
}

function glassLabel(lang: Language, field: ProfileEditField): string {
  return `▫️ ${t(lang, FIELD_I18N[field])} ▫️`;
}

export function profileEditGlassKeyboard(lang: Language) {
  const kb = new InlineKeyboard();
  const row1: ProfileEditField[] = ["name", "age", "gender"];
  const row2: ProfileEditField[] = ["orientation", "looking_for", "seek_genders"];
  const row3: ProfileEditField[] = ["location", "bio", "personal_traits"];
  const row4: ProfileEditField[] = ["partner_traits", "interests", "photos"];

  for (const fields of [row1, row2, row3, row4]) {
    for (const f of fields) {
      kb.text(glassLabel(lang, f), cb.profileEditField(f));
    }
    kb.row();
  }
  kb.text(t(lang, "profile.editBack"), cb.profileEditBack);
  return kb;
}
