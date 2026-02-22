import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "./db";
import bcrypt from "bcryptjs";

const getSecret = () => new TextEncoder().encode(process.env.JWT_SECRET!);

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
    const { payload } = await jwtVerify(token, getSecret());
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
  return password === process.env.ADMIN_PASSWORD;
}

export function verifyApiToken(request: Request): boolean {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return auth.slice(7) === process.env.ADMIN_API_TOKEN;
}
