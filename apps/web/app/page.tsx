import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <div className="stack" style={{ maxWidth: 680, margin: "40px auto" }}>
      <h1>Never miss a daily entry again.</h1>
      <p className="muted">
        SweepTrack finds sweepstakes, reminds you what&apos;s due, fills entry forms for you (you click Submit), tracks
        mail-in AMOE entries and postage, and spots win notices in your email before claim deadlines pass.
      </p>
      <div className="row">
        <Link href="/signup" className="button">
          Create a free account
        </Link>
        <Link href="/login" className="button secondary">
          Log in
        </Link>
      </div>
    </div>
  );
}
