// What a failure can be fixed with, from what git, gh or glab said: a button in the error, rather
// than a hint to go and work out. Pure, so fixes.check.mjs can feed it real messages.

export type Cli = "gh" | "glab";
export type Fix =
  /** The host refused every SSH key this PC has: make one, add it to the host, test it. */
  | { kind: "ssh-key"; user: string; host: string }
  /** Or leave SSH: the remote's address over HTTPS, where Git Credential Manager signs in. */
  | { kind: "https"; host: string }
  | { kind: "sign-in"; cli: Cli }
  | { kind: "install"; cli: Cli };

export function fixesFor(text: string): Fix[] {
  const ssh = /(?:([\w.-]+)@)?([\w.-]+): Permission denied \(publickey/.exec(text);
  if (ssh) return [{ kind: "ssh-key", user: ssh[1] ?? "git", host: ssh[2] }, { kind: "https", host: ssh[2] }];
  // Not installed first: that message says to sign in afterwards too.
  if (/gh-missing|GitHub CLI \(gh\) is not installed/.test(text)) return [{ kind: "install", cli: "gh" }];
  if (/glab-missing|GitLab CLI \(glab\) is not installed/.test(text)) return [{ kind: "install", cli: "glab" }];
  if (/gh auth login|not logged in(to)? (to )?any GitHub hosts/i.test(text)) return [{ kind: "sign-in", cli: "gh" }];
  if (/glab auth login|401 Unauthorized/.test(text)) return [{ kind: "sign-in", cli: "glab" }];
  return [];
}

/**
 * An SSH remote's address over HTTPS: `git@host:group/repo.git` and `ssh://git@host:2222/group/repo.git`
 * both become `https://host/group/repo.git` (an SSH port says nothing about HTTPS). "" for an
 * address that is not SSH.
 */
export function httpsUrl(url: string): string {
  const u = url.trim();
  const m = /^ssh:\/\/[^@/\s]+@([^:/\s]+)(?::\d+)?\/(.+)$/.exec(u) ?? /^[^@/\s:]+@([^:/\s]+):(?!\/)(.+)$/.exec(u);
  return m ? `https://${m[1]}/${m[2]}` : "";
}

/** The remotes (from `git remote -v`) whose SSH address is on `host`, each with its HTTPS one. */
export function sshRemotesOn(remoteV: string, host: string): { name: string; from: string; to: string }[] {
  const seen = new Map<string, { name: string; from: string; to: string }>();
  for (const line of remoteV.split(/\r?\n/)) {
    const [name, url] = line.trim().split(/\s+/);
    const to = url ? httpsUrl(url) : "";
    if (name && to && new URL(to).hostname === host.toLowerCase() && !seen.has(name)) seen.set(name, { name, from: url, to });
  }
  return [...seen.values()];
}

/** Where a host takes a new SSH key. A host that is neither GitHub nor Bitbucket is taken for GitLab. */
export function keysPage(host: string): string {
  if (host === "github.com") return "https://github.com/settings/ssh/new";
  if (host === "bitbucket.org") return "https://bitbucket.org/account/settings/ssh-keys/";
  return `https://${host}/-/user_settings/ssh_keys`;
}

const q = (s: string) => s.replace(/'/g, "''"); // inside PowerShell's single quotes
const qs = (s: string) => s.replace(/'/g, `'\\''`); // inside sh's single quotes

/** The SSH key set-up, as a script: make a key if there is none, put it on the clipboard, open
 *  the host's page for a new key, and once it is added, try it. */
export function sshScript(user: string, host: string, windows: boolean): string {
  const page = keysPage(host);
  return windows ? `$k = Join-Path $HOME '.ssh\\id_ed25519'
if (-not (Test-Path "$k.pub")) {
  New-Item -ItemType Directory -Force -Path (Split-Path $k) | Out-Null
  Write-Host "No SSH key yet: making one at $k."
  Write-Host 'Leave the passphrase empty, unless ssh-agent holds your keys: Deck runs git where nothing can ask for one.'
  ssh-keygen -t ed25519 -f $k -C "$env:USERNAME@$env:COMPUTERNAME"
}
Get-Content "$k.pub" -Raw | Set-Clipboard
Write-Host ''
Write-Host "Your public key ($k.pub) is on the clipboard. Paste it as a new SSH key on ${q(host)}, in the page opening now."
Start-Process '${q(page)}'
Read-Host 'Press Enter once it is added'
ssh -T -o StrictHostKeyChecking=accept-new '${q(user)}@${q(host)}'
Write-Host ''
Write-Host 'A welcome line above means it works: try again in Deck. A key with a passphrase also needs ssh-add.'
` : `k="$HOME/.ssh/id_ed25519"
if [ ! -f "$k.pub" ]; then
  mkdir -p "$HOME/.ssh"
  echo "No SSH key yet: making one at $k."
  echo 'Leave the passphrase empty, unless ssh-agent holds your keys: Deck runs git where nothing can ask for one.'
  ssh-keygen -t ed25519 -f "$k" -C "$(whoami)@$(hostname)"
fi
{ wl-copy < "$k.pub" || xclip -selection clipboard < "$k.pub"; } 2>/dev/null
echo; echo "Your public key ($k.pub), on the clipboard if wl-copy or xclip is installed:"; cat "$k.pub"
echo "Add it as a new SSH key on ${qs(host)}, in the page opening now."
xdg-open '${qs(page)}' >/dev/null 2>&1 &
printf 'Press Enter once it is added'; read _
ssh -T -o StrictHostKeyChecking=accept-new '${qs(user)}@${qs(host)}'
echo; echo 'A welcome line above means it works: try again in Deck. A key with a passphrase also needs ssh-add.'
`;
}
