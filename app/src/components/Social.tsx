"use client";

import { useEffect, useState } from "react";

/**
 * Where the project's social links live. One place, so the corner button, the footer and anything
 * added later cannot drift apart. Set NEXT_PUBLIC_TWITTER_URL to override without a code change.
 */
export const SOCIALS = {
  x: process.env.NEXT_PUBLIC_TWITTER_URL ?? "",
  github: "https://github.com/sukkksoo/slice",
} as const;

function XLogo({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function GitHubLogo({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}

/**
 * A floating link cluster, bottom-right.
 *
 * It appears only after the visitor has scrolled a little: on first paint the header is right
 * there with everything they need, and a button that slides over the hero the instant the page
 * opens is an interruption rather than an affordance.
 *
 * The X link is omitted entirely until a URL is configured, rather than rendering a dead button —
 * a social icon that goes nowhere reads as a broken site.
 */
export function SocialDock() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > 320);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    SOCIALS.x ? { href: SOCIALS.x, label: "Slice on X", icon: <XLogo /> } : null,
    { href: SOCIALS.github, label: "Slice on GitHub", icon: <GitHubLogo /> },
  ].filter(Boolean) as { href: string; label: string; icon: React.ReactNode }[];

  return (
    <div
      className={`fixed bottom-5 right-5 z-40 flex flex-col gap-2 transition-[opacity,transform] duration-300 ${
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          aria-label={l.label}
          title={l.label}
          className="glass group grid size-11 place-items-center text-[var(--color-muted)] transition-colors hover:text-[var(--color-accent-deep)]"
        >
          <span className="transition-transform duration-200 group-hover:scale-110">{l.icon}</span>
        </a>
      ))}
    </div>
  );
}

/** Inline social links, for the footer. */
export function SocialLinks() {
  return (
    <div className="flex items-center gap-3">
      {SOCIALS.x && (
        <a
          href={SOCIALS.x}
          target="_blank"
          rel="noreferrer"
          aria-label="Slice on X"
          className="text-[var(--color-dim)] transition-colors hover:text-[var(--color-accent)]"
        >
          <XLogo size={16} />
        </a>
      )}
      <a
        href={SOCIALS.github}
        target="_blank"
        rel="noreferrer"
        aria-label="Slice on GitHub"
        className="text-[var(--color-dim)] transition-colors hover:text-[var(--color-accent)]"
      >
        <GitHubLogo size={16} />
      </a>
    </div>
  );
}
