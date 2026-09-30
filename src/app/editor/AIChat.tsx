import { For, Match, Show, Switch, createEffect, createSignal, useContext } from "solid-js";
import {
    ArrowUp,
    Brain,
    ChevronRight,
    CircleCheck,
    CircleX,
    KeyRound,
    LoaderCircle,
    Minus,
    Settings2,
    Sparkles,
    Square,
    SquarePen,
    Plug,
    Undo2,
    X,
} from "lucide-static";
import { Button, Icon, Input, Select, Tooltip } from "../ui";
import {
    ChatContext,
    PROVIDER_LABELS,
    TOOL_LABELS,
    type ChatItem,
    type Effort,
    type ProviderId,
} from "./ai-chat";
import { renderMarkdown } from "./markdown";
import { ui } from "./ui-state";

const SUGGESTIONS = [
    "Add an animated noise displacement to the sphere",
    "Give it a glowing fresnel rim in cyan",
    "Make a toon shader with 3 bands",
    "Add bloom and a subtle film grain in post",
];

export function AIChat() {
    const chat = useContext(ChatContext);
    return (
        <Show when={chat.state.open}>
            <Show
                when={!chat.state.minimized}
                fallback={
                    <button
                        type="button"
                        data-ui
                        class="absolute right-3 bottom-3 z-30 flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-lg hover:bg-accent"
                        onClick={() => chat.setState((d) => void (d.minimized = false))}
                    >
                        <Icon
                            svg={chat.state.streaming ? LoaderCircle : Sparkles}
                            class={["size-3.5", { "animate-spin": chat.state.streaming }]}
                        />
                        AI Assistant
                    </button>
                }
            >
                <Panel />
            </Show>
        </Show>
    );
}

function Panel() {
    const chat = useContext(ChatContext);
    const modelLabel = () => {
        const id = chat.activeModel();
        const listed = chat.state.models[chat.state.settings.provider]?.find((m) => m.id === id);
        return `${PROVIDER_LABELS[chat.state.settings.provider]} · ${listed?.label ?? id}`;
    };
    return (
        <div
            data-ui
            class="absolute top-12 right-3 bottom-16 z-30 flex w-[360px] flex-col overflow-hidden rounded-lg border bg-card shadow-2xl"
            onKeyDown={(e) => e.stopPropagation()}
        >
            <div class="flex h-12 shrink-0 items-center gap-2 border-b px-3">
                <Icon svg={Sparkles} class="size-3.5 shrink-0 text-blue-400" />
                <div class="flex min-w-0 flex-1 flex-col leading-tight">
                    <span class="text-xs font-semibold whitespace-nowrap">AI Assistant</span>
                    <span class="truncate text-[10px] text-muted-foreground" title={modelLabel()}>
                        {modelLabel()}
                    </span>
                </div>
                <HeaderButton icon={SquarePen} label="New chat" onClick={() => chat.clear()} />
                <HeaderButton
                    icon={Settings2}
                    label="AI Settings"
                    onClick={() => chat.setState((d) => void (d.settingsOpen = !d.settingsOpen))}
                />
                <HeaderButton
                    icon={Minus}
                    label="Minimize Chat"
                    onClick={() => chat.setState((d) => void (d.minimized = true))}
                />
                <HeaderButton
                    icon={X}
                    label="Close"
                    onClick={() => chat.setState((d) => void (d.open = false))}
                />
            </div>
            <Show when={chat.state.settingsOpen} fallback={<Conversation />}>
                <Settings />
            </Show>
        </div>
    );
}

function HeaderButton(props: { icon: string; label: string; onClick: () => void }) {
    return (
        <Tooltip content={props.label} side="bottom">
            <button
                type="button"
                title={props.label}
                aria-label={props.label}
                class="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => props.onClick()}
            >
                <Icon svg={props.icon} class="size-3.5" />
            </button>
        </Tooltip>
    );
}

function Conversation() {
    const chat = useContext(ChatContext);
    const items = () => chat.state.conversation.items;
    const [draft, setDraft] = createSignal("");
    let scroller!: HTMLDivElement;
    let input!: HTMLTextAreaElement;

    // keep the latest output in view while streaming
    createEffect(
        () => {
            const last = items()[items().length - 1];
            return [items().length, last && "text" in last ? last.text.length : 0];
        },
        () => {
            requestAnimationFrame(() => {
                if (scroller) scroller.scrollTop = scroller.scrollHeight;
            });
        },
    );

    const submit = () => {
        const text = draft();
        if (!text.trim() || chat.state.streaming) return;
        setDraft("");
        void chat.send(text);
    };

    const needsKey = () =>
        !chat.state.settings.apiKeys[chat.state.settings.provider] &&
        chat.provider() &&
        !chat.provider()!.serverKey;

    return (
        <>
            <div ref={scroller} class="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
                <Show
                    when={items().length}
                    fallback={
                        <div class="flex h-full flex-col">
                            <McpConnectCard />
                            <div class="flex flex-1 flex-col items-center justify-center gap-3 px-2 text-center">
                                <Icon svg={Sparkles} class="size-6 text-muted-foreground" />
                                <div>
                                    <div class="text-sm font-medium">Start a conversation</div>
                                    <div class="text-xs text-muted-foreground">
                                        Describe what you want to build.
                                    </div>
                                </div>
                                <div class="mt-2 flex w-full flex-col gap-1.5">
                                    <For each={SUGGESTIONS}>
                                        {(s) => (
                                            <button
                                                type="button"
                                                class="rounded-md border px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                                                onClick={() => {
                                                    setDraft(s);
                                                    input.focus();
                                                }}
                                            >
                                                {s}
                                            </button>
                                        )}
                                    </For>
                                </div>
                            </div>
                        </div>
                    }
                >
                    <div class="flex flex-col gap-2.5">
                        <For each={items()} keyed={(i) => i.key}>
                            {(item) => <Item item={item()} />}
                        </For>
                        <Show
                            when={
                                chat.state.streaming &&
                                (() => {
                                    const last = items()[items().length - 1];
                                    return (
                                        !last ||
                                        last.kind === "user" ||
                                        (last.kind === "tool" && last.status !== "running")
                                    );
                                })()
                            }
                        >
                            <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <Icon svg={LoaderCircle} class="size-3 animate-spin" /> Thinking…
                            </div>
                        </Show>
                    </div>
                </Show>
            </div>

            <div class="shrink-0 border-t p-2">
                <Show when={needsKey()}>
                    <button
                        type="button"
                        class="mb-2 flex w-full items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-left text-[11px] text-amber-300"
                        onClick={() => chat.setState((d) => void (d.settingsOpen = true))}
                    >
                        <Icon svg={KeyRound} class="size-3.5 shrink-0" />
                        Add {chat.state.settings.provider === "google" ? "a" : "an"}{" "}
                        {PROVIDER_LABELS[chat.state.settings.provider]} API key in AI Setup (or set{" "}
                        {chat.provider()?.envKeyNames[0]} on the server).
                    </button>
                </Show>
                <div class="flex items-end gap-2 rounded-md border border-input bg-transparent p-1.5 focus-within:ring-2 focus-within:ring-ring/40 dark:bg-input/30">
                    <textarea
                        ref={input}
                        rows={2}
                        class="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
                        placeholder="Describe what you want to build..."
                        value={draft()}
                        onInput={(e) => {
                            setDraft(e.currentTarget.value);
                            e.currentTarget.style.height = "auto";
                            e.currentTarget.style.height = `${Math.min(160, e.currentTarget.scrollHeight)}px`;
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                                e.preventDefault();
                                submit();
                            }
                        }}
                    />
                    <Show
                        when={chat.state.streaming}
                        fallback={
                            <Button
                                size="icon-sm"
                                aria-label="Send"
                                disabled={!draft().trim()}
                                onClick={submit}
                            >
                                <Icon svg={ArrowUp} class="size-4" />
                            </Button>
                        }
                    >
                        <Button
                            size="icon-sm"
                            variant="secondary"
                            aria-label="Stop"
                            onClick={() => chat.stop()}
                        >
                            <Icon svg={Square} class="size-3" />
                        </Button>
                    </Show>
                </div>
                <div class="mt-1 px-1 text-[10px] text-muted-foreground">
                    Enter to send · Shift+Enter for a new line · changes are undoable
                </div>
            </div>
        </>
    );
}

function Item(props: { item: ChatItem }) {
    const chat = useContext(ChatContext);
    const [open, setOpen] = createSignal(false);
    return (
        <Switch>
            <Match when={props.item.kind === "user" && props.item}>
                {(it) => (
                    <div class="ml-8 self-end rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
                        {(it() as { text: string }).text}
                    </div>
                )}
            </Match>
            <Match when={props.item.kind === "text" && props.item}>
                {(it) => (
                    <div
                        class="md text-sm leading-relaxed"
                        innerHTML={renderMarkdown((it() as { text: string }).text)}
                    />
                )}
            </Match>
            <Match when={props.item.kind === "thinking" && props.item}>
                {(it) => (
                    <div class="text-[11px] text-muted-foreground">
                        <button
                            type="button"
                            class="flex items-center gap-1 hover:text-foreground"
                            onClick={() => setOpen(!open())}
                        >
                            <Icon
                                svg={ChevronRight}
                                class={["size-3 transition-transform", { "rotate-90": open() }]}
                            />
                            <Icon svg={Brain} class="size-3" /> Thinking
                        </button>
                        <Show when={open()}>
                            <div class="mt-1 border-l pl-2 whitespace-pre-wrap">
                                {(it() as { text: string }).text}
                            </div>
                        </Show>
                    </div>
                )}
            </Match>
            <Match
                when={
                    props.item.kind === "tool" &&
                    (props.item as Extract<ChatItem, { kind: "tool" }>)
                }
            >
                {(it) => (
                    <div class="rounded-md border bg-background/40 text-[11px]">
                        <button
                            type="button"
                            class="flex w-full items-center gap-2 px-2 py-1.5 text-left"
                            onClick={() => setOpen(!open())}
                            disabled={!it().summary}
                        >
                            <Show
                                when={it().status !== "running"}
                                fallback={
                                    <Icon
                                        svg={LoaderCircle}
                                        class="size-3.5 animate-spin text-blue-400"
                                    />
                                }
                            >
                                <Icon
                                    svg={it().status === "ok" ? CircleCheck : CircleX}
                                    class={[
                                        "size-3.5",
                                        it().status === "ok" ? "text-emerald-400" : "text-red-400",
                                    ]}
                                />
                            </Show>
                            <span class="flex-1 truncate">
                                {TOOL_LABELS[it().name] ?? it().name}
                            </span>
                            <span class="font-mono text-[9px] text-muted-foreground">
                                {it().name}
                            </span>
                        </button>
                        <Show when={open() && it().summary}>
                            <pre class="thin-scroll max-h-40 overflow-auto border-t px-2 py-1.5 font-mono text-[10px] whitespace-pre-wrap text-muted-foreground">
                                {it().summary}
                            </pre>
                        </Show>
                    </div>
                )}
            </Match>
            <Match when={props.item.kind === "error" && props.item}>
                {(it) => (
                    <div class="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">
                        {(it() as { text: string }).text}
                    </div>
                )}
            </Match>
            <Match when={props.item.kind === "notice" && props.item}>
                {(it) => (
                    <div class="text-center text-[11px] text-muted-foreground">
                        {(it() as { text: string }).text}
                    </div>
                )}
            </Match>
            <Match
                when={
                    props.item.kind === "changes" &&
                    (props.item as Extract<ChatItem, { kind: "changes" }>)
                }
            >
                {(it) => (
                    <div class="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300">
                        <Icon svg={CircleCheck} class="size-3.5" />
                        <span class="flex-1">
                            Applied changes ({it().count} step{it().count === 1 ? "" : "s"})
                        </span>
                        <button
                            type="button"
                            class="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-emerald-500/20"
                            onClick={() => chat.undoChanges(it().mark)}
                        >
                            <Icon svg={Undo2} class="size-3" /> Undo
                        </button>
                    </div>
                )}
            </Match>
        </Switch>
    );
}

const KEY_HINT: Record<ProviderId, string> = {
    anthropic: "sk-ant-...",
    openai: "sk-...",
    google: "AIza...",
};

function Settings() {
    const chat = useContext(ChatContext);
    const [key, setKey] = createSignal("");
    const [custom, setCustom] = createSignal(false);
    const pid = () => chat.state.settings.provider;
    const savedKey = () => chat.state.settings.apiKeys[pid()] ?? "";
    const models = () => chat.state.models[pid()] ?? [];
    const reasoningAware = () => {
        const m = chat.activeModel();
        if (pid() === "anthropic") return m !== "claude-haiku-4-5";
        if (pid() === "openai") return /^(o\d|gpt-5)/.test(m);
        return false;
    };
    return (
        <div class="thin-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-xs">
            <div>
                <div class="text-sm font-semibold">AI Setup</div>
                <p class="mt-1 text-muted-foreground">
                    Keys are stored in this browser and sent only to this editor's server, which
                    calls the provider's API.
                </p>
            </div>
            <div class="flex flex-col gap-1.5">
                <span class="font-medium">Provider</span>
                <Select
                    value={pid()}
                    options={(["anthropic", "openai", "google"] as ProviderId[]).map((p) => ({
                        label: PROVIDER_LABELS[p],
                        value: p,
                    }))}
                    onChange={(v) => {
                        chat.saveSettings((s) => void (s.provider = v as ProviderId));
                        setCustom(false);
                        void chat.refreshModels(v as ProviderId);
                    }}
                />
                <Show
                    when={
                        chat.state.conversation.history.length &&
                        chat.state.conversation.provider !== pid()
                    }
                >
                    <span class="text-amber-400">
                        Your next message starts a new conversation with {PROVIDER_LABELS[pid()]}.
                    </span>
                </Show>
            </div>
            <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                    <span class="font-medium">API Key</span>
                    <Show when={savedKey()}>
                        <button
                            type="button"
                            class="text-muted-foreground hover:text-destructive"
                            onClick={() => {
                                chat.saveSettings((s) => void delete s.apiKeys[pid()]);
                                void chat.refreshModels(pid());
                            }}
                        >
                            Clear key
                        </button>
                    </Show>
                </div>
                <Show
                    when={!savedKey()}
                    fallback={
                        <div class="font-mono text-muted-foreground">
                            …{savedKey().slice(-4)} (saved)
                        </div>
                    }
                >
                    <form
                        class="flex gap-1.5"
                        onSubmit={(e) => {
                            e.preventDefault();
                            const k = key().trim();
                            if (k) {
                                chat.saveSettings((s) => void (s.apiKeys[pid()] = k));
                                void chat.refreshModels(pid());
                            }
                            setKey("");
                        }}
                    >
                        <Input
                            type="password"
                            placeholder={KEY_HINT[pid()]}
                            autocomplete="off"
                            value={key()}
                            onInput={(e) => setKey(e.currentTarget.value)}
                        />
                        <Button size="sm" type="submit" disabled={!key().trim()}>
                            Save
                        </Button>
                    </form>
                </Show>
                <Show when={chat.provider()?.serverKey}>
                    <div class="text-emerald-400">
                        The server has {chat.provider()?.envKeyNames.join(" / ")} set — a key here
                        is optional.
                    </div>
                </Show>
            </div>
            <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                    <span class="font-medium">Model</span>
                    <button
                        type="button"
                        class="text-muted-foreground hover:text-foreground"
                        onClick={() => setCustom(!custom())}
                    >
                        {custom() ? "Pick from list" : "Custom ID"}
                    </button>
                </div>
                <Show
                    when={!custom() && models().length}
                    fallback={
                        <Input
                            placeholder={chat.provider()?.defaultModel ?? "model id"}
                            value={chat.state.settings.models[pid()] ?? ""}
                            onChange={(e) => {
                                const v = e.currentTarget.value.trim();
                                chat.saveSettings((s) => {
                                    if (v) s.models[pid()] = v;
                                    else delete s.models[pid()];
                                });
                            }}
                        />
                    }
                >
                    <Select
                        value={chat.activeModel()}
                        options={models().map((m) => ({ label: m.label, value: m.id }))}
                        onChange={(v) => chat.saveSettings((s) => void (s.models[pid()] = v))}
                    />
                </Show>
                <Show when={!models().length}>
                    <span class="text-muted-foreground">
                        {chat.state.modelErrors[pid()]
                            ? `No models found: ${chat.state.modelErrors[pid()]}`
                            : "No models found — add a key, or type a model ID."}
                    </span>
                </Show>
            </div>
            <Show when={reasoningAware()}>
                <div class="flex flex-col gap-1.5">
                    <span class="font-medium">
                        {pid() === "openai" ? "Reasoning effort" : "Effort"}
                    </span>
                    <Select
                        value={chat.state.settings.effort}
                        options={(["low", "medium", "high", "xhigh", "max"] as Effort[]).map(
                            (e) => ({ label: e, value: e }),
                        )}
                        onChange={(v) => chat.saveSettings((s) => void (s.effort = v as Effort))}
                    />
                    <span class="text-muted-foreground">
                        Higher effort plans and checks more carefully but is slower and costs more.
                    </span>
                </div>
            </Show>
            <Button
                size="sm"
                variant="outline"
                onClick={() => chat.setState((d) => void (d.settingsOpen = false))}
            >
                Done
            </Button>
        </div>
    );
}

/**
 * "Connect agent" button (same as the dashboard's) that opens the MCP
 * connection dialog. Shown only in the empty chat, and hidden once an MCP
 * client has connected.
 */
function McpConnectCard() {
    const [connected, setConnected] = createSignal<boolean | null>(null);

    // poll until a client connects
    createEffect(
        () => connected() !== true,
        (watching) => {
            if (!watching) return;
            const check = () =>
                fetch("/api/mcp/status")
                    .then((r) => r.json())
                    .then((s: { connected: boolean }) => setConnected(s.connected))
                    .catch(() => {});
            check();
            const id = setInterval(check, 4000);
            return () => clearInterval(id);
        },
    );

    return (
        <Show when={connected() === false}>
            <div class="mb-2 flex justify-center">
                <Button variant="ghost" size="sm" onClick={() => ui.openDialog("mcp")}>
                    <Icon svg={Plug} class="size-4" /> Connect agent (MCP)
                </Button>
            </div>
        </Show>
    );
}
