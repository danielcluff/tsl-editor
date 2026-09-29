import { createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";

// Minimal history router: the app has a handful of routes, so a signal on
// location.pathname is all we need.

const [path, setPath] = createSignal(location.pathname);
const [search, setSearch] = createSignal(location.search);

window.addEventListener("popstate", () => {
  setPath(location.pathname);
  setSearch(location.search);
});

export { path, search };

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = new URL(to, location.origin);
  if (opts.replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  setPath(url.pathname);
  setSearch(url.search);
  window.scrollTo(0, 0);
}

export function match(pattern: string, p: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = p.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function A(props: JSX.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      {...props}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || props.target === "_blank") return;
        if (!props.href.startsWith("/")) return;
        e.preventDefault();
        navigate(props.href);
      }}
    />
  );
}
