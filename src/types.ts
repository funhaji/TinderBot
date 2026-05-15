import type { Context } from "grammy";

export type Language = "fa" | "en";

export type SessionState =
  | { state: "idle"; payload?: Record<string, unknown> }
  | { state: "profile_wizard"; payload: ProfileWizardPayload }
  | { state: "discover"; payload: DiscoverPayload }
  | { state: "chat"; payload: ChatPayload }
  | { state: "mystery_wait"; payload: Record<string, unknown> }
  | { state: "mystery_vote"; payload: MysteryVotePayload }
  | { state: "admin_broadcast"; payload: Record<string, unknown> }
  | { state: "admin_find"; payload: Record<string, unknown> }
  | { state: "admin_config_wait"; payload: { section: string } }
  | { state: "admin_msg_edit"; payload: { key: string; step: "fa" | "en"; fa?: string } }
  | { state: "face_verify_wait"; payload: Record<string, unknown> }
  | { state: "admin_diamond_wait"; payload: { mode: "grant" | "deduct" } }
  | { state: "admin_send_user"; payload: { step: "await_telegram" | "await_text"; targetTelegram?: number } }
  | { state: "admin_reward_meta"; payload: Record<string, unknown> }
  | { state: "admin_reward_file"; payload: { minReferrals: number; captionFa: string; captionEn: string } };

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
};

export type ChatPayload = {
  withUserId: number;
  isMystery?: boolean;
  startedAt?: number;
};

export type MysteryVotePayload = {
  partnerId: number;
  enteredAt: number;
  myVote?: "yes" | "no";
};

export type MyContext = Context;
