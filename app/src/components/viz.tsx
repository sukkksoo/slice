/**
 * Small data visualisations.
 *
 * Every one of these is driven by state the contracts actually expose — a composition split, a
 * configured fee split, a stream's position in its own seven-day window. Nothing here invents a
 * series: there is no indexer yet, so anything resembling price or volume history would be
 * fabricated, and a chart that lies is worse than no chart.
 */

/** A two-segment bar showing how a pool's value is split between USDC and the token. */
export function CompositionBar({
  usdcValue,
  assetValue,
  symbol,
}: {
  usdcValue: bigint;
  assetValue: bigint;
  symbol: string;
}) {
  const total = usdcValue + assetValue;
  const usdcPct = total === 0n ? 50 : Number((usdcValue * 1000n) / total) / 10;

  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
        <div
          className="h-full transition-[width] duration-700"
          style={{ width: `${usdcPct}%`, background: "#2775CA" }}
        />
        <div
          className="h-full flex-1 transition-[width] duration-700"
          style={{
            background: "linear-gradient(90deg, var(--color-violet), var(--color-cyan))",
          }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: "#2775CA" }} />
          USDC <span className="num">{usdcPct.toFixed(0)}%</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ background: "linear-gradient(90deg, var(--color-violet), var(--color-cyan))" }}
          />
          {symbol} <span className="num">{(100 - usdcPct).toFixed(0)}%</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Where each harvest goes: the protocol's cut, the staker stream, and the compounding queue.
 * Read straight from `protocolFeeBps` and `streamBps`.
 */
export function FeeSplitBar({
  protocolFeeBps,
  streamBps,
}: {
  protocolFeeBps: number;
  streamBps: number;
}) {
  const protocolPct = protocolFeeBps / 100;
  const remaining = 100 - protocolPct;
  const streamPct = (remaining * streamBps) / 10_000;
  const compoundPct = remaining - streamPct;

  const segments = [
    { pct: streamPct, color: "linear-gradient(90deg, var(--color-accent-bright), var(--color-accent))", label: "Streamed" },
    { pct: compoundPct, color: "linear-gradient(90deg, var(--color-violet), var(--color-cyan))", label: "Compounded" },
    { pct: protocolPct, color: "var(--color-border-strong)", label: "Protocol" },
  ].filter((s) => s.pct > 0);

  return (
    <div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {segments.map((s) => (
          <div
            key={s.label}
            className="h-full transition-[width] duration-700"
            style={{ width: `${s.pct}%`, background: s.color }}
          />
        ))}
      </div>
      <dl className="mt-2.5 space-y-1">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center justify-between text-[11px]">
            <dt className="flex items-center gap-1.5 text-[var(--color-muted)]">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </dt>
            <dd className="num text-[var(--color-text)]">{s.pct.toFixed(1)}%</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * How far through its seven-day payout the current stream is.
 *
 * Derived from `periodFinish` and the known duration, so it is exact rather than estimated.
 */
export function StreamRing({
  periodFinish,
  durationSeconds,
  size = 108,
}: {
  periodFinish: bigint;
  durationSeconds: number;
  size?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const finish = Number(periodFinish);
  const remaining = Math.max(0, finish - now);
  const elapsed = Math.max(0, Math.min(durationSeconds, durationSeconds - remaining));
  const pct = durationSeconds === 0 ? 0 : elapsed / durationSeconds;

  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const active = finish > now;

  const days = Math.floor(remaining / 86_400);
  const hours = Math.floor((remaining % 86_400) / 3_600);

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--color-accent-bright)" />
              <stop offset="100%" stopColor="var(--color-violet)" />
            </linearGradient>
          </defs>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-surface-3)"
            strokeWidth="7"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="url(#ring-grad)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            className="transition-[stroke-dashoffset] duration-1000"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="num text-lg font-semibold">{(pct * 100).toFixed(0)}%</span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="label">Stream progress</div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-muted)]">
          {active ? (
            <>
              <span className="num font-semibold text-[var(--color-text)]">
                {days}d {hours}h
              </span>{" "}
              left of this seven-day payout.
            </>
          ) : (
            "No stream running. The next harvest starts one."
          )}
        </p>
      </div>
    </div>
  );
}

/** A compact gauge for a percentage, used for APR and utilisation-style figures. */
export function MiniMeter({ pct, tone = "accent" }: { pct: number; tone?: "accent" | "up" }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const bg =
    tone === "up"
      ? "var(--color-up)"
      : "linear-gradient(90deg, var(--color-accent-bright), var(--color-violet))";

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-3)]">
      <div
        className="h-full rounded-full transition-[width] duration-700"
        style={{ width: `${clamped}%`, background: bg }}
      />
    </div>
  );
}
