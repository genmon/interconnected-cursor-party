import * as esbuild from "esbuild";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Load environment variables
dotenv.config();

// Determine the PARTYKIT_HOST based on environment
const isDev = process.env.NODE_ENV !== "production";

let PARTYKIT_HOST;
if (isDev) {
  // For local dev, use window.location.host so the welcome page works
  PARTYKIT_HOST = "window.location.host";
} else {
  // For production, REQUIRE the PARTYKIT_HOST env var
  // This is critical because the script will be embedded on other domains
  if (!process.env.PARTYKIT_HOST) {
    console.error("");
    console.error("❌ ERROR: PARTYKIT_HOST environment variable is required for production builds!");
    console.error("");
    console.error("The script will be embedded on other websites (e.g., interconnected.org)");
    console.error("and needs to know which worker to connect to.");
    console.error("");
    console.error("Set it in your .env file:");
    console.error('  PARTYKIT_HOST=cursor-party.YOUR-ACCOUNT.workers.dev');
    console.error("");
    console.error("Or pass it as an environment variable:");
    console.error('  PARTYKIT_HOST=cursor-party.YOUR-ACCOUNT.workers.dev npm run deploy');
    console.error("");
    process.exit(1);
  }
  PARTYKIT_HOST = JSON.stringify(process.env.PARTYKIT_HOST);
}

console.log("🎈 Building Cursor Party client...");
console.log(`📡 Mode: ${isDev ? "development" : "production"}`);
console.log(`📡 PARTYKIT_HOST: ${PARTYKIT_HOST}`);

// Step 1: Run the splash script (generate meta.js)
if (process.env.WEBSITES) {
  fs.writeFileSync(
    "public/meta.js",
    `window.__WEBSITES__ = ${JSON.stringify(process.env.WEBSITES)};`
  );
  console.log("✓ Generated public/meta.js");
}

// Step 2: Bundle the client code
try {
  await esbuild.build({
    entryPoints: ["src/cursors.tsx"],
    bundle: true,
    outfile: "public/cursors.js",
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: process.env.NODE_ENV === "production",
    sourcemap: true,
    splitting: false,
    // Alias React to Preact for smaller bundle size
    alias: {
      react: "@preact/compat",
      "react-dom": "@preact/compat",
    },
    // Define PARTYKIT_HOST as a global constant
    // In dev mode, this will be the actual expression window.location.host
    // In production, it will be a string literal
    define: {
      PARTYKIT_HOST: PARTYKIT_HOST,
    },
    logLevel: "info",
  });

  console.log("✓ Built public/cursors.js");
  console.log("🎉 Client build complete!");
} catch (error) {
  console.error("❌ Build failed:", error);
  process.exit(1);
}
