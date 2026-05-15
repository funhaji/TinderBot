import { pool } from "./pool.js";
export async function tx(fn) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const q = (text, values) => client.query(text, values);
        const res = await fn(q);
        await client.query("COMMIT");
        return res;
    }
    catch (err) {
        await client.query("ROLLBACK");
        throw err;
    }
    finally {
        client.release();
    }
}
export async function query(text, values) {
    return pool.query(text, values);
}
