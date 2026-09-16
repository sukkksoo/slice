// `page.tsx` is a client component, and a client component cannot export `metadata`.
export const metadata = { title: "List a pool — Slice on Arc" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
