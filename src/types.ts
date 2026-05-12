import type { Context } from "grammy";

export type Language = "fa" | "en";

export type SessionState =
  | { state: "idle"; payload?: Record<string, unknown> }
  | { state: "profile_wizard"; payload: ProfileWizardPayload }
  | { state: "discover"; payload: DiscoverPayload }
  | { state: "chat"; payload: ChatPayload }
  | { state: "admin_broadcast"; payload: Record<string, unknown> }
  | { state: "admin_find"; payload: Record<string, unknown> }
  | { state: "admin_config_wait"; payload: { section: string } }
  | { state: "face_verify_wait"; payload: Record<string, unknown> }
  | { state: "admin_diamond_wait"; payload: { mode: "grant" | "deduct" } };

export type ProfileWizardStep =
  | "name"
  | "age"
  | "city"
  | "gender"
  | "looking_for"
  | "seek_genders"
  | "location"
  | "bio"
  | "interests"
  | "photos";

export type LookingFor = "friends" | "dating" | "both";

export type ProfileWizardPayload = {
  step: ProfileWizardStep;
  draft: {
    displayName?: string;
    age?: number;
    city?: string;
    gender?: string | null;
    lookingFor?: LookingFor;
    seekGenders?: string[];
    bio?: string;
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
};

export type MyContext = Context;
