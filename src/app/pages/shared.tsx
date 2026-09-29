export function Logo(props: { size?: "sm" | "md" | "lg" }) {
  const s = () => props.size ?? "sm";
  return (
    <div class="flex select-none flex-col items-center leading-none">
      <span
        class={[
          "font-black tracking-tight",
          { "text-[13px]": s() === "sm", "text-lg": s() === "md", "text-3xl": s() === "lg" },
        ]}
      >
        TSL
      </span>
      <span
        class={[
          "font-semibold text-muted-foreground",
          {
            "text-[6px] tracking-[0.25em]": s() === "sm",
            "text-[9px] tracking-[0.35em]": s() === "md",
            "text-[11px] tracking-[0.4em]": s() === "lg",
          },
        ]}
      >
        GRAPH
      </span>
    </div>
  );
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
