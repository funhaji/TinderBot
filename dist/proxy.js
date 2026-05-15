import { logger } from "./logger.js";
function normalizeProxyUrl(raw) {
    const v = raw.trim();
    if (!v)
        return "";
    if (v.startsWith("http://") || v.startsWith("https://"))
        return v;
    // Default to HTTP proxy when scheme is omitted.
    return `http://${v}`;
}
export async function setupProxyFromEnv() {
    const disabled = process.env.DISABLE_PROXY === "1" || process.env.DISABLE_PROXY === "true";
    if (disabled)
        return;
    const raw = process.env.PROXY_URL ?? "127.0.0.1:10808";
    const proxyUrl = normalizeProxyUrl(raw);
    if (!proxyUrl)
        return;
    // global-agent proxies Node's http/https modules; grammY ultimately uses HTTPS requests to Telegram.
    process.env.GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE = "";
    process.env.GLOBAL_AGENT_HTTP_PROXY = proxyUrl;
    process.env.GLOBAL_AGENT_HTTPS_PROXY = proxyUrl;
    const { bootstrap } = await import("global-agent");
    bootstrap();
    const mode = proxyUrl.startsWith("https://") ? "https" : "http";
    logger.info({ proxyUrl, mode }, "proxy_enabled");
}
