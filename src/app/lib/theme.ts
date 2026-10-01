import { createSignal } from "solid-js";
import { setTheme as setGraphTheme } from "tsl-graph/ui";

type Theme = "dark" | "light";

function initial(): Theme {
  try {
    const t = localStorage.getItem("tsl-theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    // ignore
  }
  return "dark";
}

/** .dark for the site's own styles, .tsl-dark for tsl-graph styles used outside the editor (docs node cards). */
function applyClasses(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
  document.documentElement.classList.toggle("tsl-dark", t === "dark");
}

const [theme, setThemeSignal] = createSignal<Theme>(initial());
applyClasses(theme());
// dialogs and menus from tsl-graph/ui (used by the pages too) follow the site theme
setGraphTheme(theme());

export { theme };

export function setTheme(t: Theme) {
  setThemeSignal(t);
  setGraphTheme(t);
  applyClasses(t);
  try {
    localStorage.setItem("tsl-theme", t);
  } catch {
    // ignore
  }
}

export function toggleTheme() {
  setTheme(theme() === "dark" ? "light" : "dark");
}
