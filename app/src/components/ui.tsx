import type { ReactNode } from "react";

/**
 * A deterministic avatar for a token.
 *
 * Tokens on Arc have no logo registry, so rather than show a grey blank we derive a stable
 * gradient from the contract address. The same token always renders the same way, which is enough
 * for people to tell rows apart at a glance — the job a logo actually does in a table.
 */
export function TokenAvatar({
  address,
  symbol,
  size = 36,
}: {
  address: string;
  symbol: string;
  size?: number;
}) {
  const seed = parseInt(address.slice(2, 10), 16) || 0;
  const hue = seed % 360;
  const hue2 = (hue + 48) % 360;
  const initials = symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 3) || "?";

  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * (initials.length > 2 ? 0.3 : 0.36),
        background: `linear-gradient(135deg, hsl(${hue} 72% 58%), hsl(${hue2} 68% 44%))`,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.35) inset, 0 3px 10px -3px hsl(${hue} 70% 45% / 0.5)`,
      }}
    >
      {initials}
    </span>
  );
}

/** A pair avatar: the token overlapping the USDC mark. */
export function PairAvatar({ address, symbol }: { address: string; symbol: string }) {
  return (
    <span className="flex shrink-0 items-center">
      <TokenAvatar address={address} symbol={symbol} size={34} />
      <span
        aria-hidden
        className="-ml-3 inline-grid size-[26px] place-items-center rounded-full bg-[#2775CA] text-[9px] font-bold text-white ring-2 ring-[var(--color-surface)]"
        title="USDC"
      >
        $
      </span>
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  loading,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  tone?: "default" | "accent" | "warn";
  loading?: boolean;
}) {
  const toneClass =
    tone === "accent"
      ? "text-[var(--color-accent)]"
      : tone === "warn"
        ? "text-[var(--color-warn)]"
        : "text-[var(--color-text)]";

  return (
    <div className="panel px-4 py-3.5">
      <div className="label">{label}</div>
      {loading ? (
        <div className="skeleton mt-2 h-6 w-24" />
      ) : (
        <div className={`num mt-1.5 text-[22px] font-semibold leading-none ${toneClass}`}>
          {value}
        </div>
      )}
      {hint && <div className="mt-1.5 text-xs text-[var(--color-dim)]">{hint}</div>}
    </div>
  );
}

/** The header metric strip: a few numbers, no chrome, sitting above the content. */
export function StatBar({
  items,
}: {
  items: { label: string; value: string; tone?: "default" | "accent" }[];
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-9 gap-y-5">
      {items.map((it) => (
        <div key={it.label}>
          <div className="label">{it.label}</div>
          <div
            className={`num mt-1.5 text-2xl font-semibold leading-none ${
              it.tone === "accent" ? "text-[var(--color-accent)]" : ""
            }`}
          >
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "up" | "down" | "warn" | "accent";
}) {
  const map = {
    neutral: "bg-[var(--color-surface-3)] text-[var(--color-muted)]",
    up: "bg-[var(--color-up-dim)] text-[var(--color-up)]",
    down: "bg-[#fde7ea] text-[var(--color-down)]",
    warn: "bg-[var(--color-warn-dim)] text-[var(--color-warn)]",
    accent: "bg-[var(--color-accent-dim)] text-[var(--color-accent-deep)]",
  } as const;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function LiveBadge({ warm }: { warm: boolean }) {
  return warm ? (
    <Badge tone="up">
      <span className="live-dot size-1.5 rounded-full bg-[var(--color-up)]" />
      Live
    </Badge>
  ) : (
    <Badge tone="warn">
      <span className="live-dot size-1.5 rounded-full bg-[var(--color-warn)]" />
      Warming
    </Badge>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
        {subtitle && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-muted)]">
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
