import type { Context } from "grammy";
import type { ProfileEditField } from "./ui/profileEdit.js";

export type Language = "fa" | "en";

export type SessionState =
  | { state: "idle"; payload?: Record<string, unknown> }
  | { state: "profile_wizard"; payload: ProfileWizardPayload }
  | { state: "discover_filter"; payload: DiscoverFilterPayload }
  | { state: "discover"; payload: DiscoverPayload }
  | { state: "chat_request"; payload: ChatRequestPayload }
  | { state: "chat"; payload: ChatPayload }
  | { state: "mystery_wait"; payload: Record<string, unknown> }
  | { state: "mystery_vote"; payload: MysteryVotePayload }
  | { state: "admin_broadcast"; payload: Record<string, unknown> }
  | { state: "admin_find"; payload: Record<string, unknown> }
  | { state: "admin_config_wait"; payload: { section: string } }
  | { state: "admin_msg_edit"; payload: { key: string; step: "fa" | "en"; fa?: string } }
  | { state: "admin_diamond_wait"; payload: { mode: "grant" | "deduct" } }
  | { state: "admin_send_user"; payload: { step: "await_telegram" | "await_text"; targetTelegram?: number } }
  | { state: "admin_reward_meta"; payload: Record<string, unknown> }
  | { state: "admin_reward_file"; payload: { minReferrals: number; captionFa: string; captionEn: string } }
  | { state: "admin_start_notify_setup"; payload: Record<string, unknown> }
  | { state: "admin_referral_setting_wait"; payload: { key: string } }
  | { state: "admin_join_lock_add"; payload: Record<string, unknown> }
  | { state: "admin_admin_add"; payload: Record<string, unknown> }
  | { state: "admin_admin_remove"; payload: Record<string, unknown> };

export type ProfileWizardStep =
  | "name"
  | "age_category"
  | "age_pick"
  | "loc_entry"
  | "loc_foreign_country"
  | "loc_foreign_city"
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

export type LookingFor = "friends" | "dating" | "both";

export type ProfileWizardPayload = {
  step: ProfileWizardStep;
  /** True when re-saving an existing profile (skip first-time rewards). */
  editing?: boolean;
  /** When set, only this field is edited then user returns to the glass picker. */
  editField?: ProfileEditField;
  draft: {
    displayName?: string;
    age?: number;
    ageCategory?: "u20" | "20p" | "30p";
    country?: string;
    city?: string;
    provinceKey?: string | null;
    gender?: string | null;
    orientation?: string | null;
    lookingFor?: LookingFor;
    seekGenders?: string[];
    bio?: string;
    personalTraits?: string;
    partnerTraits?: string;
    location?: { lat: number; lon: number } | null;
    interestKeys?: string[];
    photoFileIds?: string[];
  };
};

export type DiscoverPayload = {
  candidates: number[];
  idx: number;
  cardMessageId?: number;
  sub?: "main" | "more";
  filters?: DiscoverFilterPayload;
};

export type DiscoverAgeFilter = "profile" | "near" | "any";
export type DiscoverGenderFilter = "profile" | "any";

export type DiscoverFilterPayload = {
  sameCity: boolean;
  age: DiscoverAgeFilter;
  gender: DiscoverGenderFilter;
};

export type ChatPayload = {
  withUserId: number;
  isMystery?: boolean;
  startedAt?: number;
  lastActivityAt?: number;
};

export type ChatRequestPayload = {
  withUserId: number;
  direction: "incoming" | "outgoing";
  createdAt: number;
};

export type MysteryVotePayload = {
  partnerId: number;
  enteredAt: number;
  myVote?: "yes" | "no";
};

export type MyContext = Context;
