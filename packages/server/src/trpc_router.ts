import { TRPCError, initTRPC } from "@trpc/server";
import {
  datasetsTable,
  objectsTable,
  rowsTable,
  sessionsTable,
  tablesTable,
  zDatasetInsert,
  zDatasetPatch,
  ClientIntegration,
  componentsTable,
} from "@mainframe-so/shared";
import { z } from "zod";
import { Context } from "./trpc_context";
import { and, eq } from "drizzle-orm";
import { syncDataset, syncObject, syncTable } from "./sync";
import {
  commitSession,
  destroySession,
  getSessionFromCookies,
} from "./sessions.server";
import {
  createClientIntegration,
  getDatasetObject,
  getDatasetTable,
  getIntegrationForDataset,
} from "./lib/integrations";
import { deserializeData } from "./utils/serialization";
import { ROW_LIMIT } from "./utils/constants";
import { createUserAccount, validateUserAccount } from "./lib/auth.server";
import { checkIfUserExists } from "./db/helpers";
import { github } from "./lib/integrations/github";
import { network } from "./lib/integrations/network";
import { peloton } from "./lib/integrations/peloton";
import { posthog } from "./lib/integrations/posthog";
import { toggl } from "./lib/integrations/toggl";
import { google } from "./lib/integrations/google";
import { zotero } from "./lib/integrations/zotero";
import { notion } from "./lib/integrations/notion";
import { oura } from "./lib/integrations/oura";
import { env } from "./lib/env.server";
import { nango } from "./lib/nango";
import * as Sentry from "@sentry/node";
import { getTokenFromDataset } from "./lib/integration-token";
import { spotify } from "./lib/integrations/spotify";

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context>().create();

// const t = initTRPC.context().create();
const sentryMiddleware = t.middleware(
  Sentry.Handlers.trpcMiddleware({
    // attachRpcInput: true, // defaults to false
  }),
);

const procedure = t.procedure.use(sentryMiddleware);

const router = t.router;

async function getUserIdFromCtx(ctx: Context) {
  if (ctx.userId) {
    return { userId: ctx.userId, trpcAccess: true };
  }

  if (env.VITE_AUTH_PASS) {
    // When self-hosting, only "admin" sessions can use the trpc endpoints.
    const session = await getSessionFromCookies(
      ctx.db,
      ctx.req.header("cookie"),
    );
    const userId = session.data.userId;
    return { userId, trpcAccess: session.data.type === "admin" };
  }

  return {
    userId: undefined,
    trpcAccess: false,
  };
}

const isAuthed = t.middleware(async (opts) => {
  const { ctx } = opts;

  let { userId, trpcAccess } = await getUserIdFromCtx(ctx);

  if (!userId || !trpcAccess) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return opts.next({
    ctx: {
      ...ctx,
      userId,
    },
  });
});

export const protectedProcedure = procedure.use(isAuthed);

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const appRouter = router({
  authEnabled: procedure.query(async ({}) => {
    return {
      pass: { enabled: env.VITE_AUTH_PASS },
      link:
        env.AUTH_LOGIN_URL && env.AUTH_LOGOUT_URL
          ? {
              enabled: true as const,
              loginUrl: env.AUTH_LOGIN_URL,
              logoutUrl: env.AUTH_LOGOUT_URL,
            }
          : { enabled: false as const },
    };
  }),

  // Auth
  authInfo: procedure.query(async ({ ctx }) => {
    const hasUsers = env.VITE_AUTH_PASS
      ? await checkIfUserExists(ctx.db)
      : false;

    const { userId } = await getUserIdFromCtx(ctx);

    const isLoggedIn = !!userId;

    return {
      hasUsers,
      isLoggedIn,
    };
  }),
  login: procedure
    .input(
      z.object({
        username: z.string().nonempty(),
        password: z.string().nonempty(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!env.VITE_AUTH_PASS) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "This Mainframe instance doesn't support username/password authentication",
        });
      }

      const { username, password } = input;

      const account = await validateUserAccount(ctx.db, username, password);

      if (!account) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid username/password",
        });
      }

      // Don't pass the cookie header here, because we always want a fresh session
      const session = await getSessionFromCookies(ctx.db);

      session.data.userId = account.id;

      ctx.res.appendHeader("Set-Cookie", await commitSession(session, ctx.db));

      return {
        redirect: "/",
      };
    }),
  signup: procedure
    .input(
      z.object({
        username: z.string().nonempty(),
        password: z.string().nonempty(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!env.VITE_AUTH_PASS) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "This Mainframe instance doesn't support username/password authentication",
        });
      }

      const hasUsers = await checkIfUserExists(ctx.db);

      if (hasUsers) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only one user can be created, please login",
        });
      }

      const { username, password } = input;

      // TODO: This can fail if the username already exists
      const account = await createUserAccount(ctx.db, username, password);

      // Don't pass the cookie header here, because we always want a fresh session
      const session = await getSessionFromCookies(ctx.db);

      session.data.userId = account.id;

      ctx.res.appendHeader("Set-Cookie", await commitSession(session, ctx.db));

      return {
        redirect: "/",
      };
    }),
  logout: procedure.mutation(async ({ ctx }) => {
    let hasUsers = false;

    if (env.VITE_AUTH_PASS) {
      try {
        const session = await getSessionFromCookies(
          ctx.db,
          ctx.req.header("Cookie"),
        );

        hasUsers = await checkIfUserExists(ctx.db);

        ctx.res.appendHeader(
          "Set-Cookie",
          await destroySession(session, ctx.db),
        );
      } catch (e) {
        console.error(e);
      }
    }

    if (ctx.userId && env.AUTH_LOGOUT_URL) {
      return {
        redirect: env.AUTH_LOGOUT_URL,
      };
    }

    return {
      redirect: hasUsers ? "/login" : "/setup",
    };
  }),

  // Dataset
  datasetsAll: protectedProcedure.query(async ({ ctx }) => {
    const datasets = await ctx.db.select().from(datasetsTable);
    return datasets;
  }),
  datasetsGet: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const [dataset] = await ctx.db
        .select()
        .from(datasetsTable)
        .where(eq(datasetsTable.id, input.id))
        .limit(1);

      if (!dataset) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return dataset;
    }),
  datasetsCreate: protectedProcedure
    .input(zDatasetInsert)
    .mutation(async ({ input, ctx }) => {
      const [dataset] = await ctx.db
        .insert(datasetsTable)
        .values(input)
        .returning();

      if (!dataset) {
        throw new TRPCError({ code: "CONFLICT" });
      }

      void syncDataset(ctx.db, dataset).catch((e) => console.error(e));

      return dataset;
    }),
  datasetsUpdate: protectedProcedure
    .input(z.object({ id: z.string(), patch: zDatasetPatch }))
    .mutation(async ({ input, ctx }) => {
      const [dataset] = await ctx.db
        .update(datasetsTable)
        .set(input.patch)
        .where(eq(datasetsTable.id, input.id))
        .returning();

      if (!dataset) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      void syncDataset(ctx.db, dataset).catch((e) => console.error(e));

      return dataset;
    }),
  datasetsDelete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.delete(datasetsTable).where(eq(datasetsTable.id, input.id));
    }),

  // Object

  getObjectAndDataset: protectedProcedure
    .input(
      z.object({
        datasetId: z.string().optional(),
        objectType: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { datasetId, objectType } = input;

      if (!datasetId || !objectType) {
        // TODO: Review
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      let [[dataset], [object]] = await Promise.all([
        ctx.db
          .select()
          .from(datasetsTable)
          .where(eq(datasetsTable.id, datasetId))
          .limit(1),
        ctx.db
          .select()
          .from(objectsTable)
          .where(
            and(
              eq(objectsTable.objectType, objectType),
              eq(objectsTable.datasetId, datasetId),
            ),
          )
          .limit(1),
      ]);

      const objectDefinition = getDatasetObject(dataset, objectType);

      if (!object) {
        if (objectDefinition)
          await syncObject(ctx.db, dataset, objectDefinition);

        [object] = await ctx.db
          .select()
          .from(objectsTable)
          .where(
            and(
              eq(objectsTable.objectType, objectType),
              eq(objectsTable.datasetId, datasetId),
            ),
          )
          .limit(1);
        console.log("after another select for some reason");
      }

      if (!object) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return {
        object: {
          ...deserializeData(object),
          name: objectDefinition?.name || object.objectType,
        },
        dataset,
      };
    }),

  // Table
  tablesPageLoader: protectedProcedure
    .input(
      z.object({
        datasetId: z.string().optional(),
        tableId: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { datasetId, tableId } = input;
      if (!datasetId || !tableId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const [dataset] = await ctx.db
        .select()
        .from(datasetsTable)
        .where(eq(datasetsTable.id, datasetId))
        .limit(1);

      if (!dataset) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const table = getDatasetTable(dataset, tableId);

      if (!table) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Upsert table
      const tableRows = await ctx.db
        .insert(tablesTable)
        .values({
          datasetId: dataset.id,
          name: table.name,
          key: tableId,
        })
        .onConflictDoUpdate({
          target: [tablesTable.datasetId, tablesTable.key],
          set: { key: tableId },
        })
        .returning({
          id: tablesTable.id,
          view: tablesTable.view,
          name: tablesTable.name,
        });

      const rows = await ctx.db
        .select({ id: rowsTable.id, data: rowsTable.data })
        .from(rowsTable)
        .innerJoin(tablesTable, eq(tablesTable.id, rowsTable.tableId))
        .where(
          and(
            eq(tablesTable.datasetId, datasetId),
            eq(tablesTable.key, tableId),
          ),
        )
        .limit(ROW_LIMIT);

      return {
        dataset,
        rows: rows.map(deserializeData),
        table: tableRows.at(0),
      };
    }),
  tablesUpdateView: protectedProcedure
    .input(
      z.object({
        datasetId: z.string().nonempty(),
        tableId: z.string().nonempty(),
        // TODO: Make sure view is what we expect before saving
        view: z.string().nonempty(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { datasetId, tableId, view } = input;

      const returned = await ctx.db
        .update(tablesTable)
        .set({ view: view })
        .where(
          and(
            eq(tablesTable.datasetId, datasetId),
            eq(tablesTable.key, tableId),
          ),
        )
        .returning();

      if (returned.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
    }),

  // Row
  getRow: protectedProcedure
    .input(
      z.object({
        rowId: z.string().optional(),
      }),
    )
    .query(async ({ input: { rowId }, ctx }) => {
      if (!rowId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const [row] = await ctx.db
        .select({
          data: rowsTable.data,
          table: {
            id: tablesTable.id,
            name: tablesTable.name,
            key: tablesTable.key,
          },
          dataset: {
            id: datasetsTable.id,
            name: datasetsTable.name,
            integrationType: datasetsTable.integrationType,
          },
        })
        .from(rowsTable)
        .innerJoin(tablesTable, eq(tablesTable.id, rowsTable.tableId))
        .innerJoin(datasetsTable, eq(datasetsTable.id, tablesTable.datasetId))
        .where(eq(rowsTable.id, rowId))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return deserializeData(row);
    }),

  getApiKey: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.userId && ctx.hooks.getApiKey) {
      return (await ctx.hooks.getApiKey(ctx.userId)) ?? null;
    }
    if (!env.VITE_AUTH_PASS) {
      return undefined;
    }
    const [apiKey] = await ctx.db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.type, "api"),
          eq(sessionsTable.userId, ctx.userId),
        ),
      );
    if (apiKey) {
      return apiKey.id;
    }

    // TODO: Remove dynamic import
    const { nanoid } = await import("nanoid");
    const id = nanoid(32);

    const [newApiKey] = await ctx.db
      .insert(sessionsTable)
      .values({
        id,
        userId: ctx.userId,
        type: "api",
      })
      .returning({
        id: sessionsTable.id,
      });

    return newApiKey?.id;
  }),

  // Integrations
  integrationsAll: procedure.query((): Record<string, ClientIntegration> => {
    return {
      google: createClientIntegration(google),
      toggl: createClientIntegration(toggl),
      posthog: createClientIntegration(posthog),
      github: createClientIntegration(github),
      peloton: createClientIntegration(peloton),
      // network: createClientIntegration(network),
      zotero: createClientIntegration(zotero),
      notion: createClientIntegration(notion),
      oura: createClientIntegration(oura),
      ...(env.NANGO_PRIVATE_KEY
        ? { spotify: createClientIntegration(spotify) }
        : {}),
    };
  }),

  checkNangoIntegration: protectedProcedure
    .input(z.object({ datasetId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (!nango) {
        // TODO: Different error
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      let [dataset] = await ctx.db
        .select()
        .from(datasetsTable)
        .where(eq(datasetsTable.id, input.datasetId))
        .limit(1);

      if (!dataset) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const integration = getIntegrationForDataset(dataset);

      const nangoIntegrationId = integration?.authTypes?.nango?.integrationId;

      if (!nangoIntegrationId) {
        // TODO: Different error
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const nangoConnection = await nango.getConnection(
        nangoIntegrationId,
        dataset.id,
      );

      if (!nangoConnection) {
        // TODO: Error
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Inform the DB that the connection is valid
      await ctx.db
        .update(datasetsTable)
        .set({
          credentials: {
            nangoIntegrationId,
          },
        })
        .where(eq(datasetsTable.id, input.datasetId));
    }),

  getAccessToken: protectedProcedure
    .input(z.object({ datasetId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      let [dataset] = await ctx.db
        .select()
        .from(datasetsTable)
        .where(eq(datasetsTable.id, input.datasetId))
        .limit(1);

      if (!dataset) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const token = await getTokenFromDataset(dataset);
      return token;
    }),

  syncDataset: protectedProcedure
    .input(z.object({ datasetId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      let [dataset] = await ctx.db
        .select()
        .from(datasetsTable)
        .where(eq(datasetsTable.id, input.datasetId))
        .limit(1);

      if (!dataset) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await syncDataset(ctx.db, dataset);
    }),

  syncTable: protectedProcedure
    .input(z.object({ datasetId: z.string(), tableId: z.string() }))
    .mutation(async ({ input: { datasetId, tableId }, ctx }) => {
      const [dataset] = await ctx.db
        .select()
        .from(datasetsTable)
        .where(eq(datasetsTable.id, datasetId))
        .limit(1);

      if (!dataset) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const table = getDatasetTable(dataset, tableId);

      if (!table) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await syncTable(ctx.db, dataset, table);
    }),

  syncObject: protectedProcedure
    .input(z.object({ datasetId: z.string(), objectType: z.string() }))
    .mutation(async ({ input: { datasetId, objectType }, ctx }) => {
      if (!datasetId || !objectType) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      let [dataset] = await ctx.db
        .select()
        .from(datasetsTable)
        .where(eq(datasetsTable.id, datasetId))
        .limit(1);

      if (!dataset) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const objectDefinition = getDatasetObject(dataset, objectType);

      if (!objectDefinition) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await syncObject(ctx.db, dataset, objectDefinition);
    }),

  getAllComponents: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.select().from(componentsTable).limit(40);
  }),

  getComponent: protectedProcedure
    .input(
      z.object({
        componentId: z.string(),
      }),
    )
    .query(async ({ input: { componentId }, ctx }) => {
      if (!componentId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      let [component] = await ctx.db
        .select()
        .from(componentsTable)
        .where(eq(componentsTable.id, componentId))
        .limit(1);

      if (!component) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return component;
    }),

  addComponentToDashboard: protectedProcedure
    .input(z.object({ code: z.string().min(1) }))
    .mutation(async ({ input: { code }, ctx }) => {
      let [component] = await ctx.db
        .insert(componentsTable)
        .values({ code })
        .returning();

      if (!component) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create component",
        });
      }

      return component;
    }),

  updateComponent: protectedProcedure
    .input(z.object({ id: z.string().min(1), code: z.string().min(1) }))
    .mutation(async ({ input: { id, code }, ctx }) => {
      let [component] = await ctx.db
        .update(componentsTable)
        .set({ code })
        .where(eq(componentsTable.id, id))
        .returning();

      if (!component) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save component",
        });
      }

      return component;
    }),

  deleteComponent: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input: { id }, ctx }) => {
      let [component] = await ctx.db
        .delete(componentsTable)
        .where(eq(componentsTable.id, id))
        .returning();

      if (!component) {
        throw new TRPCError({
          code: "NOT_FOUND",
        });
      }
    }),
});

// Export type router type signature,
// NOT the router itself.
export type AppRouter = typeof appRouter;
