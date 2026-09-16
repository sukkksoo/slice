import Link from "next/link";
import type { ReactNode } from "react";

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="mt-12 scroll-mt-24 border-t border-[var(--color-border)] pt-8 text-xl font-semibold tracking-[-0.02em] first:mt-0 first:border-0 first:pt-0"
    >
      {children}
    </h2>
  );
}

export function H3({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="mt-8 scroll-mt-24 text-base font-semibold tracking-[-0.01em]">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[15px] leading-[1.75] text-[var(--color-muted)]">{children}</p>;
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-[var(--color-text)]">{children}</strong>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="mt-4 space-y-3">{children}</ul>;
}

export function LI({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3 text-[15px] leading-[1.7] text-[var(--color-muted)]">
      <span
        aria-hidden
        className="mt-[9px] size-1.5 shrink-0 rounded-full bg-[var(--color-border-strong)]"
      />
      <span>{children}</span>
    </li>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="mono rounded-md bg-[var(--color-surface-3)] px-1.5 py-0.5 text-[13px] text-[var(--color-text)]">
      {children}
    </code>
  );
}

export function Pre({ children }: { children: ReactNode }) {
  return (
    <pre className="mono mt-5 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-5 py-4 text-[12.5px] leading-[1.7] text-[var(--color-muted)]">
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
  const styles = {
    note: { bar: "bg-[var(--color-border-strong)]", label: "text-[var(--color-text)]" },
    warn: { bar: "bg-[var(--color-warn)]", label: "text-[var(--color-warn)]" },
    good: { bar: "bg-[var(--color-accent)]", label: "text-[var(--color-accent)]" },
  }[tone];

  return (
    <div className="panel mt-5 flex overflow-hidden">
      <div className={`w-[3px] shrink-0 ${styles.bar}`} />
      <div className="px-5 py-4">
        {title && <div className={`text-[13px] font-semibold ${styles.label}`}>{title}</div>}
        <div className="mt-1.5 text-[14px] leading-[1.7] text-[var(--color-muted)]">{children}</div>
      </div>
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="panel mt-5 overflow-x-auto">
      <table className="w-full min-w-[480px] text-left">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            {head.map((h) => (
              <th key={h} className="label px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-row">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="px-4 py-3.5 align-top text-[14px] leading-[1.65] text-[var(--color-muted)]"
                >
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
  const cls = "text-[var(--color-accent)] underline-offset-2 hover:underline";
  if (href.startsWith("http")) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function DocHeader({ kicker, title, lede }: { kicker: string; title: string; lede?: string }) {
  return (
    <header className="mb-10">
      <div className="label text-[var(--color-accent)]">{kicker}</div>
      <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-[-0.03em]">{title}</h1>
      {lede && (
        <p className="mt-4 text-[17px] leading-relaxed text-[var(--color-muted)]">{lede}</p>
      )}
    </header>
  );
}
