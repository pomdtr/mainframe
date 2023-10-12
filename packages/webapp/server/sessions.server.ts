import { db } from "./db/db.server";
import { sessionsTable } from "../app/db/schema";
import { eq } from "drizzle-orm";
import { env } from "./lib/env.server";
import { CookieSerializeOptions, parse, serialize } from "cookie";
import cookieSignature from "cookie-signature";

export interface MainframeSession {
    id: string;
    data: {
        userId?: string;
    };
    error?: "not_found";
}

const cookieName = "__session";
const cookieSecrets = env.COOKIE_SECRET ? [env.COOKIE_SECRET] : [];
const cookieSettings: CookieSerializeOptions = {
    path: "/",
    httpOnly: true,
    // maxAge: 400 days is to the maximum timespan available
    // https://developer.chrome.com/blog/cookie-max-age-expires/
    maxAge: 400 * 24 * 60 * 60,
    // TODO: secure is false since the default scenario is to use it over
    //       localhost or or over a home network
    // TODO: overwrite `secure` when using https.
    secure: false,
};

function getSessionIdFromCookieHeader(cookieHeader: string | null | undefined) {
    if (!cookieHeader) {
        return null;
    }
    const parsed = parse(cookieHeader, {
        decode(value) {
            for (let secret of cookieSecrets) {
                const unsigned = cookieSignature.unsign(value, secret);
                if (unsigned !== false) {
                    return unsigned;
                }
            }
            return value;
        },
    })[cookieName] as string | undefined;
    // Ensures it's not an empty string or null
    return parsed ? parsed : null;
}

function serializeSessionCookie(
    value: string,
    options?: CookieSerializeOptions,
) {
    return serialize(cookieName, value, {
        encode(value) {
            const secret = cookieSecrets.at(0);
            if (secret) {
                return cookieSignature.sign(value, secret);
            }
            return value;
        },
        ...cookieSettings,
        ...options,
    });
}

async function updateData(
    id: string,
    data: MainframeSession["data"],
    expires: Date | undefined,
) {
    console.log("Updating...", id, data);
    await db
        .update(sessionsTable)
        .set({
            userId: data.userId ?? null,
            expires: expires?.getTime() ?? null,
        })
        .where(eq(sessionsTable.id, id));
}

async function deleteData(id: string) {
    await db.delete(sessionsTable).where(eq(sessionsTable.id, id));
}

async function createSession(): Promise<MainframeSession> {
    // TODO: Remove dynamic import
    const { nanoid } = await import("nanoid");
    const id = nanoid(32);
    await db.insert(sessionsTable).values({
        id,
        userId: null,
        expires: null,
    });
    return {
        id,
        data: {
            userId: undefined,
        },
    };
}

export async function getSession(
    cookieHeader?: string | null | undefined,
    options?: any,
): Promise<MainframeSession> {
    const sessionId = getSessionIdFromCookieHeader(cookieHeader);

    if (!sessionId) {
        return createSession();
    }

    const [row] = await db
        .select({ userId: sessionsTable.userId })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, sessionId));

    if (!row) {
        return createSession();
    }

    return {
        id: sessionId,
        data: {
            userId: row.userId ?? undefined,
        },
    };
}

export async function commitSession(
    session: MainframeSession,
    options?: CookieSerializeOptions,
) {
    // Update row
    let { id, data } = session;

    let expires =
        options?.maxAge != null
            ? new Date(Date.now() + options.maxAge * 1000)
            : options?.expires != null
            ? options.expires
            : cookieSettings.expires;

    await updateData(id, data, expires);

    let serializedCookie = serializeSessionCookie(session.id, options);
    if (serializedCookie.length > 4096) {
        throw new Error(
            "Cookie length will exceed browser maximum. Length: " +
                serializedCookie.length,
        );
    }
    return serializedCookie;
}

export async function destroySession(
    session: MainframeSession,
    options?: CookieSerializeOptions,
) {
    // Delete row
    await deleteData(session.id);
    return serializeSessionCookie("", {
        ...options,
        maxAge: undefined,
        expires: new Date(0),
    });
}