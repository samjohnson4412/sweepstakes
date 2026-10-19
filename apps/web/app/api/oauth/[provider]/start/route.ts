import { cookies } from "next/headers";
import { randomToken } from "@sweeptrack/db";
import { buildAuthUrl, providerConfigured, type MailProvider } from "@sweeptrack/ingest";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (provider !== "google" && provider !== "microsoft") return new Response("Unknown provider", { status: 404 });
  if (!(await getCurrentUser())) return Response.redirect(new URL("/login", req.url));
  if (!providerConfigured(provider)) return new Response(`${provider} sign-in is not configured`, { status: 501 });
  const state = randomToken(24);
  (await cookies()).set(`oauth_state_${provider}`, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/oauth",
    maxAge: 600,
  });
  return Response.redirect(buildAuthUrl(provider as MailProvider, state));
}
