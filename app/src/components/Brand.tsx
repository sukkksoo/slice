/**
 * The mark: a flow being cut into measured portions.
 *
 * Drawn rather than lettered — the name is about taking a measured slice off a stream, which is
 * exactly what the protocol does with trading fees.
 */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[10px]"
      style={{
        width: size,
        height: size,
        background:
          "linear-gradient(135deg, var(--color-accent-bright), var(--color-accent) 55%, var(--color-violet))",
        boxShadow: "var(--shadow-brand)",
      }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" aria-hidden>
        {/* the flow */}
        <path d="M2 8h20M2 16h20" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity="0.5" />
        {/* the cut */}
        <path d="M15 2 L9 22" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/**
 * Animated hero artwork: value entering the vault, being sliced, and streaming out.
 *
 * A diagram of the actual mechanism rather than decoration — the inbound streams are trading fees,
 * the gate is the harvest, and the outbound dots are the seven-day payout. Motion is CSS-driven
 * and disabled under prefers-reduced-motion.
 */
export function FlowDiagram() {
  return (
    <svg
      viewBox="0 0 420 260"
      className="h-auto w-full"
      role="img"
      aria-label="Trading fees flowing into a vault, sliced by a harvest, and streaming out as USDC"
    >
      <defs>
        <linearGradient id="sl-stream" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#5b8cff" stopOpacity="0" />
          <stop offset="50%" stopColor="#3b6ff0" stopOpacity="1" />
          <stop offset="100%" stopColor="#6e5ae6" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="sl-pool" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b8cff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#6e5ae6" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id="sl-out" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#3b6ff0" />
          <stop offset="100%" stopColor="#17b9d6" />
        </linearGradient>
        <filter id="sl-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {[
        { y: 62, delay: "0s" },
        { y: 130, delay: "1.1s" },
        { y: 198, delay: "2.2s" },
      ].map((s, i) => (
        <g key={i}>
          <path d={`M8 ${s.y} H176`} stroke="#dcdff3" strokeWidth="2.5" strokeLinecap="round" />
          <path
            d={`M8 ${s.y} H176`}
            stroke="url(#sl-stream)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="34 220"
            className="sl-flow"
            style={{ animationDelay: s.delay }}
          />
        </g>
      ))}
      <text x="92" y="44" textAnchor="middle" fill="#8b88a8" fontSize="11" fontWeight="600">
        swap fees
      </text>

      <rect x="182" y="40" width="56" height="180" rx="14" fill="url(#sl-pool)" stroke="#c3c8e8" />
      <path d="M210 52 V208" stroke="#3b6ff0" strokeWidth="2.5" strokeLinecap="round" opacity="0.45" />
      <circle cx="210" cy="130" r="9" fill="#3b6ff0" filter="url(#sl-glow)" className="sl-pulse" />
      <text x="210" y="240" textAnchor="middle" fill="#5b5780" fontSize="11" fontWeight="600">
        harvest
      </text>

      <path d="M244 130 H408" stroke="#dcdff3" strokeWidth="2.5" strokeLinecap="round" />
      {[0, 1, 2, 3].map((i) => (
        <circle
          key={i}
          cx="244"
          cy="130"
          r="4"
          fill="url(#sl-out)"
          className="sl-drift"
          style={{ animationDelay: `${i * 0.8}s` }}
        />
      ))}
      <text x="326" y="112" textAnchor="middle" fill="#8b88a8" fontSize="11" fontWeight="600">
        streamed to stakers
      </text>
    </svg>
  );
}
