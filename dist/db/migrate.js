import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";
import { query, tx } from "./sql.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, "migrations");
async function ensureMigrationsTable() {
    await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}
async function appliedSet() {
    const res = await query("SELECT id FROM schema_migrations");
    return new Set(res.rows.map((r) => r.id));
}
function isSqlFile(name) {
    return /^\d+_.+\.sql$/.test(name);
}
export async function migrateUp() {
    await ensureMigrationsTable();
    const applied = await appliedSet();
    const files = (await readdir(MIGRATIONS_DIR)).filter(isSqlFile).sort();
    for (const file of files) {
        if (applied.has(file))
            continue;
        const full = path.join(MIGRATIONS_DIR, file);
        const sql = await readFile(full, "utf8");
        logger.info({ file }, "Applying migration");
        await tx(async (q) => {
            await q(sql);
            await q("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
        });
    }
    logger.info("Migrations complete");
}
if (import.meta.url === `file://${process.argv[1]}`) {
    migrateUp().catch((err) => {
        logger.fatal({ err }, "Migration failed");
        process.exitCode = 1;
    });
}
