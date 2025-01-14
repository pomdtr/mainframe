import { inferAsyncReturnType } from "@trpc/server";
import { CreateExpressContextOptions } from "@trpc/server/adapters/express";

export interface UserInfo {
  id: string;
  email?: string;
  name?: string;
}

export interface CreateContextHooks {
  trpcGetUserId?: ({
    req,
    res,
  }: CreateExpressContextOptions) =>
    | Promise<string | undefined>
    | string
    | undefined;
  trpcGetUserInfo?: ({
    req,
    res,
  }: CreateExpressContextOptions) =>
    | Promise<UserInfo | undefined>
    | UserInfo
    | undefined;
  getApiKey?: (
    userId: string | undefined,
  ) => Promise<string | undefined> | string | undefined;
}

export function createContext(hooks: CreateContextHooks) {
  return async ({ req, res }: CreateExpressContextOptions) => {
    return {
      req,
      res,
      user: await hooks.trpcGetUserInfo?.({ req, res }),
      db: req.db,
      hooks,
    };
  };
}

export type Context = inferAsyncReturnType<ReturnType<typeof createContext>>;
