import { redirect } from "next/navigation";

/** Convenience alias — admin lives under the authenticated app shell. */
export default function AdminRedirectPage() {
  redirect("/app/admin");
}
