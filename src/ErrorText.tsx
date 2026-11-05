// A failure as the error dialogs show it: what git (or gh, glab) said, and below it a button for
// each fix fixes.ts finds in it. A fix that needs a person (an SSH key's passphrase, a browser
// sign-in) runs in a terminal tab beside this one, where it can ask; the dialog closes as it does.
import { KeyRound, Globe, LogIn, Download } from "lucide-react";
import { dataDir, fsWrite, gitRun, isWindows, openExternal } from "../shim/bridge.js";
import { applyDtCommand, getLayout, leafIds, queueInput } from "../shim/terminals.js";
import { fixesFor, httpsUrl, sshRemotesOn, sshScript, type Cli, type Fix } from "./fixes";
import { prError } from "./prhost";
import { failure, repoName, told } from "./notice";

/** Sent when a fix starts, so the dialog showing the error gets out of its way. */
export const FIX_STARTED = "deck-git-fix-started";

const CLI = {
  gh: { name: "GitHub", install: "https://cli.github.com" },
  glab: { name: "GitLab", install: "https://gitlab.com/gitlab-org/cli#installation" },
} as const;

/** Run `command` in a new terminal tab in the zone of the tab in view. */
function inTerminal(title: string, command: string) {
  const l0 = getLayout(), w0 = l0?.workspaces.find((x) => x.id === l0.activeWs);
  const refused = applyDtCommand("new-tab", { title, ...(w0 ? { zone: w0.activeTab } : {}) });
  if (refused) { failure("Could not open a terminal", String(refused)); return; }
  const l = getLayout(), w = l?.workspaces.find((x) => x.id === l.activeWs), t = w?.tabs.find((x) => x.id === w.activeTab);
  if (t) queueInput(leafIds(t.root)[0], command + "\r");
}

async function setUpSsh(user: string, host: string) {
  const file = `${await dataDir()}/ssh-setup.${isWindows() ? "ps1" : "sh"}`;
  await fsWrite(file, sshScript(user, host, isWindows()));
  inTerminal(`SSH key for ${host}`, isWindows() ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${file}"` : `sh "${file}"`);
}

/** Every SSH remote on `host` switched to HTTPS; the card says what each was, to go back by hand. */
const useHttps = (root: string, host: string) => told(async () => {
  const rs = sshRemotesOn(await gitRun(root, ["remote", "-v"]), host);
  if (!rs.length) throw new Error(`No remote of ${repoName(root)} uses SSH on ${host}.`);
  for (const r of rs) await gitRun(root, ["remote", "set-url", r.name, r.to]);
  return rs;
}, (rs) => ({
  title: `${rs.map((r) => r.name).join(", ")} now ${rs.length > 1 ? "use" : "uses"} HTTPS`,
  body: `${rs.map((r) => `${r.to}, was ${r.from}`).join("; ")}. Git Credential Manager signs you in the next time it is needed.`,
}));

/** gh signs in through the browser; glab to this repository's GitLab, the one it could not reach. */
async function signIn(root: string, cli: Cli) {
  if (cli === "gh") return inTerminal("GitHub sign-in", "gh auth login --web");
  const url = await gitRun(root, ["remote", "get-url", "origin"]).then((s) => s.trim(), () => "");
  let host = "";
  try { host = new URL(httpsUrl(url) || url).hostname; } catch { /* no origin, or not an address */ }
  inTerminal("GitLab sign-in", `glab auth login${host && host !== "gitlab.com" ? ` --hostname ${host}` : ""}`);
}

function run(root: string, f: Fix) {
  window.dispatchEvent(new CustomEvent(FIX_STARTED));
  const p = f.kind === "ssh-key" ? setUpSsh(f.user, f.host)
    : f.kind === "https" ? useHttps(root, f.host)
    : f.kind === "sign-in" ? signIn(root, f.cli)
    : openExternal(CLI[f.cli].install);
  p.catch((e) => { console.warn(`[git] ${f.kind} fix failed`, e); failure("That did not work", String(e).replace(/^Error:\s*/, "")); });
}

const LABEL = (f: Fix) => f.kind === "ssh-key" ? { text: "Set up an SSH key", icon: KeyRound }
  : f.kind === "https" ? { text: "Use HTTPS instead", icon: Globe }
  : f.kind === "sign-in" ? { text: `Sign in to ${CLI[f.cli].name}`, icon: LogIn }
  : { text: `Install the ${CLI[f.cli].name} CLI`, icon: Download };

/** What went wrong, and a button for each fix. `root` is the repository it happened in. */
export function ErrorText({ e, root, pre = true }: { e: unknown; root: string; pre?: boolean }) {
  const text = prError(e);
  const fixes = fixesFor(text);
  return (
    <>
      {pre ? <pre className="scroll-thin max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed">{text}</pre> : text}
      {fixes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {fixes.map((f, i) => {
            const { text: label, icon: Icon } = LABEL(f);
            return (
              <button key={f.kind} onClick={() => run(root, f)}
                className={"flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition "
                  + (i === 0 ? "text-white hover:brightness-110" : "bg-elev text-text-secondary shadow-[inset_0_0_0_1px_var(--border-strong)] hover:text-text-primary")}
                style={i === 0 ? { background: "var(--accent)" } : undefined}>
                <Icon size={13} /> {label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** An error dialog: `title`, then what was said and its fixes. */
export const failedDialog = (title: string, e: unknown, root: string) => ({
  title, confirmLabel: "OK", danger: false, acknowledge: true, onConfirm: () => {},
  body: <ErrorText e={e} root={root} />,
});
