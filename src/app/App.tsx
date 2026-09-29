import { Errored, Loading, Match, Switch, createMemo, lazy } from "solid-js";
import { match, path } from "./lib/router";
import { Landing } from "./pages/Landing";
import { SignIn } from "./pages/SignIn";
import { Dashboard } from "./pages/Dashboard";
import { DocsNodes, DocsNode } from "./pages/Docs";

const EditorPage = lazy(() => import("./editor/EditorPage"));

export function App() {
  return (
    <Errored
      fallback={(err, reset) => (
        <div class="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center">
          <div class="text-lg font-semibold">Something went wrong</div>
          <pre class="max-w-2xl overflow-auto rounded-md bg-muted p-3 text-left text-xs whitespace-pre-wrap">{String(err())}</pre>
          <button type="button" class="rounded-md border px-3 py-1.5 text-sm" onClick={() => reset()}>
            Try again
          </button>
        </div>
      )}
    >
      <Loading fallback={<div class="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
        <Routes />
      </Loading>
    </Errored>
  );
}

function Routes() {
  const editor = createMemo(() => match("/editor/:id", path()));
  const docNode = createMemo(() => match("/docs/nodes/:slug", path()));
  return (
    <Switch fallback={<NotFound />}>
      <Match when={path() === "/"}>
        <Landing />
      </Match>
      <Match when={path() === "/sign-in"}>
        <SignIn />
      </Match>
      <Match when={path() === "/dashboard"}>
        <Dashboard />
      </Match>
      <Match when={editor()} keyed>
        {(params) => <EditorPage id={params.id} />}
      </Match>
      <Match when={path() === "/docs/nodes" || path() === "/docs"}>
        <DocsNodes />
      </Match>
      <Match when={docNode()}>{(params) => <DocsNode slug={params().slug} />}</Match>
    </Switch>
  );
}

function NotFound() {
  return (
    <div class="flex h-screen items-center justify-center text-muted-foreground">
      <div class="text-center">
        <div class="text-5xl font-black text-foreground">404</div>
        <a class="mt-4 inline-block underline" href="/">
          Go home
        </a>
      </div>
    </div>
  );
}
