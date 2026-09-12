import { MongoClient, type Db, type Collection } from "mongodb";
import type { CompanyDoc, ConversationDoc, RunDoc, SourceDoc, ToolDoc } from "./types";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/tailor";

declare global {
  // eslint-disable-next-line no-var
  var __tailorMongo: { client: MongoClient; db: Db; ready: Promise<void> } | undefined;
}

function connect() {
  const uri = process.env.MONGODB_URI || DEFAULT_URI;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  const dbName = (() => {
    try {
      const path = new URL(uri).pathname.replace(/^\//, "");
      return path || "tailor";
    } catch {
      return "tailor";
    }
  })();
  const db = client.db(dbName);
  const ready = (async () => {
    await client.connect();
    await Promise.all([
      db.collection<CompanyDoc>("companies").createIndex({ host: 1 }, { unique: true }),
      db.collection<RunDoc>("runs").createIndex({ companyId: 1, createdAt: -1 }),
      db.collection<SourceDoc>("sources").createIndex({ runId: 1 }),
      db.collection<ToolDoc>("tools").createIndex({ companyId: 1 }),
      db.collection<ConversationDoc>("conversations").createIndex({ toolId: 1 }),
    ]);
  })();
  return { client, db, ready };
}

export async function getDb(): Promise<Db> {
  if (!globalThis.__tailorMongo) globalThis.__tailorMongo = connect();
  await globalThis.__tailorMongo.ready;
  return globalThis.__tailorMongo.db;
}

export async function companies(): Promise<Collection<CompanyDoc>> {
  return (await getDb()).collection<CompanyDoc>("companies");
}
export async function runs(): Promise<Collection<RunDoc>> {
  return (await getDb()).collection<RunDoc>("runs");
}
export async function sources(): Promise<Collection<SourceDoc>> {
  return (await getDb()).collection<SourceDoc>("sources");
}
export async function tools(): Promise<Collection<ToolDoc>> {
  return (await getDb()).collection<ToolDoc>("tools");
}
export async function conversations(): Promise<Collection<ConversationDoc>> {
  return (await getDb()).collection<ConversationDoc>("conversations");
}

export function now(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}
