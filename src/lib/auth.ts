import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "./db";
import bcrypt from "bcryptjs";
import { safeEqual } from "./safeCompare";

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  // Fail closed: never fall back to signing/verifying with the string
  // "undefined" (which is what encode(undefined) would produce), and reject
  // weak secrets that could be brute-forced offline from an issued cookie.
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET is missing or too short (need at least 32 characters)");
  }
  return new TextEncoder().encode(secret);
};

const COOKIE_NAME = "hoecks_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

export interface SessionPayload {
  role: "viewer" | "admin";
  iat: number;
}

export async function createSession(role: "viewer" | "admin") {
  const token = await new SignJWT({ role } as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("90d")
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  return token;
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function verifyViewerPassword(password: string): Promise<boolean> {
  const result = await db.execute({
    sql: "SELECT value FROM site_settings WHERE key = ?",
    args: ["viewer_password_hash"],
  });
  if (result.rows.length === 0) return false;
  const hash = result.rows[0].value as string;
  return bcrypt.compare(password, hash);
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  // safeEqual hashes both sides to a fixed width, so this is constant-time and
  // leaks neither the password nor its length; returns false if ADMIN_PASSWORD
  // is unset.
  return safeEqual(password, process.env.ADMIN_PASSWORD);
}

export async function verifyApiToken(request: Request): Promise<boolean> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return safeEqual(auth.slice(7), process.env.ADMIN_API_TOKEN);
}
