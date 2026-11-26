// Someone on a pull request, as a round picture: from the host (GitHub's by login, GitLab's from
// what it sent), their initials on a colour when there is none or it will not load.
import { useState } from "react";
import { avatarOf } from "../avatar";
import type { PrHost } from "../prhost";

/** Where `login`'s picture is: GitLab's as given, GitHub's by the login itself (not for apps). */
export const pictureOf = (host: PrHost, login: string, given?: string) =>
  given || (host.kind === "github" && /^[\w-]+$/.test(login) ? `https://avatars.githubusercontent.com/${login}?s=64` : undefined);

export function Person({ name, url, size, dot }: {
  name: string; url?: string; size: number;
  /** A check-state colour, as a small dot on its lower right. */
  dot?: string;
}) {
  const [failed, setFailed] = useState(false);
  const { color, initials } = avatarOf(name, "");
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }} aria-hidden>
      {url && !failed
        ? <img src={url} alt="" className="size-full rounded-full object-cover" onError={() => setFailed(true)} />
        : <span className="grid size-full place-items-center rounded-full font-semibold text-white" style={{ background: color, fontSize: Math.round(size * 0.42) }}>{initials}</span>}
      {dot && <span className="absolute rounded-full" style={{ width: 8, height: 8, right: -1, bottom: -1, background: dot, boxShadow: "0 0 0 2px var(--bg-panel)" }} />}
    </span>
  );
}
