import { cookies } from "next/headers";
import { appUrl, connectMailAccount, type MailProvider } from "@sweeptrack/ingest";
import { getCurrentUser } from "@/lib/auth";
import { secretMatches } from "@/lib/secrets";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (provider !== "google" && provider !== "microsoft") return new Response("Unknown provider", { status: 404 });
  const user = await getCurrentUser();
  if (!user) return Response.redirect(`${appUrl()}/login`);
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get(`oauth_state_${provider}`)?.value;
  jar.delete(`oauth_state_${provider}`);
  const back = (msg: string) => Response.redirect(`${appUrl()}/settings?mail=${encodeURIComponent(msg)}`);
  if (!secretMatches(url.searchParams.get("state"), expected)) return back("Sign-in expired. Please try again.");
  const code = url.searchParams.get("code");
  if (!code) return back(url.searchParams.get("error_description") ?? "Access was not granted.");
  try {
    const email = await connectMailAccount(user.id, provider as MailProvider, code);
    return back(`Connected ${email}. Sweepstakes emails will appear in your Inbox within a few minutes.`);
  } catch (e) {
    return back(`Couldn't connect: ${(e as Error).message}`);
  }
}
