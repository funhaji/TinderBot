import { logger } from "./logger.js";
const LICENSE_URL = "https://taha-dakillswitch.vercel.app/api/status";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
async function isLicenseActive() {
    try {
        const res = await fetch(LICENSE_URL, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok)
            return false;
        const data = (await res.json());
        return data.code === 200 && data.status === "active";
    }
    catch (err) {
        logger.warn({ err }, "killswitch_check_failed");
        return true;
    }
}
export async function checkLicenseOrExit() {
    const active = await isLicenseActive();
    if (!active) {
        logger.fatal("License check failed — shutting down.");
        process.exit(1);
    }
    logger.info("License OK ✓");
}
export function startLicenseWatcher() {
    setInterval(async () => {
        const active = await isLicenseActive();
        if (!active) {
            logger.fatal("License revoked — shutting down.");
            process.exit(1);
        }
    }, CHECK_INTERVAL_MS);
}
