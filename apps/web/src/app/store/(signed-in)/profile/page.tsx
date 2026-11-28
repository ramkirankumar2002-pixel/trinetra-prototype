import { EmptyPage } from "@/components/empty-page";
import { SettingsLink } from "@/components/settings/settings-link";

export default function StoreProfilePage() {
  return (
    <EmptyPage area="store" page="profile" text="empty.profile">
      <SettingsLink />
    </EmptyPage>
  );
}
