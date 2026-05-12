import { pool } from "./pool.js";

export async function tx<T>(fn: (q: (text: string, values?: unknown[]) => Promise<any>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const q = (text: string, values?: unknown[]) => client.query(text, values as any);
    const res = await fn(q);
    await client.query("COMMIT");
    return res;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function query<T = any>(text: string, values?: unknown[]) {
  return pool.query<T>(text, values as any);
}

