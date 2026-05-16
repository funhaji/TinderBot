import { config } from "../config.js";
import { getSystemSettingJson, setSystemSetting } from "../db/repo.js";

const dynamicAdminIds = new Set<number>();

function normalizeAdminIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0);
}

export async function refreshPanelAdminCache(): Promise<number[]> {
  const ids = normalizeAdminIds(await getSystemSettingJson<unknown>("panel_admin_ids", []));
  dynamicAdminIds.clear();
  for (const id of ids) dynamicAdminIds.add(id);
  return ids;
}

export async function listDynamicPanelAdminIds(): Promise<number[]> {
  if (dynamicAdminIds.size === 0) await refreshPanelAdminCache();
  return Array.from(dynamicAdminIds).sort((a, b) => a - b);
}

async function saveDynamicAdminIds() {
  await setSystemSetting("panel_admin_ids", Array.from(dynamicAdminIds).sort((a, b) => a - b));
}

export async function addPanelAdminId(telegramId: number): Promise<void> {
  dynamicAdminIds.add(telegramId);
  await saveDynamicAdminIds();
}

export async function removePanelAdminId(telegramId: number): Promise<void> {
  dynamicAdminIds.delete(telegramId);
  await saveDynamicAdminIds();
}

export function isPanelAdmin(telegramId: number | undefined): boolean {
  if (telegramId == null) return false;
  if (config.adminTelegramIdSet.has(telegramId)) return true;
  if (dynamicAdminIds.has(telegramId)) return true;
  if (config.ownerTelegramId > 0 && telegramId === config.ownerTelegramId) return true;
  return false;
}

export function panelAdminTelegramIds(): number[] {
  const ids = new Set(config.adminTelegramIdSet);
  for (const id of dynamicAdminIds) ids.add(id);
  if (config.ownerTelegramId > 0) ids.add(config.ownerTelegramId);
  return Array.from(ids) as number[];
}
