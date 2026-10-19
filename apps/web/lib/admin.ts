import { redirect } from "next/navigation";
import { requireUser, type CurrentUser } from "./auth";

/** Admins: users with is_admin, or emails listed in ADMIN_EMAILS (comma-separated). */
export function isAdmin(user: CurrentUser | null): boolean {
  if (!user) return false;
  const listed = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return user.isAdmin || listed.includes(user.email.toLowerCase());
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isAdmin(user)) redirect("/dashboard");
  return user;
}

export function mailServiceEnabled(): boolean {
  return process.env.MAIL_SERVICE_ENABLED === "true";
}
