import { createSignal } from "solid-js";

// Local-first: there is no account system, "Continue as Guest" just marks the
// browser as signed in. OAuth buttons are shown for parity but disabled.

export interface User {
  name: string;
  guest: boolean;
}

function read(): User | null {
  try {
    const raw = localStorage.getItem("tsl-user");
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

const [user, setUser] = createSignal<User | null>(read());
export { user };

export function signInAsGuest() {
  const u = { name: "Guest", guest: true };
  try {
    localStorage.setItem("tsl-user", JSON.stringify(u));
  } catch {
    // storage unavailable: session-only sign in
  }
  setUser(u);
}

export function signOut() {
  try {
    localStorage.removeItem("tsl-user");
  } catch {
    // ignore
  }
  setUser(null);
}
