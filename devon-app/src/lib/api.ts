import { NextResponse } from "next/server";
import { MongoServerSelectionError, MongoNetworkError } from "mongodb";

/** Wraps a route handler so every failure returns JSON with a plain-language message. */
export function withApi<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (e) {
      const err = e as Error;
      if (err instanceof MongoServerSelectionError || err instanceof MongoNetworkError || /ECONNREFUSED|Server selection timed out/i.test(err.message)) {
        return NextResponse.json({ error: "The database is not reachable right now. Check MONGODB_URI and try again." }, { status: 503 });
      }
      console.error("[tailor] unhandled route error:", err);
      return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
    }
  };
}
