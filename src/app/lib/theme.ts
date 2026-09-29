import { createSignal } from "solid-js";

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

const [theme, setThemeSignal] = createSignal<Theme>(initial());
document.documentElement.classList.toggle("dark", theme() === "dark");

export { theme };

export function setTheme(t: Theme) {
  setThemeSignal(t);
  document.documentElement.classList.toggle("dark", t === "dark");
  try {
    localStorage.setItem("tsl-theme", t);
  } catch {
    // ignore
  }
}

export function toggleTheme() {
  setTheme(theme() === "dark" ? "light" : "dark");
}
