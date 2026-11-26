import type { ReactNode } from "react";
import { RequireRole } from "@/components/require-role";

/** Every page of this part except the login. */
export default function SignedInStoreLayout({ children }: { children: ReactNode }) {
  return <RequireRole area="store">{children}</RequireRole>;
}
