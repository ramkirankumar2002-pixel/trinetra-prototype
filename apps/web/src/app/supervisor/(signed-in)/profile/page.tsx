"use client";

import { LogoutButton } from "@/components/logout-button";
import { useCurrentUser } from "@/components/require-role";
import { RoleShell } from "@/components/role-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { useT } from "@/i18n/use-t";
import { useSupervisorTrucks } from "@/lib/supervisor/queries";

function Profile() {
  const t = useT();
  const user = useCurrentUser();
  const { data } = useSupervisorTrucks("pending");
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardTitle>{user.name}</CardTitle>
      <dl className="grid gap-2">
        <div>
          <dt className="text-sm text-muted-foreground">{t("login.username")}</dt>
          <dd className="font-semibold">{user.username}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t("banner.unloadingPoint")}</dt>
          {(data?.points ?? []).map((point) => (
            <dd key={point.code} className="font-semibold">
              {[...new Set([point.code, point.name])].join(" · ")}
            </dd>
          ))}
          {data?.points.length === 0 && <dd>—</dd>}
        </div>
      </dl>
      <LogoutButton area="supervisor" />
    </Card>
  );
}

export default function SupervisorProfilePage() {
  return (
    <RoleShell area="supervisor">
      <Profile />
    </RoleShell>
  );
}
