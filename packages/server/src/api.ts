import { Router } from "express";
import { operations } from "./lib/operations";
import {
  getSessionFromId,
  getSessionIdFromCookieHeader,
} from "./sessions.server";
import {
  Operation,
  datasetsTable,
  objectsTable,
  rowsTable,
} from "@mainframe-so/shared";
import { and, eq } from "drizzle-orm";
import { deserializeData } from "./utils/serialization";
import { getIntegrationFromType } from "./lib/integrations";
import bodyParser from "body-parser";
import { env } from "./lib/env.server";
import express from "express";
import { getTokenFromDataset } from "./lib/integration-token";

export interface ApiRouterHooks {
  getUserIdFromBearerToken?(
    token: string,
  ): Promise<string | undefined> | string | undefined;
  isApiRequestAuthorized?(req: express.Request): Promise<boolean> | boolean;
}

function parseBearerHeader(header: string | undefined) {
  if (!header) {
    return undefined;
  }

  const match = header.match(/^Bearer\s+(.*)$/);

  if (match) {
    return match[1];
  }
}

export function buildApiRouter(hooks: ApiRouterHooks) {
  const apiRouter = Router();

  apiRouter.use(async (req, res, next) => {
    try {
      const authorization = req.header("authorization");

      const bearer = parseBearerHeader(authorization);
      if (hooks.isApiRequestAuthorized) {
        if (await hooks.isApiRequestAuthorized(req)) {
          next();
          return;
        }
      } else if (env.VITE_AUTH_PASS) {
        const sessionId =
          bearer ?? getSessionIdFromCookieHeader(req.header("cookie"));

        const session = sessionId
          ? await getSessionFromId(req.db, sessionId)
          : undefined;

        if (session?.data.userId) {
          next();
          return;
        }
      }
      // TODO: next(error). Use middleware to handle error
      res.sendStatus(401);
    } catch (e) {
      next(e);
    }
  });

  apiRouter.get("/table/:table_id/rows", async (req, res, next) => {
    try {
      const rows = await req.db
        .select({ id: rowsTable.id, data: rowsTable.data })
        .from(rowsTable)
        .where(eq(rowsTable.tableId, req.params.table_id))
        .limit(100);

      res.contentType("application/json");
      res.send(JSON.stringify(rows.map(deserializeData)));
    } catch (e) {
      next(e);
    }
  });

  apiRouter.get("/credentials/:dataset_id", async (req, res, next) => {
    try {
      // Get the dataset info
      const [dataset] = await req.db
        .select()
        .from(datasetsTable)
        .where(eq(datasetsTable.id, req.params.dataset_id))
        .limit(1);

      if (!dataset) {
        res.sendStatus(404);
        return;
      }

      const token = await getTokenFromDataset(dataset);

      res.contentType("application/json");
      res.send(JSON.stringify({ token }));
    } catch (e) {
      next(e);
    }
  });

  apiRouter.get("/object/:dataset_id/:object_type", async (req, res, next) => {
    try {
      const [object] = await req.db
        .select({ id: objectsTable.id, data: objectsTable.data })
        .from(objectsTable)
        .where(
          and(
            eq(objectsTable.datasetId, req.params.dataset_id),
            eq(objectsTable.objectType, req.params.object_type),
          ),
        )
        .limit(1);

      if (!object) {
        res.sendStatus(404);
        return;
      }

      res.contentType("application/json");
      res.send(JSON.stringify(deserializeData(object)));
      // const rows = await req.db
      //     .select({ id: rowsTable.id, data: rowsTable.data })
      //     .from(rowsTable)
      //     .where(
      //         eq(tablesTable.key, req.params.table_id),
      //     )
      //     .limit(100);
      // res.send(JSON.stringify(rows.map(deserializeData)))
    } catch (e) {
      next(e);
    }
  });

  apiRouter.post(
    "/action/:dataset_id/:action_name",
    bodyParser.json(),
    async (req, res, next) => {
      try {
        // Get the dataset info
        const [dataset] = await req.db
          .select()
          .from(datasetsTable)
          .where(eq(datasetsTable.id, req.params.dataset_id))
          .limit(1);
        const integration = getIntegrationFromType(
          dataset?.integrationType ?? undefined,
        );

        // Call the action
        const action = integration?.actions?.[req.params.action_name];
        if (!dataset || !action) {
          res.sendStatus(404);
          return;
        }

        try {
          const result = await action(dataset, req.body);
          if (result) {
            res.contentType("json").send(JSON.stringify(result));
          } else {
            res.sendStatus(204);
          }
        } catch (e) {
          console.error(e);
          res.sendStatus(500);
        }
      } catch (e) {
        next(e);
      }
    },
  );

  apiRouter.get("/operations", (req, res, next) => {
    try {
      if (req.accepts("text/event-stream")) {
        // https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
        res.status(200);
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.contentType("text/event-stream");

        res.flushHeaders();

        res.write(`data:${JSON.stringify({ type: "ping" })}\n\n`);

        function sendOperation(operation: Operation) {
          res.write(`data:${JSON.stringify(operation)}\n\n`);
        }

        operations.addListener("operation", sendOperation);

        req.on("close", function (err: any) {
          operations.removeListener("operation", sendOperation);
          res.end();
        });
        return;
      }

      // TODO: Consider sending a JSON array back
      // TODO: Add a ?since= query parameter

      res.sendStatus(415);
    } catch (e) {
      next(e);
    }
  });

  return apiRouter;
}
