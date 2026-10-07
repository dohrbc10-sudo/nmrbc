import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
await build({
  stdin: {
    contents: 'export {createClient} from "@supabase/supabase-js";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  outfile: "public/vendor/supabase.js",
  legalComments: "eof",
});
await copyFile(
  "node_modules/@supabase/supabase-js/LICENSE",
  "public/vendor/SUPABASE-LICENSE.txt",
);
console.log(
  "Bundled Supabase SDK. Commit public/vendor files before deploying.",
);
