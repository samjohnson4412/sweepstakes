import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import { isAdmin } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "SweepTrack",
  description: "Find, enter, and track sweepstakes — including mail-in (AMOE) entries.",
  appleWebApp: { capable: true, title: "SweepTrack" },
};

export const viewport: Viewport = { themeColor: "#5b4bdb" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href={user ? "/dashboard" : "/"} className="brand">
            SweepTrack
          </Link>
          {user ? (
            <nav>
              <Link href="/dashboard">Today</Link>
              <Link href="/catalog">Catalog</Link>
              <Link href="/sweepstakes">Tracking</Link>
              <Link href="/amoe">Mail-in</Link>
              <Link href="/wins">Wins</Link>
              <Link href="/inbox">Inbox</Link>
              <Link href="/settings">Settings</Link>
              {isAdmin(user) && <Link href="/admin">Admin</Link>}
              <form action={logout}>
                <button className="link">Log out</button>
              </form>
            </nav>
          ) : (
            <nav>
              <Link href="/login">Log in</Link>
              <Link href="/signup" className="button small">
                Sign up
              </Link>
            </nav>
          )}
        </header>
        <main>{children}</main>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
