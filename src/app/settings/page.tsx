import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import SettingsClient from "@/components/SettingsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Settings · The Hoecks",
};

const ADMIN_SETTING_KEYS = [
  "site_title",
  "site_description",
  "banner_message",
  "imessage_recipients",
  "daily_notifications_enabled",
  "notify_send_hour",
  "notify_timezone",
];

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isAdmin = session.role === "admin";

  let adminSettings: Record<string, string> | null = null;
  let deviceCount = 0;
  if (isAdmin) {
    adminSettings = await getSettings(ADMIN_SETTING_KEYS);
    const countResult = await db.execute("SELECT COUNT(*) as n FROM push_subscriptions");
    deviceCount = Number((countResult.rows[0] as unknown as { n: number }).n ?? 0);
  }

  return (
    <SettingsClient
      isAdmin={isAdmin}
      adminSettings={adminSettings}
      deviceCount={deviceCount}
      vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? ""}
    />
  );
}
