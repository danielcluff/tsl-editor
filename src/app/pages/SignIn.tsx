import { navigate, search } from "../lib/router";
import { signInAsGuest } from "../lib/session";
import { Button } from "../ui";
import { Logo } from "./shared";

const GOOGLE = (
  <svg viewBox="0 0 24 24" class="size-4">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
  </svg>
);

const GITHUB = (
  <svg viewBox="0 0 24 24" class="size-4" fill="currentColor">
    <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1 .9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" />
  </svg>
);

export function SignIn() {
  const redirect = () => new URLSearchParams(search()).get("redirect") || "/dashboard";
  const guest = () => {
    signInAsGuest();
    navigate(redirect(), { replace: true });
  };
  return (
    <div class="noise-bg relative flex min-h-screen items-center justify-center">
      <div class="w-full max-w-[380px] rounded-xl border border-white/10 bg-[#0b0f18] p-6 text-white shadow-2xl">
        <div class="mb-6 flex justify-center">
          <Logo size="md" />
        </div>
        <div class="flex flex-col gap-3">
          <Button variant="outline" class="w-full border-white/10 bg-white/5 text-white" disabled title="OAuth is not configured in this local build">
            {GOOGLE} Continue with Google
          </Button>
          <Button variant="outline" class="w-full border-white/10 bg-white/5 text-white" disabled title="OAuth is not configured in this local build">
            {GITHUB} Continue with GitHub
          </Button>
        </div>
        <div class="my-4 flex items-center gap-3 text-[10px] text-white/40">
          <div class="h-px flex-1 bg-white/10" />
          OR
          <div class="h-px flex-1 bg-white/10" />
        </div>
        <Button variant="ghost" class="w-full text-white hover:bg-white/10 hover:text-white" onClick={guest}>
          Continue as Guest
        </Button>
      </div>
    </div>
  );
}
