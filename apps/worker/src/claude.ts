// Runs the official Claude Code CLI in print mode. It uses whatever account is
// logged in on this machine (her Claude Pro/Max plan), so no API key is needed.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { log } from "./log";

let resolved: { bin: string; shell: boolean } | null = null;

export function claudeBinary(): { bin: string; shell: boolean } {
  if (resolved) return resolved;
  const env = process.env.CLAUDE_BIN;
  if (env) return (resolved = { bin: env, shell: /\.(cmd|bat)$/i.test(env) });
  const home = os.homedir();
  const candidates =
    process.platform === "win32"
      ? [path.join(home, ".local", "bin", "claude.exe"), path.join(home, "AppData", "Roaming", "npm", "claude.cmd")]
      : [path.join(home, ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  for (const c of candidates) if (fs.existsSync(c)) return (resolved = { bin: c, shell: /\.(cmd|bat)$/i.test(c) });
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" });
  const first = which.stdout?.split(/\r?\n/).find(Boolean);
  if (first) return (resolved = { bin: first.trim(), shell: /\.(cmd|bat)$/i.test(first.trim()) });
  return (resolved = { bin: "claude", shell: process.platform === "win32" });
}

export class ClaudeError extends Error {}

interface RunOpts {
  cwd: string;
  model?: string;
  allowRead?: boolean;
  timeoutMs?: number;
}

// Asks Claude for JSON that matches `schema`. Retries once with the validation error.
export async function askClaude<T>(prompt: string, schema: z.ZodType<T>, opts: RunOpts): Promise<T> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const full =
      attempt === 0
        ? prompt
        : `${prompt}\n\nYour previous answer did not match the required format: ${lastErr}\nReturn only the corrected JSON.`;
    const raw = await runClaude(full, jsonSchema, opts);
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    lastErr = parsed.error.message.slice(0, 1500);
    log("Claude output failed validation, retrying:", lastErr.slice(0, 300));
  }
  throw new ClaudeError(`Claude's answer didn't match the expected format: ${lastErr.slice(0, 400)}`);
}

async function runClaude(prompt: string, jsonSchema: Record<string, unknown>, opts: RunOpts): Promise<unknown> {
  const { bin, shell } = claudeBinary();
  const args = ["-p", "--output-format", "json", "--permission-mode", "dontAsk"];
  if (opts.allowRead) args.push("--allowedTools", "Read");
  if (opts.model) args.push("--model", opts.model);
  // .cmd shims need a shell, where long JSON arguments are unsafe, so the
  // schema then goes in the prompt instead and the answer is validated locally.
  let fullPrompt = prompt;
  if (!shell) args.push("--json-schema", JSON.stringify(jsonSchema));
  else fullPrompt += `\n\nRespond with ONLY a JSON object matching this JSON Schema, no prose:\n${JSON.stringify(jsonSchema)}`;

  const started = Date.now();
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, shell, windowsHide: true, env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new ClaudeError("Claude took too long and was stopped."));
    }, opts.timeoutMs ?? 10 * 60 * 1000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new ClaudeError(`Couldn't start Claude Code (${bin}): ${e.message}. Install it and log in (docs/SETUP.md).`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!stdout.trim()) reject(new ClaudeError(`Claude Code exited (${code}) without output. ${stderr.slice(0, 500)}`));
      else resolve(stdout);
    });
    child.stdin.end(fullPrompt);
  });
  log(`Claude answered in ${Math.round((Date.now() - started) / 1000)}s`);

  let env: Record<string, unknown>;
  try {
    env = JSON.parse(out.trim().split(/\r?\n/).filter(Boolean).pop()!);
  } catch {
    throw new ClaudeError(`Unexpected output from Claude Code: ${out.slice(0, 300)}`);
  }
  if (env.is_error) {
    const msg = String(env.result ?? env.error ?? "unknown error");
    if (/log ?in|auth|credential|401|403/i.test(msg)) {
      throw new ClaudeError(`Claude Code isn't logged in on this computer. Open a terminal, run "claude", then /login. (${msg.slice(0, 200)})`);
    }
    if (/limit|usage|quota|rate/i.test(msg)) throw new ClaudeError(`Claude plan usage limit reached: ${msg.slice(0, 200)}`);
    throw new ClaudeError(msg.slice(0, 500));
  }
  if (env.structured_output !== undefined && env.structured_output !== null) return env.structured_output;
  const text = String(env.result ?? "");
  const m = text.match(/\{[\s\S]*\}$/m) ?? text.match(/\{[\s\S]*\}/);
  if (!m) throw new ClaudeError(`Claude didn't return JSON: ${text.slice(0, 300)}`);
  return JSON.parse(m[0]);
}

export async function claudeHealth(): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await askClaude('Reply with {"ok": true}.', z.object({ ok: z.boolean() }), {
      cwd: os.tmpdir(),
      timeoutMs: 120000,
    });
    return { ok: r.ok, message: "Claude Code is logged in and answering." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
