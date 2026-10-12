import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_PUBLISHABLE_KEY || "";
if (Boolean(url) !== Boolean(key))
  throw Error("Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, or neither.");
if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url))
  throw Error("SUPABASE_URL must be an HTTPS Supabase project URL.");
if (key && !/^sb_publishable_[A-Za-z0-9_-]+$|^eyJ[A-Za-z0-9_.-]+$/.test(key))
  throw Error("Use a Supabase publishable/anon key, never a secret or service-role key.");
await rm("dist", { recursive: true, force: true });
await mkdir("dist");
await Promise.all([
  cp("index.html", "dist/index.html"),
  cp("styles.css", "dist/styles.css"),
  cp(".nojekyll", "dist/.nojekyll"),
]);
await build({
  entryPoints: ["src/app.js"],
  outfile: "dist/app.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  define: {
    __SUPABASE_URL__: JSON.stringify(url),
    __SUPABASE_KEY__: JSON.stringify(key),
  },
});
console.log(`Static site ready in dist/ (${url ? "cloud enabled" : "local mode"}).`);
