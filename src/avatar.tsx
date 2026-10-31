// Who wrote a commit, drawn as a circle: their profile picture from the repo's own host when they
// have one there, their initials on a colour otherwise.
import { useEffect, useId, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { createPortal } from "../shim/react-dom.js";
import { prHost } from "./prhost";

// Avatar palette — deeper than the lane colours so white initials stay readable on them.
const AVATAR_COLORS = ["#3b7dd8", "#4a9d5f", "#b5651d", "#8b5cf6", "#c2410c", "#0891b2", "#be185d", "#65a30d"];

/**
 * A stable colour and initials for one person.
 *
 * Keyed on the email rather than the name: the same person commits as "Hasan" and "Hasan Zarif"
 * across machines, and two contributors can share a first name.
 */
export function avatarOf(name: string, email: string) {
  const key = (email || name).trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0])
    : (parts[0]?.slice(0, 2) ?? "?");
  const n = AVATAR_COLORS.length;
  return { color: AVATAR_COLORS[((h % n) + n) % n], initials: initials.toUpperCase() };
}

// Pictures are asked of the repo's own host (GitHub through gh, GitLab through glab), never a third
// party, once per person per repo for the session, one at a time per repo. A repo whose host cannot
// be asked (no gh, not on GitHub) is not asked again.
const pictures = new Map<string, string | null>();
const queues = new Map<string, Promise<void>>();
const off = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
const bump = () => { version++; for (const f of subs) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

function ask(root: string, email: string) {
  const key = `${root}\n${email}`;
  if (pictures.has(key) || off.has(root)) return;
  pictures.set(key, null);
  const run = () => off.has(root) ? undefined : prHost(root).then((h) => h.picture(email))
    .then((url) => { if (url) { pictures.set(key, url); bump(); } })
    .catch(() => { off.add(root); });
  queues.set(root, (queues.get(root) ?? Promise.resolve()).then(run));
}

/** The picture of whoever commits as `email` in the repo at `root`, once known; null until then or without one. */
export function usePicture(root: string, email: string): string | null {
  useSyncExternalStore(subscribe, () => version);
  const e = email.trim().toLowerCase();
  useEffect(() => { if (root && e) ask(root, e); }, [root, e]);
  return pictures.get(`${root}\n${e}`) ?? null;
}

/** A picture that would not load: the initials again, for every row of that person. */
export function pictureFailed(root: string, email: string) {
  pictures.set(`${root}\n${email.trim().toLowerCase()}`, null);
  bump();
}

/** The author as the commit's node, ringed in its lane's colour — GitKraken's graph reads this way. */
export function AvatarNode({ root, x, y, ring, name, email }: { root: string; x: number; y: number; ring: string; name: string; email: string }) {
  const { color, initials } = avatarOf(name, email);
  const url = usePicture(root, email);
  const clip = "av" + useId().replace(/[^\w-]/g, "");
  const hover = useHoverCard();
  const r = 10;
  return (
    <g onPointerEnter={hover.enter} onPointerLeave={hover.leave}>
      {hover.at && <AuthorCard at={hover.at} root={root} name={name} email={email} />}
      <circle cx={x} cy={y} r={r} fill={color} stroke={ring} strokeWidth={1.5} />
      {url ? <>
        <clipPath id={clip}><circle cx={x} cy={y} r={r} /></clipPath>
        <image href={url} x={x - r} y={y - r} width={r * 2} height={r * 2} clipPath={`url(#${clip})`}
          preserveAspectRatio="xMidYMid slice" onError={() => pictureFailed(root, email)} />
        <circle cx={x} cy={y} r={r} fill="none" stroke={ring} strokeWidth={1.5} />
      </> : (
        <text x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={8.5} fontWeight={600} fill="#fff"
          style={{ pointerEvents: "none" }}>{initials}</text>
      )}
    </g>
  );
}

/** The same, as a page element (the commit panel's author line). */
export function Avatar({ root, name, email, className }: { root: string; name: string; email: string; className: string }) {
  const { color, initials } = avatarOf(name, email);
  const url = usePicture(root, email);
  return url
    ? <img src={url} alt="" className={className + " object-cover"} onError={() => pictureFailed(root, email)} />
    : <span className={className + " grid place-items-center text-[10px] font-semibold text-white"} style={{ background: color }} aria-hidden>{initials}</span>;
}

/** Where an avatar under the pointer is, once it has rested there a moment; null otherwise. */
function useHoverCard() {
  const [at, setAt] = useState<{ rect: DOMRect; doc: Document } | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return {
    at,
    enter: (e: PointerEvent<Element>) => {
      const el = e.currentTarget;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setAt({ rect: el.getBoundingClientRect(), doc: el.ownerDocument }), 300);
    },
    leave: () => { window.clearTimeout(timer.current); setAt(null); },
  };
}

/** Who wrote a commit, beside their circle: a bigger picture, their name and their email. */
function AuthorCard({ at, root, name, email }: { at: { rect: DOMRect; doc: Document }; root: string; name: string; email: string }) {
  const { rect, doc } = at;
  const win = doc.defaultView ?? window;
  const width = 240;
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - 24, win.innerWidth - width - 8));
  const below = rect.bottom + 64 < win.innerHeight;
  return createPortal(
    <div className="pointer-events-none fixed z-[120] flex animate-[menu-in_110ms_ease-out] items-center gap-2.5 rounded-[10px] border border-subtle bg-card p-2.5 shadow-2xl"
      style={{ left, width, ...(below ? { top: rect.bottom + 6 } : { bottom: win.innerHeight - rect.top + 6 }) }}>
      <Avatar root={root} name={name} email={email} className="size-9 shrink-0 rounded-full" />
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-medium text-text-primary">{name}</div>
        {email && <div className="truncate text-[11.5px] text-text-muted">{email}</div>}
      </div>
    </div>,
    doc.body,
  );
}
