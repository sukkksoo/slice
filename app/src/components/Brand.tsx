/**
 * The mark: a sluice gate with liquidity flowing through it.
 *
 * Drawn rather than lettered, because the product name is a piece of waterworks vocabulary and the
 * mechanism it describes — a gate metering a flow — is the whole protocol in one picture.
 */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[var(--color-accent-bright)] to-[var(--color-accent)] shadow-[0_4px_14px_-4px_rgba(52,211,153,0.6)]"
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.62}
        height={size * 0.62}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        role="presentation"
      >
        {/* flow lines */}
        <path
          d="M2 7h7M2 12h5M2 17h7"
          stroke="#04120c"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.55"
        />
        {/* the gate */}
        <path d="M13 3v18" stroke="#04120c" strokeWidth="2.6" strokeLinecap="round" />
        {/* metered outflow */}
        <path
          d="M16 12h6"
          stroke="#04120c"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/**
 * Animated hero artwork: value entering a pool, being metered, and streaming out.
 *
 * Deliberately a diagram of the actual mechanism rather than decoration — the three inbound
 * streams are trading fees, the gate is the harvest, and the steady outbound dashes are the
 * seven-day payout. Motion is CSS-driven and disabled under prefers-reduced-motion.
 */
export function FlowDiagram() {
  return (
    <svg
      viewBox="0 0 420 260"
      className="h-auto w-full"
      role="img"
      aria-label="Trading fees flowing into a vault, metered by a harvest, and streaming out as USDC"
    >
      <defs>
        <linearGradient id="sl-stream" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#5eead4" stopOpacity="0" />
          <stop offset="50%" stopColor="#5eead4" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="sl-pool" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0.02" />
        </linearGradient>
        <filter id="sl-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* inbound fee streams */}
      {[
        { y: 62, delay: "0s", label: "swap" },
        { y: 130, delay: "1.1s", label: "swap" },
        { y: 198, delay: "2.2s", label: "swap" },
      ].map((s, i) => (
        <g key={i}>
          <path
            d={`M8 ${s.y} H176`}
            stroke="#1b202b"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d={`M8 ${s.y} H176`}
            stroke="url(#sl-stream)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="34 220"
            className="sl-flow"
            style={{ animationDelay: s.delay }}
          />
        </g>
      ))}

      {/* the gate */}
      <rect
        x="182"
        y="40"
        width="56"
        height="180"
        rx="12"
        fill="url(#sl-pool)"
        stroke="#2a3140"
      />
      <path d="M210 52 V208" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
      <circle cx="210" cy="130" r="9" fill="#34d399" filter="url(#sl-glow)" className="sl-pulse" />
      <text
        x="210"
        y="240"
        textAnchor="middle"
        fill="#5a6376"
        fontSize="11"
        fontFamily="var(--ui-sans)"
      >
        harvest
      </text>

      {/* metered outbound stream */}
      <path d="M244 130 H408" stroke="#1b202b" strokeWidth="2" strokeLinecap="round" />
      {[0, 1, 2, 3].map((i) => (
        <circle
          key={i}
          cx="244"
          cy="130"
          r="3.5"
          fill="#5eead4"
          className="sl-drift"
          style={{ animationDelay: `${i * 0.8}s` }}
        />
      ))}
      <text
        x="326"
        y="112"
        textAnchor="middle"
        fill="#5a6376"
        fontSize="11"
        fontFamily="var(--ui-sans)"
      >
        streamed to stakers
      </text>
    </svg>
  );
}
