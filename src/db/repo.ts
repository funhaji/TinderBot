import type { Language, SessionState } from "../types.js";
import { orientationMutualOk, mysterySoughtGenderMatches, ageWindowOverlaps, seekGenderMatchesProfile } from "../profile/compat.js";
import { query, tx } from "./sql.js";

export type DbUser = {
  id: number;
  telegram_id: number;
  username: string | null;
  language: Language;
  is_banned: boolean;
  diamond_balance: number;
  face_verification_status: string;
  referral_bonus_paid: boolean;
  referred_by: number | null;
  referral_code: string | null;
  badge_verified: boolean;
  badge_vip: boolean;
};

export type ProfilePreferences = {
  looking_for?: "friends" | "dating" | "both";
  age_min?: number;
  age_max?: number;
  seek_genders?: string[] | null;
  discovery_radius_m?: number;
  notify_like?: boolean;
  notify_match?: boolean;
  receive_chat_requests?: boolean;
  receive_direct?: boolean;
  only_verified_can_like_me?: boolean;
  orientation?: string | null;
  personal_traits?: string;
  partner_traits?: string;
  country?: string;
  province_key?: string | null;
  prefer_same_country?: boolean;
};

export type ProfileRow = {
  user_id: number;
  display_name: string;
  age: number;
  city: string;
  bio: string;
  visibility: boolean;
  preferences: ProfilePreferences;
  location_lat: number | null;
  location_lon: number | null;
  gender: string | null;
};

export async function upsertUser(params: {
  telegramId: number;
  username: string | null;
  referredBy?: number | null;
}): Promise<DbUser> {
  const res = await query<DbUser>(
    `
    INSERT INTO users (telegram_id, username, referred_by, last_seen_at)
    VALUES ($1, $2, $3, now())
    ON CONFLICT (telegram_id) DO UPDATE
      SET username = EXCLUDED.username,
          last_seen_at = now(),
          referred_by = COALESCE(users.referred_by, EXCLUDED.referred_by)
    RETURNING id, telegram_id, username, language, is_banned,
      diamond_balance, face_verification_status, referral_bonus_paid, referred_by,
      referral_code, badge_verified, badge_vip
  `,
    [params.telegramId, params.username, params.referredBy ?? null]
  );
  return res.rows[0]!;
}

export async function setLanguage(userId: number, lang: Language) {
  await query(`UPDATE users SET language = $2 WHERE id = $1`, [userId, lang]);
}

export async function getUserByTelegramId(telegramId: number): Promise<DbUser | null> {
  const res = await query<DbUser>(
    `SELECT id, telegram_id, username, language, is_banned,
            diamond_balance, face_verification_status, referral_bonus_paid, referred_by,
            referral_code, badge_verified, badge_vip
     FROM users WHERE telegram_id = $1`,
    [telegramId]
  );
  return res.rows[0] ?? null;
}

export async function getUserById(userId: number): Promise<DbUser | null> {
  const res = await query<DbUser>(
    `SELECT id, telegram_id, username, language, is_banned,
            diamond_balance, face_verification_status, referral_bonus_paid, referred_by,
            referral_code, badge_verified, badge_vip
     FROM users WHERE id = $1`,
    [userId]
  );
  return res.rows[0] ?? null;
}

export async function deleteUser(userId: number) {
  await query(`DELETE FROM users WHERE id = $1`, [userId]);
}

export async function banUser(userId: number, reason: string) {
  await query(
    `UPDATE users SET is_banned = true, banned_at = now(), banned_reason = $2 WHERE id = $1`,
    [userId, reason.slice(0, 500)]
  );
}

export async function unbanUser(userId: number) {
  await query(
    `UPDATE users SET is_banned = false, banned_at = NULL, banned_reason = NULL WHERE id = $1`,
    [userId]
  );
}

export async function countUsers(): Promise<number> {
  const res = await query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM users`);
  return Number(res.rows[0]?.c ?? 0);
}

export async function countMatches(): Promise<number> {
  const res = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM matches WHERE unmatched_at IS NULL`
  );
  return Number(res.rows[0]?.c ?? 0);
}

export async function countOpenReports(): Promise<number> {
  const res = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM reports WHERE status = 'open'`
  );
  return Number(res.rows[0]?.c ?? 0);
}

export async function listTelegramIdsForBroadcast(): Promise<number[]> {
  const res = await query<{ telegram_id: string }>(
    `SELECT telegram_id::text FROM users WHERE is_banned = false ORDER BY id`
  );
  return res.rows.map((r) => Number(r.telegram_id));
}

export async function findMysteryWaitUser(params: {
  excludeUserId: number;
  myGender: string | null;
  myAge: number;
  myCountry: string | null;
  myOrientation: string | null;
  myAgeMin: number;
  myAgeMax: number;
  soughtGender: string | null;
  ageRangeClose: boolean;
  wantSameCountry: boolean;
}): Promise<number | null> {
  return tx(async (q) => {
    const res = await (q as (sql: string, params: unknown[]) => Promise<{ rows: any[] }>)(
      `
      SELECT s.user_id, s.payload, p.gender, p.age,
             LOWER(p.preferences->>'country') AS country,
             p.preferences AS preferences
      FROM sessions s
      JOIN profiles p ON p.user_id = s.user_id
      JOIN users u ON u.id = s.user_id
      WHERE s.state = 'mystery_wait'
        AND s.user_id != $1
        AND u.is_banned = false
        AND s.updated_at > now() - interval '5 minutes'
      ORDER BY s.updated_at ASC
      FOR UPDATE OF s SKIP LOCKED
      LIMIT 40
    `,
      [params.excludeUserId]
    );

    const myCountryNorm = params.myCountry?.toLowerCase().trim() ?? null;

    for (const row of res.rows) {
      const pl = row.payload as {
        soughtGender?: string | null;
        ageRangeClose?: boolean;
        wantSameCountry?: boolean;
      };
      const theirPrefs = (row.preferences ?? {}) as ProfilePreferences;
      const theirSoughtGender = pl.soughtGender ?? null;
      const theirAgeRangeClose = pl.ageRangeClose === true;
      const theirWantSameCountry = pl.wantSameCountry === true;
      const bothWantFastAny =
        !params.soughtGender &&
        !params.ageRangeClose &&
        !params.wantSameCountry &&
        !theirSoughtGender &&
        !theirAgeRangeClose &&
        !theirWantSameCountry;

      if (
        !bothWantFastAny &&
        !orientationMutualOk(params.myOrientation, params.myGender, theirPrefs.orientation ?? null, row.gender)
      ) {
        continue;
      }

      if (
        !bothWantFastAny &&
        !ageWindowOverlaps(
          params.myAge,
          params.myAgeMin,
          params.myAgeMax,
          Number(row.age),
          theirPrefs.age_min,
          theirPrefs.age_max
        )
      ) {
        continue;
      }

      if (!mysterySoughtGenderMatches(params.soughtGender, row.gender)) continue;
      if (!mysterySoughtGenderMatches(theirSoughtGender, params.myGender)) continue;

      const ageDiff = Math.abs(params.myAge - Number(row.age));
      if (params.ageRangeClose && ageDiff > 5) continue;
      if (theirAgeRangeClose && ageDiff > 5) continue;

      const theirCountry = row.country ?? null;
      if (params.wantSameCountry && (myCountryNorm === null || myCountryNorm !== theirCountry)) continue;
      if (theirWantSameCountry && (theirCountry === null || myCountryNorm !== theirCountry)) continue;

      const upd = await (q as (sql: string, params: unknown[]) => Promise<{ rowCount: number }>)(
        `UPDATE sessions SET state='idle', payload='{}'::jsonb, updated_at=now()
         WHERE user_id=$1 AND state='mystery_wait'`,
        [row.user_id]
      );
      if (upd.rowCount === 1) return Number(row.user_id);
    }

    return null;
  });
}

export async function expireMysteryWaitSessions(): Promise<{ userId: number; telegramId: number; language: string }[]> {
  const res = await query<{ user_id: number; telegram_id: string; language: string }>(
    `SELECT s.user_id, u.telegram_id::text, COALESCE(u.language, 'fa') AS language
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.state = 'mystery_wait'
       AND s.updated_at < now() - interval '5 minutes'`,
    []
  );
  if (res.rows.length === 0) return [];
  const ids = res.rows.map((r) => r.user_id);
  await query(
    `UPDATE sessions SET state='idle', payload='{}'::jsonb, updated_at=now()
     WHERE user_id = ANY($1::int[])`,
    [ids]
  );
  return res.rows.map((r) => ({ userId: r.user_id, telegramId: Number(r.telegram_id), language: r.language }));
}

export async function expireMysteryVoteSessions(): Promise<{ userId: number; telegramId: number; language: string; partnerId: number }[]> {
  const res = await query<{ user_id: number; telegram_id: string; language: string; partner_id: number }>(
    `SELECT s.user_id, u.telegram_id::text, COALESCE(u.language, 'fa') AS language,
            (s.payload->>'partnerId')::int AS partner_id
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.state = 'mystery_vote'
       AND s.updated_at < now() - interval '5 minutes'`,
    []
  );
  if (res.rows.length === 0) return [];
  const ids = res.rows.map((r) => r.user_id);
  await query(
    `UPDATE sessions SET state='idle', payload='{}'::jsonb, updated_at=now()
     WHERE user_id = ANY($1::int[])`,
    [ids]
  );
  return res.rows.map((r) => ({
    userId: r.user_id,
    telegramId: Number(r.telegram_id),
    language: r.language,
    partnerId: r.partner_id,
  }));
}

export async function listInactiveMysteryChats(
  cutoffMs: number
): Promise<{ userId: number; telegramId: number; language: string; partnerId: number }[]> {
  const res = await query<{ user_id: number; telegram_id: string; language: string; partner_id: number }>(
    `SELECT s.user_id, u.telegram_id::text, COALESCE(u.language, 'fa') AS language,
            (s.payload->>'withUserId')::int AS partner_id
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.state = 'chat'
       AND s.payload->>'isMystery' = 'true'
       AND (s.payload->>'withUserId') IS NOT NULL
       AND COALESCE(
         (s.payload->>'lastActivityAt')::bigint,
         (s.payload->>'startedAt')::bigint,
         floor(extract(epoch from s.updated_at) * 1000)::bigint
       ) < $1
     ORDER BY s.updated_at ASC`,
    [cutoffMs]
  );
  return res.rows.map((r) => ({
    userId: r.user_id,
    telegramId: Number(r.telegram_id),
    language: r.language,
    partnerId: r.partner_id,
  }));
}

export async function ensureSessionRow(userId: number) {
  await query(
    `
    INSERT INTO sessions (user_id, state, payload)
    VALUES ($1, 'idle', '{}'::jsonb)
    ON CONFLICT (user_id) DO NOTHING
  `,
    [userId]
  );
}

export async function getSession(userId: number): Promise<SessionState> {
  const res = await query<{ state: string; payload: unknown }>(
    `SELECT state, payload FROM sessions WHERE user_id = $1`,
    [userId]
  );
  if (!res.rows[0]) return { state: "idle" };
  const row = res.rows[0];
  return { state: row.state as SessionState["state"], payload: row.payload } as SessionState;
}

export async function setSession(userId: number, s: SessionState) {
  await query(`UPDATE sessions SET state=$2, payload=$3, updated_at=now() WHERE user_id=$1`, [
    userId,
    s.state,
    (s as { payload?: unknown }).payload ?? {},
  ]);
}

export async function resetSession(userId: number) {
  await query(
    `UPDATE sessions SET state='idle', payload='{}'::jsonb, updated_at=now() WHERE user_id=$1`,
    [userId]
  );
}

function rowToProfile(row: Record<string, unknown>): ProfileRow {
  const raw = (row.preferences as ProfilePreferences) ?? {};
  const prefs: ProfilePreferences = {
    ...raw,
    notify_like: raw.notify_like !== false,
    notify_match: raw.notify_match !== false,
    receive_chat_requests: raw.receive_chat_requests !== false,
    receive_direct: raw.receive_direct !== false,
    only_verified_can_like_me: raw.only_verified_can_like_me === true,
  };
  return {
    user_id: Number(row.user_id),
    display_name: String(row.display_name),
    age: Number(row.age),
    city: String(row.city),
    bio: String(row.bio ?? ""),
    visibility: Boolean(row.visibility),
    preferences: prefs,
    location_lat: row.location_lat == null ? null : Number(row.location_lat),
    location_lon: row.location_lon == null ? null : Number(row.location_lon),
    gender: row.gender == null ? null : String(row.gender),
  };
}

export async function getProfile(userId: number): Promise<ProfileRow | null> {
  const res = await query(`SELECT * FROM profiles WHERE user_id=$1`, [userId]);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToProfile(row);
}

export async function upsertProfile(userId: number, p: Omit<ProfileRow, "user_id">) {
  await query(
    `
    INSERT INTO profiles (user_id, display_name, age, city, bio, visibility, preferences, gender, location_lat, location_lon, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,now())
    ON CONFLICT (user_id) DO UPDATE SET
      display_name=EXCLUDED.display_name,
      age=EXCLUDED.age,
      city=EXCLUDED.city,
      bio=EXCLUDED.bio,
      visibility=EXCLUDED.visibility,
      preferences=EXCLUDED.preferences,
      gender=EXCLUDED.gender,
      location_lat=EXCLUDED.location_lat,
      location_lon=EXCLUDED.location_lon,
      updated_at=now()
  `,
    [
      userId,
      p.display_name,
      p.age,
      p.city,
      p.bio,
      p.visibility,
      JSON.stringify(p.preferences ?? {}),
      p.gender,
      p.location_lat,
      p.location_lon,
    ]
  );
}

export async function mergeProfilePreferences(userId: number, patch: ProfilePreferences) {
  const cur = await getProfile(userId);
  const merged = { ...(cur?.preferences ?? {}), ...patch };
  await query(`UPDATE profiles SET preferences = $2::jsonb, updated_at = now() WHERE user_id = $1`, [
    userId,
    JSON.stringify(merged),
  ]);
}

export async function setProfileVisibility(userId: number, visible: boolean) {
  await query(`UPDATE profiles SET visibility = $2, updated_at = now() WHERE user_id = $1`, [
    userId,
    visible,
  ]);
}

export async function replacePhotos(userId: number, fileIds: string[]) {
  await tx(async (q) => {
    await q(`DELETE FROM photos WHERE user_id=$1`, [userId]);
    for (let i = 0; i < fileIds.length; i++) {
      await q(`INSERT INTO photos (user_id, file_id, is_primary) VALUES ($1,$2,$3)`, [
        userId,
        fileIds[i],
        i === 0,
      ]);
    }
  });
}

export async function getPrimaryPhoto(userId: number): Promise<string | null> {
  const res = await query<{ file_id: string }>(
    `SELECT file_id FROM photos WHERE user_id=$1 ORDER BY is_primary DESC, id ASC LIMIT 1`,
    [userId]
  );
  return res.rows[0]?.file_id ?? null;
}

export async function listPhotoFileIds(userId: number): Promise<string[]> {
  const res = await query<{ file_id: string }>(
    `SELECT file_id FROM photos WHERE user_id=$1 ORDER BY is_primary DESC, id ASC`,
    [userId]
  );
  return res.rows.map((r) => r.file_id);
}

export async function setUserInterests(userId: number, keys: string[]) {
  await tx(async (q) => {
    await q(`DELETE FROM user_interests WHERE user_id=$1`, [userId]);
    if (keys.length === 0) return;
    const res = await (q as (sql: string, params: unknown[]) => Promise<{ rows: { id: number; key: string }[] }>)(`SELECT id, key FROM interests WHERE key = ANY($1::text[])`, [keys]);
    for (const r of res.rows) {
      await q(`INSERT INTO user_interests (user_id, interest_id) VALUES ($1,$2)`, [userId, r.id]);
    }
  });
}

export async function listInterests() {
  const res = await query<{ key: string; fa_label: string; en_label: string }>(
    `SELECT key, fa_label, en_label FROM interests ORDER BY key`
  );
  return res.rows;
}

export async function getUserInterestKeys(userId: number): Promise<string[]> {
  const res = await query<{ key: string }>(
    `
    SELECT i.key
    FROM user_interests ui
    JOIN interests i ON i.id = ui.interest_id
    WHERE ui.user_id=$1
  `,
    [userId]
  );
  return res.rows.map((r) => r.key);
}

export async function swipe(params: { swiperId: number; targetId: number; direction: 1 | 2 }) {
  await query(
    `INSERT INTO swipes (swiper_id, target_id, direction) VALUES ($1,$2,$3)
     ON CONFLICT (swiper_id, target_id) DO UPDATE SET direction=EXCLUDED.direction, created_at=now()`,
    [params.swiperId, params.targetId, params.direction]
  );
}

export async function hasLiked(swiperId: number, targetId: number): Promise<boolean> {
  const res = await query<{ direction: number }>(
    `SELECT direction FROM swipes WHERE swiper_id=$1 AND target_id=$2`,
    [swiperId, targetId]
  );
  return res.rows[0]?.direction === 1;
}

export async function ensureMatch(userId1: number, userId2: number): Promise<boolean> {
  const a = Math.min(userId1, userId2);
  const b = Math.max(userId1, userId2);
  const res = await query(`INSERT INTO matches (user_a, user_b) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
    a,
    b,
  ]);
  return res.rowCount === 1;
}

export async function listMatchesFor(userId: number) {
  const res = await query<{ other_id: number; created_at: string }>(
    `
    SELECT
      CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS other_id,
      created_at
    FROM matches
    WHERE unmatched_at IS NULL AND (user_a=$1 OR user_b=$1)
    ORDER BY created_at DESC
    LIMIT 50
  `,
    [userId]
  );
  return res.rows;
}

export async function getTelegramIdByUserId(userId: number): Promise<number | null> {
  const res = await query<{ telegram_id: string }>(
    `SELECT telegram_id::text FROM users WHERE id=$1`,
    [userId]
  );
  return res.rows[0] ? Number(res.rows[0].telegram_id) : null;
}

export async function createReport(params: { reporterId: number; targetId: number; reason: string }) {
  await query(
    `INSERT INTO reports (reporter_id, target_id, reason, status) VALUES ($1,$2,$3,'open')
     ON CONFLICT (reporter_id, target_id) DO UPDATE SET
       reason = EXCLUDED.reason,
       status = 'open',
       resolved_at = NULL,
       resolved_by_telegram = NULL,
       created_at = now()`,
    [params.reporterId, params.targetId, params.reason]
  );
}

export type OpenReportRow = {
  reporter_id: number;
  target_id: number;
  reason: string;
  created_at: string;
};

export async function listOpenReports(limit: number, offset: number): Promise<OpenReportRow[]> {
  const res = await query<OpenReportRow>(
    `
    SELECT reporter_id, target_id, reason, created_at::text
    FROM reports
    WHERE status = 'open'
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `,
    [limit, offset]
  );
  return res.rows;
}

export async function resolveReport(params: {
  reporterId: number;
  targetId: number;
  adminTelegramId: number;
}) {
  await query(
    `
    UPDATE reports
    SET status = 'resolved', resolved_at = now(), resolved_by_telegram = $3
    WHERE reporter_id = $1 AND target_id = $2 AND status = 'open'
  `,
    [params.reporterId, params.targetId, params.adminTelegramId]
  );
}

export async function blockUser(blockerId: number, blockedId: number) {
  await query(
    `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [blockerId, blockedId]
  );
}

export async function isBlockedEitherWay(aId: number, bId: number): Promise<boolean> {
  const res = await query<{ c: string }>(
    `
    SELECT COUNT(*)::text AS c FROM user_blocks
    WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)
  `,
    [aId, bId]
  );
  return Number(res.rows[0]?.c ?? 0) > 0;
}

export async function discoveryCandidates(params: {
  meId: number;
  lat: number | null;
  lon: number | null;
  radiusMeters: number;
  limit: number;
  ageFilter?: "profile" | "near" | "18_25" | "26_35" | "36_plus" | "any";
  ageMin?: number | null;
  ageMax?: number | null;
  genderFilter?: "profile" | "male" | "female" | "other" | "any";
  sameCity?: boolean;
  country?: string | null;
  includeCities?: string[];
  excludeCountries?: string[];
  excludeCities?: string[];
  sameCountry?: boolean;
  verifiedOnly?: boolean;
  photoOnly?: boolean;
  keyword?: string | null;
  interestKeys?: string[];
  recentActivityDays?: number | null;
  lookingForFilter?: "compatible" | "friends" | "dating" | "any";
}): Promise<number[]> {
  const res = await query<{ id: number }>(
    `
    WITH me AS (
      SELECT p.* FROM profiles p WHERE p.user_id = $1
    ),
    already AS (
      SELECT target_id AS id FROM swipes
      WHERE swiper_id = $1
        AND (direction = 1 OR created_at > now() - INTERVAL '30 days')
    ),
    blocked AS (
      SELECT blocked_id AS id FROM user_blocks WHERE blocker_id = $1
      UNION
      SELECT blocker_id AS id FROM user_blocks WHERE blocked_id = $1
    ),
    hidden AS (
      SELECT hidden_id AS id FROM user_permanent_hides WHERE hider_id = $1
    )
    SELECT u.id
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    CROSS JOIN me
    LEFT JOIN already a ON a.id = u.id
    LEFT JOIN blocked bl ON bl.id = u.id
    LEFT JOIN hidden h ON h.id = u.id
    WHERE u.id <> $1
      AND u.is_banned = false
      AND p.visibility = true
      AND a.id IS NULL
      AND bl.id IS NULL
      AND h.id IS NULL
      AND (
        (
          ($4::int IS NOT NULL OR $5::int IS NOT NULL)
          AND p.age >= COALESCE($4::int, 18)
          AND p.age <= COALESCE($5::int, 99)
        )
        OR (
          $4::int IS NULL AND $5::int IS NULL AND $6::text = 'any'
        )
        OR (
          $4::int IS NULL AND $5::int IS NULL AND $6::text = 'near' AND ABS(p.age - me.age) <= 5
        )
        OR (
          $4::int IS NULL AND $5::int IS NULL AND $6::text = '18_25' AND p.age BETWEEN 18 AND 25
        )
        OR (
          $4::int IS NULL AND $5::int IS NULL AND $6::text = '26_35' AND p.age BETWEEN 26 AND 35
        )
        OR (
          $4::int IS NULL AND $5::int IS NULL AND $6::text = '36_plus' AND p.age >= 36
        )
        OR (
          $4::int IS NULL AND $5::int IS NULL AND $6::text = 'profile'
          AND p.age >= COALESCE((me.preferences->>'age_min')::int, 15)
          AND p.age <= COALESCE((me.preferences->>'age_max')::int, 99)
        )
      )
      AND me.age >= COALESCE((p.preferences->>'age_min')::int, 15)
      AND me.age <= COALESCE((p.preferences->>'age_max')::int, 99)
      AND orientation_mutual_ok(
        me.preferences->>'orientation',
        me.gender::text,
        p.preferences->>'orientation',
        p.gender::text
      )
      AND (
        $7::text = 'any'
        OR ($7::text = 'male' AND profile_phys_sex(p.gender::text) = 'm')
        OR ($7::text = 'female' AND profile_phys_sex(p.gender::text) = 'f')
        OR ($7::text = 'other' AND profile_phys_sex(p.gender::text) IS NULL)
        OR (
          me.preferences->'seek_genders' IS NULL
          OR jsonb_typeof(me.preferences->'seek_genders') <> 'array'
          OR jsonb_array_length(COALESCE(me.preferences->'seek_genders', '[]'::jsonb)) = 0
          OR p.gender IS NULL
          OR (
            (me.preferences->'seek_genders' @> '["m"]'::jsonb AND profile_phys_sex(p.gender::text) = 'm')
            OR (me.preferences->'seek_genders' @> '["f"]'::jsonb AND profile_phys_sex(p.gender::text) = 'f')
            OR (me.preferences->'seek_genders' @> '["x"]'::jsonb AND profile_phys_sex(p.gender::text) IS NULL)
          )
        )
      )
      AND (
        p.preferences->'seek_genders' IS NULL
        OR jsonb_typeof(p.preferences->'seek_genders') <> 'array'
        OR jsonb_array_length(COALESCE(p.preferences->'seek_genders', '[]'::jsonb)) = 0
        OR me.gender IS NULL
        OR (
          (p.preferences->'seek_genders' @> '["m"]'::jsonb AND profile_phys_sex(me.gender::text) = 'm')
          OR (p.preferences->'seek_genders' @> '["f"]'::jsonb AND profile_phys_sex(me.gender::text) = 'f')
          OR (p.preferences->'seek_genders' @> '["x"]'::jsonb AND profile_phys_sex(me.gender::text) IS NULL)
        )
      )
      AND (
        $15::text = 'any'
        OR (
          $15::text = 'compatible'
          AND (
            COALESCE(me.preferences->>'looking_for', 'both') = 'both'
            OR COALESCE(p.preferences->>'looking_for', 'both') = 'both'
            OR COALESCE(me.preferences->>'looking_for', 'both') = COALESCE(p.preferences->>'looking_for', 'both')
          )
        )
        OR (
          $15::text = 'friends'
          AND COALESCE(p.preferences->>'looking_for', 'both') IN ('friends', 'both')
        )
        OR (
          $15::text = 'dating'
          AND COALESCE(p.preferences->>'looking_for', 'both') IN ('dating', 'both')
        )
      )
      AND (
        me.location_lat IS NULL OR me.location_lon IS NULL OR p.location_lat IS NULL OR p.location_lon IS NULL
        OR (
          6371000 * acos(
            LEAST(1::float, GREATEST(-1::float,
              cos(radians(me.location_lat::double precision))
              * cos(radians(p.location_lat::double precision))
              * cos(radians(p.location_lon::double precision) - radians(me.location_lon::double precision))
              + sin(radians(me.location_lat::double precision))
              * sin(radians(p.location_lat::double precision))
            ))
          )
        ) <= $3::double precision
      )
      AND (
        $8::boolean = false
        OR COALESCE(me.city, '') = ''
        OR LOWER(COALESCE(p.city, '')) = LOWER(COALESCE(me.city, ''))
      )
      AND (
        $9::boolean = false
        OR COALESCE(me.preferences->>'country', '') = ''
        OR LOWER(COALESCE(p.preferences->>'country', '')) = LOWER(COALESCE(me.preferences->>'country', ''))
      )
      AND (
        $10::text IS NULL
        OR $10::text = ''
        OR LOWER(COALESCE(p.preferences->>'country', '')) = $10::text
      )
      AND (
        COALESCE(array_length($11::text[], 1), 0) = 0
        OR LOWER(COALESCE(p.city, '')) = ANY($11::text[])
      )
      AND (
        COALESCE(array_length($12::text[], 1), 0) = 0
        OR LOWER(COALESCE(p.preferences->>'country', '')) <> ALL($12::text[])
      )
      AND (
        COALESCE(array_length($13::text[], 1), 0) = 0
        OR LOWER(COALESCE(p.city, '')) <> ALL($13::text[])
      )
      AND (
        $14::boolean = false
        OR u.badge_verified = true
      )
      AND (
        $16::int IS NULL
        OR u.last_seen_at > now() - make_interval(days => $16::int)
      )
      AND (
        $17::boolean = false
        OR EXISTS (SELECT 1 FROM photos ph WHERE ph.user_id = u.id)
      )
      AND (
        $18::text IS NULL
        OR $18::text = ''
        OR (
          p.display_name ILIKE '%' || $18::text || '%'
          OR p.bio ILIKE '%' || $18::text || '%'
          OR COALESCE(p.preferences->>'personal_traits', '') ILIKE '%' || $18::text || '%'
          OR COALESCE(p.preferences->>'partner_traits', '') ILIKE '%' || $18::text || '%'
        )
      )
      AND (
        COALESCE(array_length($19::text[], 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM user_interests ui
          JOIN interests i ON i.id = ui.interest_id
          WHERE ui.user_id = u.id
            AND i.key = ANY($19::text[])
        )
      )
    ORDER BY
      CASE
        WHEN COALESCE(me.city, '') != ''
          AND LOWER(COALESCE(p.city, '')) = LOWER(COALESCE(me.city, ''))
        THEN 0 ELSE 1
      END,
      CASE
        WHEN me.location_lat IS NOT NULL AND me.location_lon IS NOT NULL
          AND p.location_lat IS NOT NULL AND p.location_lon IS NOT NULL
        THEN (
          6371000 * acos(
            LEAST(1::float, GREATEST(-1::float,
              cos(radians(me.location_lat::double precision))
              * cos(radians(p.location_lat::double precision))
              * cos(radians(p.location_lon::double precision) - radians(me.location_lon::double precision))
              + sin(radians(me.location_lat::double precision))
              * sin(radians(p.location_lat::double precision))
            ))
          )
        )
        ELSE 1e15::double precision
      END ASC NULLS LAST,
      p.updated_at DESC
    LIMIT $2
  `,
    [
      params.meId,
      params.limit,
      params.radiusMeters,
      params.ageMin ?? null,
      params.ageMax ?? null,
      params.ageFilter ?? "profile",
      params.genderFilter ?? "profile",
      params.sameCity === true,
      params.sameCountry === true,
      params.country?.trim().toLowerCase() || null,
      (params.includeCities ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean),
      (params.excludeCountries ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean),
      (params.excludeCities ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean),
      params.verifiedOnly === true,
      params.lookingForFilter ?? "compatible",
      params.recentActivityDays ?? null,
      params.photoOnly === true,
      params.keyword?.trim() || null,
      (params.interestKeys ?? []).filter(Boolean),
    ]
  );
  return res.rows.map((r) => r.id);
}

export async function listLikersNotMatched(userId: number): Promise<number[]> {
  const res = await query<{ swiper_id: number }>(
    `
    SELECT s.swiper_id
    FROM swipes s
    JOIN profiles me ON me.user_id = $1
    JOIN profiles lik ON lik.user_id = s.swiper_id
    WHERE s.target_id = $1 AND s.direction = 1
      AND orientation_mutual_ok(
        lik.preferences->>'orientation',
        lik.gender::text,
        me.preferences->>'orientation',
        me.gender::text
      )
      AND (
        me.preferences->'seek_genders' IS NULL
        OR jsonb_typeof(me.preferences->'seek_genders') <> 'array'
        OR jsonb_array_length(COALESCE(me.preferences->'seek_genders', '[]'::jsonb)) = 0
        OR lik.gender IS NULL
        OR (
          (me.preferences->'seek_genders' @> '["m"]'::jsonb AND profile_phys_sex(lik.gender::text) = 'm')
          OR (me.preferences->'seek_genders' @> '["f"]'::jsonb AND profile_phys_sex(lik.gender::text) = 'f')
          OR (me.preferences->'seek_genders' @> '["x"]'::jsonb AND profile_phys_sex(lik.gender::text) IS NULL)
        )
      )
      AND (
        lik.preferences->'seek_genders' IS NULL
        OR jsonb_typeof(lik.preferences->'seek_genders') <> 'array'
        OR jsonb_array_length(COALESCE(lik.preferences->'seek_genders', '[]'::jsonb)) = 0
        OR me.gender IS NULL
        OR (
          (lik.preferences->'seek_genders' @> '["m"]'::jsonb AND profile_phys_sex(me.gender::text) = 'm')
          OR (lik.preferences->'seek_genders' @> '["f"]'::jsonb AND profile_phys_sex(me.gender::text) = 'f')
          OR (lik.preferences->'seek_genders' @> '["x"]'::jsonb AND profile_phys_sex(me.gender::text) IS NULL)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM matches m
        WHERE m.unmatched_at IS NULL
          AND (
            (m.user_a = $1 AND m.user_b = s.swiper_id)
            OR (m.user_a = s.swiper_id AND m.user_b = $1)
          )
      )
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = s.swiper_id)
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = s.swiper_id AND b.blocked_id = $1)
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = s.swiper_id AND u.is_banned = false)
    ORDER BY s.created_at DESC
    LIMIT 30
  `,
    [userId]
  );
  return res.rows.map((r) => r.swiper_id);
}

export async function userStats(userId: number): Promise<{
  likesSent: number;
  likesReceived: number;
  matches: number;
}> {
  const likesSent = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM swipes WHERE swiper_id = $1 AND direction = 1`,
    [userId]
  );
  const likesReceived = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM swipes WHERE target_id = $1 AND direction = 1`,
    [userId]
  );
  const matches = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM matches WHERE unmatched_at IS NULL AND (user_a = $1 OR user_b = $1)`,
    [userId]
  );
  return {
    likesSent: Number(likesSent.rows[0]?.c ?? 0),
    likesReceived: Number(likesReceived.rows[0]?.c ?? 0),
    matches: Number(matches.rows[0]?.c ?? 0),
  };
}

export async function hasSwiped(swiperId: number, targetId: number): Promise<boolean> {
  const res = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM swipes WHERE swiper_id = $1 AND target_id = $2`,
    [swiperId, targetId]
  );
  return Number(res.rows[0]?.c ?? 0) > 0;
}

export async function hasMatchBetween(userId: number, otherId: number): Promise<boolean> {
  const a = Math.min(userId, otherId);
  const b = Math.max(userId, otherId);
  const res = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM matches WHERE unmatched_at IS NULL AND user_a = $1 AND user_b = $2`,
    [a, b]
  );
  return Number(res.rows[0]?.c ?? 0) > 0;
}

export async function getSystemSettingBool(key: string, defaultVal: boolean): Promise<boolean> {
  const res = await query<{ value_json: unknown }>(`SELECT value_json FROM system_settings WHERE key = $1`, [key]);
  const v = res.rows[0]?.value_json;
  if (v === true || v === false) return v;
  if (typeof v === "string") return v === "true";
  return defaultVal;
}

export async function getSystemSettingNumber(key: string, defaultVal: number): Promise<number> {
  const res = await query<{ value_json: unknown }>(`SELECT value_json FROM system_settings WHERE key = $1`, [key]);
  const v = res.rows[0]?.value_json;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return defaultVal;
}

export async function getSystemSettingString(key: string, defaultVal: string): Promise<string> {
  const res = await query<{ value_json: unknown }>(`SELECT value_json FROM system_settings WHERE key = $1`, [key]);
  const v = res.rows[0]?.value_json;
  if (typeof v === "string") return v;
  if (v == null) return defaultVal;
  return String(v);
}

export async function getSystemSettingJson<T>(key: string, defaultVal: T): Promise<T> {
  const res = await query<{ value_json: unknown }>(`SELECT value_json FROM system_settings WHERE key = $1`, [key]);
  const v = res.rows[0]?.value_json;
  return (v as T | undefined) ?? defaultVal;
}

export async function setSystemSetting(key: string, value: unknown) {
  await query(
    `INSERT INTO system_settings (key, value_json) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
    [key, JSON.stringify(value)]
  );
}

export async function insertMessageLog(params: {
  direction: "in" | "out";
  userId: number | null;
  telegramUserId: number;
  chatId: number;
  messageId: number | null;
  updateType: string;
  textPreview: string;
  payload?: Record<string, unknown>;
}) {
  const enabled = await getSystemSettingBool("message_logging_enabled", true);
  if (!enabled) return;
  await query(
    `INSERT INTO message_logs (direction, user_id, telegram_user_id, chat_id, message_id, update_type, text_preview, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      params.direction,
      params.userId,
      params.telegramUserId,
      params.chatId,
      params.messageId,
      params.updateType.slice(0, 64),
      params.textPreview.slice(0, 512),
      JSON.stringify(params.payload ?? {}),
    ]
  );
}

export async function pruneMessageLogs() {
  const hours = await getSystemSettingNumber("message_log_retention_hours", 72);
  await query(`DELETE FROM message_logs WHERE created_at < now() - ($1::int * interval '1 hour')`, [hours]);
}

export type MessageLogRow = {
  id: string;
  direction: string;
  user_id: string | null;
  telegram_user_id: string;
  chat_id: string;
  message_id: string | null;
  text_preview: string;
  update_type: string;
  payload: unknown;
  created_at: string;
};

export async function listMessageLogs(limit: number, offset: number): Promise<MessageLogRow[]> {
  const res = await query<MessageLogRow>(
    `
    SELECT id::text, direction, user_id::text, telegram_user_id::text, chat_id::text,
           message_id::text, text_preview, update_type, payload, created_at::text
    FROM message_logs
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `,
    [limit, offset]
  );
  return res.rows;
}

export async function getMessageLogById(id: number): Promise<MessageLogRow | null> {
  const res = await query<MessageLogRow>(
    `SELECT id::text, direction, user_id::text, telegram_user_id::text, chat_id::text,
            message_id::text, text_preview, update_type, payload, created_at::text
     FROM message_logs
     WHERE id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function purgeAllMessageLogs() {
  await query(`DELETE FROM message_logs`);
}

export async function insertProfileImpression(viewerId: number, shownUserId: number) {
  await query(`INSERT INTO profile_impressions (viewer_id, shown_user_id) VALUES ($1, $2)`, [
    viewerId,
    shownUserId,
  ]);
}

export async function addPermanentHide(hiderId: number, hiddenId: number) {
  await query(
    `INSERT INTO user_permanent_hides (hider_id, hidden_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [hiderId, hiddenId]
  );
}

export async function resetUserNopes(userId: number) {
  await query(`DELETE FROM swipes WHERE swiper_id = $1 AND direction = 2`, [userId]);
}

export async function getPendingFaceSubmissionUserId(submissionId: number): Promise<number | null> {
  const res = await query<{ user_id: string }>(
    `SELECT user_id::text FROM face_verification_submissions WHERE id = $1 AND status = 'pending'`,
    [submissionId]
  );
  return res.rows[0] ? Number(res.rows[0].user_id) : null;
}

export async function createFaceSubmission(userId: number, photoFileId: string): Promise<number> {
  await query(
    `UPDATE users SET face_verification_status = 'pending' WHERE id = $1 AND face_verification_status <> 'approved'`,
    [userId]
  );
  const res = await query<{ id: string }>(
    `INSERT INTO face_verification_submissions (user_id, photo_file_id, status) VALUES ($1, $2, 'pending') RETURNING id::text`,
    [userId, photoFileId]
  );
  return Number(res.rows[0]!.id);
}

export async function listPendingFaceSubmissions(limit: number) {
  const res = await query<{
    id: string;
    user_id: string;
    photo_file_id: string;
    created_at: string;
  }>(
    `
    SELECT id::text, user_id::text, photo_file_id, created_at::text
    FROM face_verification_submissions
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT $1
  `,
    [limit]
  );
  return res.rows;
}

export async function approveFaceSubmission(params: {
  submissionId: number;
  reviewerTelegramId: number;
}) {
  await tx(async (q) => {
    const sub = await (q as (sql: string, params: unknown[]) => Promise<{ rows: { user_id: string }[] }>)(`SELECT user_id::text FROM face_verification_submissions WHERE id = $1 AND status = 'pending'`, [params.submissionId]);
    const uid = sub.rows[0] ? Number(sub.rows[0].user_id) : null;
    if (!uid) return;
    await q(
      `UPDATE face_verification_submissions SET status = 'approved', reviewed_at = now(), reviewer_telegram_id = $2 WHERE id = $1`,
      [params.submissionId, params.reviewerTelegramId]
    );
    await q(
      `UPDATE users SET face_verification_status = 'approved', badge_verified = true WHERE id = $1`,
      [uid]
    );
  });
}

export async function rejectFaceSubmission(params: {
  submissionId: number;
  reviewerTelegramId: number;
  reason: string;
}) {
  await tx(async (q) => {
    const sub = await (q as (sql: string, params: unknown[]) => Promise<{ rows: { user_id: string }[] }>)(`SELECT user_id::text FROM face_verification_submissions WHERE id = $1 AND status = 'pending'`, [params.submissionId]);
    const uid = sub.rows[0] ? Number(sub.rows[0].user_id) : null;
    if (!uid) return;
    await q(
      `UPDATE face_verification_submissions SET status = 'rejected', reviewed_at = now(),
       reviewer_telegram_id = $2, reject_reason = $3 WHERE id = $1`,
      [params.submissionId, params.reviewerTelegramId, params.reason.slice(0, 200)]
    );
    await q(
      `UPDATE users SET face_verification_status = 'rejected' WHERE id = $1 AND face_verification_status <> 'approved'`,
      [uid]
    );
  });
}

export async function adjustDiamondBalance(params: {
  userId: number;
  delta: number;
  reason: string;
  adminTelegramId: number | null;
  refJson?: Record<string, unknown>;
}) {
  await tx(async (q) => {
    await q(
      `INSERT INTO diamond_ledger (user_id, delta, reason, ref_json, admin_telegram_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        params.userId,
        params.delta,
        params.reason.slice(0, 120),
        JSON.stringify(params.refJson ?? {}),
        params.adminTelegramId,
      ]
    );
    await q(`UPDATE users SET diamond_balance = diamond_balance + $2 WHERE id = $1`, [
      params.userId,
      params.delta,
    ]);
  });
}

export async function markReferralBonusPaid(userId: number) {
  await query(`UPDATE users SET referral_bonus_paid = true WHERE id = $1`, [userId]);
}

export async function extendedUserStats(userId: number): Promise<{
  impressionsOut: number;
  impressionsIn: number;
  likesSent: number;
  likesReceived: number;
  dislikesSent: number;
  matches: number;
  pickinessPct: number;
  attractivenessPct: number;
  diamonds: number;
}> {
  const io = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM profile_impressions WHERE viewer_id = $1`,
    [userId]
  );
  const ii = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM profile_impressions WHERE shown_user_id = $1`,
    [userId]
  );
  const ls = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM swipes WHERE swiper_id = $1 AND direction = 1`,
    [userId]
  );
  const lr = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM swipes WHERE target_id = $1 AND direction = 1`,
    [userId]
  );
  const ds = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM swipes WHERE swiper_id = $1 AND direction = 2`,
    [userId]
  );
  const m = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM matches WHERE unmatched_at IS NULL AND (user_a = $1 OR user_b = $1)`,
    [userId]
  );
  const d = await query<{ diamond_balance: string }>(
    `SELECT diamond_balance::text FROM users WHERE id = $1`,
    [userId]
  );
  const likesSent = Number(ls.rows[0]?.c ?? 0);
  const dislikesSent = Number(ds.rows[0]?.c ?? 0);
  const denom = likesSent + dislikesSent;
  const pickinessPct = denom > 0 ? Math.round((1000 * dislikesSent) / denom) / 10 : 0;
  const likesReceived = Number(lr.rows[0]?.c ?? 0);
  const impressionsIn = Number(ii.rows[0]?.c ?? 0);
  const attractivenessPct =
    impressionsIn > 0 ? Math.round((10000 * likesReceived) / impressionsIn) / 100 : 0;
  return {
    impressionsOut: Number(io.rows[0]?.c ?? 0),
    impressionsIn,
    likesSent,
    likesReceived,
    dislikesSent,
    matches: Number(m.rows[0]?.c ?? 0),
    pickinessPct,
    attractivenessPct,
    diamonds: Number(d.rows[0]?.diamond_balance ?? 0),
  };
}

export async function listDiamondLedgerTail(userId: number, limit: number) {
  const res = await query<{ delta: string; reason: string; created_at: string }>(
    `SELECT delta::text, reason, created_at::text FROM diamond_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return res.rows;
}

export async function getUserByReferralCode(codeRaw: string): Promise<DbUser | null> {
  const code = codeRaw.trim();
  if (!code) return null;
  const res = await query<DbUser>(
    `SELECT id, telegram_id, username, language, is_banned,
            diamond_balance, face_verification_status, referral_bonus_paid, referred_by,
            referral_code, badge_verified, badge_vip
     FROM users WHERE lower(referral_code) = lower($1) LIMIT 1`,
    [code]
  );
  return res.rows[0] ?? null;
}

export async function socialPairAllowed(aId: number, bId: number): Promise<boolean> {
  const [a, b] = await Promise.all([getProfile(aId), getProfile(bId)]);
  if (!a || !b) return false;
  if (
    !orientationMutualOk(
      a.preferences?.orientation ?? null,
      a.gender,
      b.preferences?.orientation ?? null,
      b.gender
    )
  )
    return false;
  if (!seekGenderMatchesProfile(a.preferences?.seek_genders ?? null, b.gender)) return false;
  if (!seekGenderMatchesProfile(b.preferences?.seek_genders ?? null, a.gender)) return false;
  return true;
}

export async function countReferralsWithProfile(referrerUserId: number): Promise<number> {
  const res = await query<{ c: string }>(
    `
    SELECT COUNT(*)::text AS c
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.referred_by = $1
  `,
    [referrerUserId]
  );
  return Number(res.rows[0]?.c ?? 0);
}

export async function applyReferralMilestonesForReferrer(referrerUserId: number): Promise<{ vip: boolean; verified: boolean }> {
  const n = await countReferralsWithProfile(referrerUserId);
  const vipTh = await getSystemSettingNumber("referral_vip_threshold", 10);
  const verTh = await getSystemSettingNumber("referral_badge_verify_threshold", 10);
  const vip = n >= vipTh;
  const verified = n >= verTh;
  await query(
    `UPDATE users SET badge_vip = $2, badge_verified = $3 WHERE id = $1`,
    [referrerUserId, vip, verified]
  );
  return { vip, verified };
}

export type ReferralFileRewardRow = {
  id: number;
  sort_order: number;
  min_referrals: number;
  caption_fa: string;
  caption_en: string;
  file_id: string;
  created_at: string;
};

export async function listReferralFileRewards(): Promise<ReferralFileRewardRow[]> {
  const res = await query<ReferralFileRewardRow>(
    `SELECT id, sort_order, min_referrals, caption_fa, caption_en, file_id, created_at::text
     FROM referral_file_rewards
     ORDER BY sort_order ASC, min_referrals ASC, id ASC`
  );
  return res.rows;
}

export async function insertReferralFileReward(params: {
  minReferrals: number;
  captionFa: string;
  captionEn: string;
  fileId: string;
  sortOrder?: number;
}): Promise<number> {
  const res = await query<{ id: string }>(
    `INSERT INTO referral_file_rewards (sort_order, min_referrals, caption_fa, caption_en, file_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id::text`,
    [params.sortOrder ?? 0, params.minReferrals, params.captionFa, params.captionEn, params.fileId]
  );
  return Number(res.rows[0]?.id ?? 0);
}

export async function deleteReferralFileReward(id: number) {
  await query(`DELETE FROM referral_file_rewards WHERE id = $1`, [id]);
}

export async function updateUserBadges(params: {
  userId: number;
  verified?: boolean;
  vip?: boolean;
}) {
  const cur = await getUserById(params.userId);
  if (!cur) return;
  await query(
    `UPDATE users
     SET badge_verified = $2,
         badge_vip = $3
     WHERE id = $1`,
    [
      params.userId,
      typeof params.verified === "boolean" ? params.verified : cur.badge_verified,
      typeof params.vip === "boolean" ? params.vip : cur.badge_vip,
    ]
  );
}

export async function listUnclaimedReferralFileRewardsForUser(userId: number): Promise<ReferralFileRewardRow[]> {
  const n = await countReferralsWithProfile(userId);
  const res = await query<ReferralFileRewardRow>(
    `
    SELECT r.id, r.sort_order, r.min_referrals, r.caption_fa, r.caption_en, r.file_id, r.created_at::text
    FROM referral_file_rewards r
    WHERE r.min_referrals <= $2
      AND NOT EXISTS (
        SELECT 1 FROM user_referral_file_claims c
        WHERE c.user_id = $1 AND c.reward_id = r.id
      )
    ORDER BY r.sort_order ASC, r.min_referrals ASC, r.id ASC
  `,
    [userId, n]
  );
  return res.rows;
}

export async function claimReferralFileReward(userId: number, rewardId: number): Promise<boolean> {
  const n = await countReferralsWithProfile(userId);
  const ok = await query<{ id: string }>(
    `SELECT id::text FROM referral_file_rewards WHERE id=$1 AND min_referrals <= $2`,
    [rewardId, n]
  );
  if (!ok.rows[0]) return false;
  const ins = await query(`INSERT INTO user_referral_file_claims (user_id, reward_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
    userId,
    rewardId,
  ]);
  return (ins.rowCount ?? 0) > 0;
}

export type AdminDashboardStats = {
  totalUsers: number;
  activeUsers24h: number;
  chats24h: number;
  mysteryWaiting: number;
  mysteryVote: number;
};

export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  const u = await query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM users`);
  const a = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM users WHERE last_seen_at > now() - interval '24 hours'`
  );
  const m = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM matches WHERE created_at > now() - interval '24 hours'`
  );
  const mw = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM sessions WHERE state = 'mystery_wait'`
  );
  const mv = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM sessions WHERE state = 'mystery_vote'`
  );
  return {
    totalUsers: Number(u.rows[0]?.c ?? 0),
    activeUsers24h: Number(a.rows[0]?.c ?? 0),
    chats24h: Number(m.rows[0]?.c ?? 0),
    mysteryWaiting: Number(mw.rows[0]?.c ?? 0),
    mysteryVote: Number(mv.rows[0]?.c ?? 0),
  };
}

export type DistributionRow = { key: string; c: number };

export async function adminGenderDistribution(): Promise<DistributionRow[]> {
  const res = await query<{ key: string | null; c: string }>(
    `SELECT gender::text AS key, COUNT(*)::text AS c FROM profiles GROUP BY gender ORDER BY COUNT(*) DESC`
  );
  return res.rows.map((r) => ({ key: r.key ?? "null", c: Number(r.c ?? 0) }));
}

export async function adminOrientationDistribution(): Promise<DistributionRow[]> {
  const res = await query<{ key: string | null; c: string }>(
    `SELECT COALESCE(preferences->>'orientation','null') AS key, COUNT(*)::text AS c
     FROM profiles
     GROUP BY 1
     ORDER BY COUNT(*) DESC`
  );
  return res.rows.map((r) => ({ key: r.key ?? "null", c: Number(r.c ?? 0) }));
}
