import { userFromBearer, type CurrentUser } from "./auth";

/** Wrap an extension API handler with bearer-token auth and JSON errors. */
export function withApiUser(handler: (req: Request, user: CurrentUser) => Promise<Response>) {
  return async (req: Request) => {
    const user = await userFromBearer(req);
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    try {
      return await handler(req, user);
    } catch (e) {
      console.error(e);
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  };
}
