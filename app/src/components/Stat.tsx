export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "warn";
}) {
  const toneClass =
    tone === "accent"
      ? "text-[var(--color-accent)]"
      : tone === "warn"
        ? "text-[var(--color-warn)]"
        : "text-[var(--color-text)]";

  return (
    <div className="panel px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className={`num mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">{hint}</div>}
    </div>
  );
}
