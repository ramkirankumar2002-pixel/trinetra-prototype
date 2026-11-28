"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatPlate, type DemoMasterData, type DemoSettings } from "@trinetra/shared";
import { Check, SlidersHorizontal } from "lucide-react";
import { useId } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { api } from "@/lib/api";
import { SETTINGS_KEY } from "@/lib/settings/queries";
import { Panel } from "../dashboard/panel";
import { materialText } from "../supervisor/parts";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";

type Switch = "anprMode" | "supervisorMode" | "ocrMode";
type Changes = Partial<
  Pick<DemoSettings, Switch> & { demoPlate: string; demoInvoice: string; weightMode: "real" }
>;

const SWITCHES: { key: Switch; title: MessageKey; text: MessageKey }[] = [
  { key: "anprMode", title: "settings.kioskPlate", text: "settings.kioskPlateText" },
  { key: "supervisorMode", title: "settings.supervisorPlate", text: "settings.supervisorText" },
  { key: "ocrMode", title: "settings.bill", text: "settings.billText" },
];

const SELECT =
  "min-h-12 w-full rounded-lg border border-input bg-field px-3 text-base text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring/60 disabled:opacity-45";

function Choice({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={SELECT}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SwitchesPanel({
  settings,
  master,
}: {
  settings: DemoSettings;
  master: DemoMasterData;
}) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (changes: Changes) =>
      api.put<DemoSettings>("/api/demo/settings", { body: changes }),
    onSuccess: (saved) => {
      queryClient.setQueryData(SETTINGS_KEY, saved);
      toast({ tone: "go", title: t("settings.saved") });
    },
    onError: () => toast({ tone: "stop", title: t("settings.saveFailed") }),
  });

  const platePicked = settings.anprMode === "pick" || settings.supervisorMode === "pick";
  const simulated = settings.weightMode === "simulated";
  const on = platePicked || settings.ocrMode === "pick" || simulated;

  return (
    <Panel icon={SlidersHorizontal} title={t("settings.switches")}>
      <div className="flex flex-col gap-4">
        <Banner tone={on ? "wait" : "go"}>{t(on ? "settings.demoOn" : "settings.allReal")}</Banner>

        {SWITCHES.map(({ key, title, text }) => (
          <div key={key} className="flex flex-col gap-2 border-b border-border pb-4">
            <div>
              <h3 className="font-bold">{t(title)}</h3>
              <p className="text-sm text-muted-foreground">{t(text)}</p>
            </div>
            <div role="group" aria-label={t(title)} className="grid grid-cols-2 gap-2">
              {(["real", "pick"] as const).map((mode) => (
                <Button
                  key={mode}
                  size="lg"
                  variant={settings[key] === mode ? "primary" : "outline"}
                  aria-pressed={settings[key] === mode}
                  disabled={save.isPending}
                  onClick={() => settings[key] !== mode && save.mutate({ [key]: mode })}
                >
                  {settings[key] === mode && <Check aria-hidden />}
                  {t(`settings.${mode}`)}
                </Button>
              ))}
            </div>
          </div>
        ))}

        <Choice
          label={t("settings.pickedPlate")}
          value={settings.demoPlate ?? ""}
          options={master.plates.map((plate) => ({ value: plate, label: formatPlate(plate) }))}
          disabled={save.isPending}
          onChange={(demoPlate) => save.mutate({ demoPlate })}
        />
        <Choice
          label={t("settings.pickedBill")}
          value={settings.demoInvoice ?? ""}
          options={master.invoices.map((invoice) => ({
            value: invoice.id,
            label: `${materialText(invoice.material, t)} · ${formatPlate(invoice.plate)}`,
          }))}
          disabled={save.isPending}
          onChange={(demoInvoice) => save.mutate({ demoInvoice })}
        />
        <p className="text-sm text-muted-foreground">{t("settings.pickedNote")}</p>

        {simulated && (
          <div className="flex flex-col gap-2">
            <Banner tone="wait">{t("settings.weightSimulated")}</Banner>
            <Button
              size="lg"
              variant="outline"
              disabled={save.isPending}
              onClick={() => save.mutate({ weightMode: "real" })}
            >
              {t("settings.useRealWeight")}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
