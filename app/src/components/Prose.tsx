import Link from "next/link";
import type { ReactNode } from "react";

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mt-10 scroll-mt-24 text-base font-semibold tracking-tight first:mt-0">
      {children}
    </h2>
  );
}

export function H3({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="mt-7 scroll-mt-24 text-sm font-semibold tracking-tight">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs leading-relaxed text-[var(--color-muted)]">{children}</p>;
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-[var(--color-text)]">{children}</strong>;
}

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="mt-3 space-y-2 text-xs leading-relaxed text-[var(--color-muted)]">{children}</ul>
  );
}

export function LI({ children }: { children: ReactNode }) {
  return (
    <li className="relative pl-4 before:absolute before:left-0 before:text-[var(--color-accent)] before:content-['·']">
      {children}
    </li>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-[var(--color-panel-2)] px-1 py-0.5 text-[11px] text-[var(--color-text)]">
      {children}
    </code>
  );
}

export function Pre({ children }: { children: ReactNode }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-4 py-3 text-[11px] leading-relaxed text-[var(--color-muted)]">
      {children}
    </pre>
  );
}

export function Callout({
  children,
  tone = "note",
  title,
}: {
  children: ReactNode;
  tone?: "note" | "warn" | "good";
  title?: string;
}) {
  const border =
    tone === "warn"
      ? "border-[var(--color-warn)]"
      : tone === "good"
        ? "border-[var(--color-accent)]"
        : "border-[var(--color-border)]";
  const label =
    tone === "warn"
      ? "text-[var(--color-warn)]"
      : tone === "good"
        ? "text-[var(--color-accent)]"
        : "text-[var(--color-text)]";

  return (
    <div className={`mt-4 rounded-lg border ${border} bg-[var(--color-panel)] px-4 py-3`}>
      {title && <div className={`text-[11px] font-semibold ${label}`}>{title}</div>}
      <div className="text-[11px] leading-relaxed text-[var(--color-muted)]">{children}</div>
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-left text-[11px]">
        <thead className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
          <tr className="border-b border-[var(--color-border)]">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top text-[var(--color-muted)]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http");
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-[var(--color-accent)] underline-offset-2 hover:underline"
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className="text-[var(--color-accent)] underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
