import { redirect } from "next/navigation";

/**
 * Positions moved into the account page, alongside the pools a wallet has listed and its routers.
 * The old path stays as a redirect: it was linked from the nav, the footer and the docs, and a
 * bookmark that 404s is a worse outcome than a hop.
 */
export default function StakesRedirect() {
  redirect("/account");
}
