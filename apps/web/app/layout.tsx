import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "SweepTrack",
  description: "Find, enter, and track sweepstakes — including mail-in (AMOE) entries.",
};

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
              <Link href="/sweepstakes">Sweepstakes</Link>
              <Link href="/amoe">Mail-in</Link>
              <Link href="/wins">Wins</Link>
              <Link href="/inbox">Inbox</Link>
              <Link href="/settings">Settings</Link>
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
      </body>
    </html>
  );
}
