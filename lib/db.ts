// lib/db.ts — one Mongo client per process, survives Next.js dev reloads.
import { MongoClient, type Db } from "mongodb";

const g = globalThis as unknown as { __tailorMongo?: MongoClient };

export async function db(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (!g.__tailorMongo) {
    g.__tailorMongo = new MongoClient(uri);
    await g.__tailorMongo.connect();
  }
  return g.__tailorMongo.db("hackcmu");
}
