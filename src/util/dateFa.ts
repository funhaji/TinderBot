import { toJalaali } from "jalaali-js";

export function formatNowFooter(lang: "fa" | "en"): string {
  const d = new Date();
  if (lang === "en") {
    return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" });
  }
  const j = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${j.jy}/${pad(j.jm)}/${pad(j.jd)} ${time}`;
}
