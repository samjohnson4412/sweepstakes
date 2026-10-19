import { redirect } from "next/navigation";
import { extractLinks } from "@sweeptrack/core";
import { requireUser } from "@/lib/auth";
import { importSweepstakes, trackSweepstakes } from "@/lib/sweeps";

export const dynamic = "force-dynamic";

/** PWA share target: a link shared from another app is added and tracked. */
export default async function SharePage({ searchParams }: { searchParams: Promise<{ url?: string; text?: string; title?: string }> }) {
  const user = await requireUser();
  const { url, text, title } = await searchParams;
  // Many apps put the link in `text` instead of `url`.
  const link = [url, ...extractLinks(text ?? "")].find((l) => l && /^https?:\/\//i.test(l));
  if (!link) {
    return (
      <div className="card empty">
        That share didn&apos;t include a link. Share the sweepstakes page itself, or paste its URL on the Tracking page.
      </div>
    );
  }
  const result = await importSweepstakes(link, { userId: user.id, sourceId: "share", title: title?.slice(0, 200) || undefined });
  await trackSweepstakes(user.id, result.id);
  redirect(`/sweepstakes/${result.id}`);
}
