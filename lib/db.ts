// lib/db.ts — one Mongo client per process, survives Next.js dev reloads.
import { MongoClient, type Db } from "mongodb";

const g = globalThis as unknown as { __tailorMongo?: { uri: string; client: MongoClient } };

export async function db(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  // Next.js dev reloads .env.local in place; a changed URI must not keep talking to the old server.
  if (g.__tailorMongo && g.__tailorMongo.uri !== uri) {
    // The entry may predate this shape (a bare client left by an older build across a hot reload): close whichever it is.
    const stale = g.__tailorMongo as unknown as { client?: MongoClient } & Partial<MongoClient>;
    const client = stale.client ?? (stale as MongoClient);
    if (typeof client.close === "function") client.close().catch(() => undefined);
    g.__tailorMongo = undefined;
  }
  if (!g.__tailorMongo) {
    const client = new MongoClient(uri);
    await client.connect();
    g.__tailorMongo = { uri, client };
  }
  return g.__tailorMongo.client.db("hackcmu");
}
