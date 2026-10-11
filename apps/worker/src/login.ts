// One-time Google sign-in for the worker. Opens the browser, catches the
// redirect on 127.0.0.1 and stores a refresh token in ~/.verse-studio.
import { exec } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { google } from "googleapis";
import { loadCredentials, saveToken } from "./config";
import { ensureFolders } from "./drive";

const SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];

function openBrowser(url: string) {
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => undefined);
}

async function main() {
  const { clientId, clientSecret } = loadCredentials();
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const redirect = `http://127.0.0.1:${port}`;
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirect);
  const url = auth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

  console.log("\nOpening your browser to sign in with Google.");
  console.log("Use the SAME Google account you sign in with on the Verse Studio website.\n");
  console.log("If the browser doesn't open, paste this link into it:\n" + url + "\n");
  openBrowser(url);

  const code = await new Promise<string>((resolve, reject) => {
    server.on("request", (req, res) => {
      const u = new URL(req.url ?? "/", redirect);
      const c = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        c
          ? "<h2 style='font-family:sans-serif'>Signed in. You can close this tab and go back to the terminal.</h2>"
          : `<h2 style='font-family:sans-serif'>Sign-in failed: ${err ?? "unknown"}</h2>`,
      );
      if (c) resolve(c);
      else if (err) reject(new Error(err));
    });
  });
  server.close();
  const { tokens } = await auth.getToken(code);
  if (!tokens.refresh_token) throw new Error("Google did not return a refresh token. Run npm run login again.");
  saveToken(tokens);
  const f = await ensureFolders();
  console.log(`\nDone. The worker can now reach your Google Drive ("Verse Studio" folder id ${f.root}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\nLogin failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
