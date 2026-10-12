import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = "https://test23780460.github.io";

function response(status: number, body: object, origin: string | null) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(origin === allowedOrigin
        ? {
            "access-control-allow-origin": allowedOrigin,
            "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
            "access-control-allow-methods": "POST, OPTIONS",
            vary: "Origin",
          }
        : {}),
    },
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin !== allowedOrigin) return response(403, { error: "Origin denied" }, origin);
  if (request.method === "OPTIONS") return response(204, {}, origin);
  if (request.method !== "POST") return response(405, { error: "Method denied" }, origin);
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return response(401, { error: "Sign in first" }, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const publicKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const publicKey = publicKeys
    ? (JSON.parse(publicKeys).web || JSON.parse(publicKeys).default)
    : Deno.env.get("SUPABASE_ANON_KEY");
  const secretKey = secretKeys
    ? (JSON.parse(secretKeys).backend_api || JSON.parse(secretKeys).default)
    : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publicKey || !secretKey)
    return response(503, { error: "Account deletion is not configured" }, origin);

  try {
    const userClient = createClient(url, publicKey);
    const { data, error } = await userClient.auth.getUser(token);
    if (error || !data.user) return response(401, { error: "Session expired" }, origin);
    const admin = createClient(url, secretKey);
    const deleted = await admin.auth.admin.deleteUser(data.user.id);
    if (deleted.error) throw deleted.error;
    return response(200, { deleted: true }, origin);
  } catch (error) {
    console.error("Account deletion failed", error);
    return response(500, { error: "Account deletion failed" }, origin);
  }
});
