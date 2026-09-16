"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Motion used deliberately, on a page about money.
 *
 * Two rules hold throughout this file. Nothing animates behind text a person is trying to read,
 * and everything here honours `prefers-reduced-motion` — for a vestibular disorder a drifting
 * background is not decoration, it is a reason to close the tab. The CSS carries the media query;
 * the hooks below check it before starting any JavaScript-driven loop.
 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** A number that counts up to its target once, when it first scrolls into view. */
export function CountUp({
  to,
  decimals = 0,
  prefix = "",
  suffix = "",
  durationMs = 1100,
}: {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  const reduced = usePrefersReducedMotion();
  const done = useRef(false);

  useEffect(() => {
    if (reduced) {
      setValue(to);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || done.current) return;
        done.current = true;
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / durationMs);
          // easeOutCubic: fast first, settling rather than stopping dead
          setValue(to * (1 - Math.pow(1 - t, 3)));
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to, durationMs, reduced]);

  return (
    <span ref={ref} className="num tabular-nums">
      {prefix}
      {value.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}

/** Fades and lifts its children in as they enter the viewport. */
export function Reveal({
  children,
  delayMs = 0,
  className = "",
}: {
  children: React.ReactNode;
  delayMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => e?.isIntersecting && setShown(true),
      { threshold: 0.12 },
    );
    io.observe(el);

    // Reveal regardless after a moment. Hiding content until an observer fires means that if it
    // never fires the content is simply gone — and there are several ordinary ways for that to
    // happen: a zero-height container at observe time, a browser without IntersectionObserver, a
    // screenshot or print that never scrolls. An animation failing should cost the animation, not
    // the page.
    const failsafe = setTimeout(() => setShown(true), 1200);

    return () => {
      io.disconnect();
      clearTimeout(failsafe);
    };
  }, [reduced]);

  return (
    <div
      ref={ref}
      className={`transition-[opacity,transform] duration-700 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      } ${className}`}
      style={{ transitionDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  );
}

/**
 * A tilt that follows the cursor.
 *
 * Pointer-driven, not hover-driven, so it never fires on touch — a card that tilts and stays
 * tilted after a tap is worse than one that does nothing.
 */
export function TiltCard({
  children,
  className = "",
  max = 6,
}: {
  children: React.ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0 });
  const reduced = usePrefersReducedMotion();

  const onMove = (e: React.PointerEvent) => {
    if (reduced || e.pointerType !== "mouse") return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setT({
      x: ((e.clientY - r.top) / r.height - 0.5) * -2 * max,
      y: ((e.clientX - r.left) / r.width - 0.5) * 2 * max,
    });
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={() => setT({ x: 0, y: 0 })}
      className={`transition-transform duration-200 ease-out ${className}`}
      style={{
        transform: `perspective(900px) rotateX(${t.x}deg) rotateY(${t.y}deg)`,
        transformStyle: "preserve-3d",
      }}
    >
      {children}
    </div>
  );
}

/** A seamless horizontal scroll. Duplicated content is what makes the loop invisible. */
export function Marquee({
  children,
  durationSec = 40,
}: {
  children: React.ReactNode;
  durationSec?: number;
}) {
  return (
    <div className="marquee">
      <div className="marquee-track" style={{ animationDuration: `${durationSec}s` }}>
        <div className="marquee-group">{children}</div>
        {/* The copy is what lets the track reset without a visible jump. Hidden from assistive
            tech so the same items are not announced twice. */}
        <div className="marquee-group" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * A live price line, drawn from real observations.
 *
 * Takes whatever samples it is given and scales to fit, so a flat series and a violent one both
 * stay legible. Its whole job is to show that the figures on this page come from a chain that is
 * moving, not from a fixture.
 */
export function Sparkline({
  points,
  width = 320,
  height = 64,
  tone = "var(--color-accent)",
}: {
  points: number[];
  width?: number;
  height?: number;
  tone?: string;
}) {
  if (points.length < 2) {
    return <div className="skeleton" style={{ width, height, borderRadius: 8 }} />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 4;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((p - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width - pad},${height} L${pad},${height} Z`;
  const last = coords[coords.length - 1]!;
  const rising = points[points.length - 1]! >= points[0]!;
  const stroke = rising ? tone : "var(--color-down)";

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={stroke} />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={stroke} className="spark-pulse" />
    </svg>
  );
}
