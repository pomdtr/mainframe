import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./db.server";
import { resolve } from "node:path";
import { __dirnameFromImportMetaUrl } from "../utils/dirname";

const __dirname = __dirnameFromImportMetaUrl(import.meta.url);

migrate(db, { migrationsFolder: resolve(__dirname, "migrations") });
