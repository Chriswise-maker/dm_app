import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import * as db from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // For local development, auto-create a local user
    const localUserId = "local-user";
    const localUserName = "Local User";
    
    try {
      // Ensure local user exists in database
      await db.upsertUser({
        openId: localUserId,
        name: localUserName,
        email: null,
        loginMethod: "local",
        lastSignedIn: new Date(),
      });
      
      // Get the user from database
      user = await db.getUserByOpenId(localUserId);
    } catch (dbError) {
      console.error("[Auth] Failed to create local user:", dbError);
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
