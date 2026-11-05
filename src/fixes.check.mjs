// node src/fixes.check.mjs: the buttons a failure gets (fixes.ts), from real messages, compiled from the real source.
import assert from "node:assert/strict";
import { build } from "esbuild";

const entry = new URL("./fixes.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const out = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node" });
const f = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

const DENIED = `git@gitlab-ce.example.dev: Permission denied (publickey).
fatal: Could not read from remote repository.

Please make sure you have the correct access rights
and the repository exists.`;
assert.deepEqual(f.fixesFor(DENIED), [
  { kind: "ssh-key", user: "git", host: "gitlab-ce.example.dev" },
  { kind: "https", host: "gitlab-ce.example.dev" },
], "a refused SSH key: set one up, or go over HTTPS");
assert.equal(f.fixesFor("github.com: Permission denied (publickey).")[0].user, "git", "no user named: git");

assert.deepEqual(f.fixesFor("The GitHub CLI (gh) is not installed. Install it and run `gh auth login`."), [{ kind: "install", cli: "gh" }],
  "not installed wins over the sign-in it mentions");
assert.deepEqual(f.fixesFor("glab-missing"), [{ kind: "install", cli: "glab" }]);
assert.deepEqual(f.fixesFor("To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable"),
  [{ kind: "sign-in", cli: "gh" }]);
assert.deepEqual(f.fixesFor("You are not logged into any GitHub hosts. To log in, run: gh auth login"), [{ kind: "sign-in", cli: "gh" }]);
assert.deepEqual(f.fixesFor("ERROR: 401 Unauthorized"), [{ kind: "sign-in", cli: "glab" }]);
assert.deepEqual(f.fixesFor("error: Your local changes to the following files would be overwritten by checkout"), [], "nothing to press for most");

assert.equal(f.httpsUrl("git@gitlab-ce.example.dev:team/app.git"), "https://gitlab-ce.example.dev/team/app.git");
assert.equal(f.httpsUrl("ssh://git@host.dev:2222/team/app.git"), "https://host.dev/team/app.git", "an SSH port is dropped");
assert.equal(f.httpsUrl("ssh://git@host.dev/team/app.git"), "https://host.dev/team/app.git");
assert.equal(f.httpsUrl("https://github.com/a/b.git"), "", "already HTTPS");
assert.equal(f.httpsUrl("C:/repos/a.git"), "", "a drive is not a host");

const V = `origin\tgit@gitlab-ce.example.dev:team/app.git (fetch)
origin\tgit@gitlab-ce.example.dev:team/app.git (push)
fork\tgit@github.com:me/app.git (fetch)
fork\tgit@github.com:me/app.git (push)
web\thttps://gitlab-ce.example.dev/team/app.git (fetch)`;
assert.deepEqual(f.sshRemotesOn(V, "gitlab-ce.example.dev"),
  [{ name: "origin", from: "git@gitlab-ce.example.dev:team/app.git", to: "https://gitlab-ce.example.dev/team/app.git" }],
  "only the SSH remotes on that host, once each");

assert.equal(f.keysPage("github.com"), "https://github.com/settings/ssh/new");
assert.equal(f.keysPage("gitlab-ce.example.dev"), "https://gitlab-ce.example.dev/-/user_settings/ssh_keys");

// The SSH key set-up, run for real with its outside world stubbed: ssh-keygen, ssh, the clipboard,
// the browser and the Enter it waits for. A scratch home, once with no key (it makes one) and once
// with the key it made (it does not make another).
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const has = (cmd) => { try { execFileSync(cmd, process.platform === "win32" && cmd === "powershell" ? ["-NoProfile", "-Command", "1"] : ["-c", "true"], { stdio: "ignore" }); return true; } catch { return false; } };

if (process.platform === "win32" && has("powershell")) {
  const home = mkdtempSync(join(tmpdir(), "sshfix-"));
  const script = join(home, "setup.ps1");
  writeFileSync(script, f.sshScript("git", "gitlab-ce.example.dev", true));
  const runner = join(home, "run.ps1");
  writeFileSync(runner, `function ssh-keygen { $i = [array]::IndexOf($args, '-f'); $k = $args[$i + 1]; Set-Content "$k.pub" 'ssh-ed25519 AAAATEST me'; Set-Content $k 'private'; Write-Host "KEYGEN $args" }
filter Set-Clipboard { Write-Host "CLIP $_" }
function Start-Process { Write-Host "OPEN $args" }
function Read-Host { Write-Host "READ $args" }
function ssh { Write-Host "SSH $args" }
. '${script.replace(/'/g, "''")}'
`);
  const run = () => execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runner],
    { env: { ...process.env, USERPROFILE: home }, encoding: "utf8" });
  const first = run();
  assert.match(first, /KEYGEN -t ed25519 -f .*\.ssh.id_ed25519/, "no key: one is made in ~/.ssh");
  assert.ok(existsSync(join(home, ".ssh", "id_ed25519.pub")));
  assert.match(first, /CLIP ssh-ed25519 AAAATEST me/, "its public key goes on the clipboard");
  assert.match(first, /OPEN https:\/\/gitlab-ce\.example\.dev\/-\/user_settings\/ssh_keys/, "the host's page for a new key opens");
  assert.match(first, /SSH -T -o StrictHostKeyChecking=accept-new git@gitlab-ce\.example\.dev/, "then it is tried");
  assert.ok(first.indexOf("READ") < first.indexOf("SSH -T"), "after the Enter that says it is added");
  assert.doesNotMatch(run(), /KEYGEN/, "a key already there is used, not replaced");
}
if (has("sh")) {
  const home = mkdtempSync(join(tmpdir(), "sshfix-"));
  const bin = join(home, "bin");
  execFileSync("sh", ["-c", `mkdir -p "$1"`, "_", bin]);
  const stub = (name, body) => writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  stub("ssh-keygen", `while [ "$1" != "-f" ]; do shift; done; echo 'ssh-ed25519 AAAATEST me' > "$2.pub"; echo private > "$2"; echo KEYGEN`);
  stub("ssh", `echo "SSH $*"`);
  stub("xdg-open", `echo "OPEN $*"`);
  stub("wl-copy", `echo "CLIP $(cat)"`);
  const script = join(home, "setup.sh");
  writeFileSync(script, f.sshScript("git", "github.com", false));
  const run = () => execFileSync("sh", [script], { env: { ...process.env, HOME: home, PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` }, input: "\n", encoding: "utf8" });
  const first = run();
  assert.match(first, /KEYGEN/, "sh: no key, one is made");
  assert.match(first, /ssh-ed25519 AAAATEST me/, "sh: the key is shown");
  assert.match(first, /SSH -T -o StrictHostKeyChecking=accept-new git@github\.com/, "sh: then it is tried");
  assert.doesNotMatch(run(), /KEYGEN/, "sh: a key already there is used");
}

console.log("fixes.check.mjs: all assertions passed");
