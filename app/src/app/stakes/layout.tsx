// `stakes/page.tsx` is a client component, and a client component cannot export `metadata`.
// This server layout supplies the title so the tab does not fall back to the site-wide default.
export const metadata = { title: "Your stakes — Slice on Arc" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
