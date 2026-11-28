"use client";

// The model weighbridge: what one gram on the model stands for, and how still a weight
// must be. The backend does every conversion; this page only changes the two settings.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  formatKg,
  gramsToKg,
  MAX_MODEL_SCALE,
  MAX_STABLE_BAND_G,
  type DemoSettings,
} from "@trinetra/shared";
import { Scale } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { api, ApiError } from "@/lib/api";
import { SETTINGS_KEY } from "@/lib/settings/queries";
import { Panel } from "../dashboard/panel";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";

/** The cargo the "model" sample bills are written for. */
const CARGO_G = 200;

const INPUT =
  "min-h-12 w-28 rounded-lg border border-input bg-field px-3 text-lg text-foreground tabular-nums outline-none focus-visible:ring-4 focus-visible:ring-ring/60";

const REFUSALS: Record<string, MessageKey> = {
  SCALE_IN_USE: "settings.scaleInUse",
  BRIDGE_NOT_EMPTY: "settings.bridgeNotEmpty",
};

export function ModelPanel({ settings }: { settings: DemoSettings }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const scaleId = useId();
  const bandId = useId();
  // Null: not being edited, so the saved value shows.
  const [typedScale, setScale] = useState<string | null>(null);
  const [typedBand, setBand] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const scaleText = typedScale ?? String(settings.modelScaleKgPerG);
  const bandText = typedBand ?? String(settings.stableBandG);
  const scale = Number(scaleText);
  const band = Number(bandText);
  const scaleOk = scale > 0 && scale <= MAX_MODEL_SCALE && Math.abs((scale * 100) % 1) < 1e-6;
  const bandOk = Number.isInteger(band) && band >= 1 && band <= MAX_STABLE_BAND_G;
  const changed = scale !== settings.modelScaleKgPerG || band !== settings.stableBandG;

  const save = useMutation({
    mutationFn: () =>
      api.put<DemoSettings>("/api/demo/settings", {
        body: { modelScaleKgPerG: scale, stableBandG: band },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(SETTINGS_KEY, saved);
      setScale(null);
      setBand(null);
      setProblem(null);
      toast({ tone: "go", title: t("settings.saved") });
    },
    onError: (error) => {
      const key = error instanceof ApiError ? REFUSALS[error.code] : undefined;
      setProblem(t(key ?? "settings.saveFailed"));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (scaleOk && bandOk && changed && !save.isPending) save.mutate();
  }

  return (
    <Panel icon={Scale} title={t("settings.model")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={scaleId} className="font-semibold">
            {t("settings.modelScale")}
          </label>
          <div className="flex items-center gap-2 font-bold">
            <span aria-hidden>1 g =</span>
            <input
              id={scaleId}
              type="number"
              inputMode="decimal"
              min={0.01}
              max={MAX_MODEL_SCALE}
              step={0.01}
              value={scaleText}
              onChange={(event) => setScale(event.target.value)}
              className={INPUT}
            />
            <span aria-hidden>kg</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {scaleOk
              ? t("settings.modelScaleText", {
                  grams: CARGO_G,
                  kg: formatKg(gramsToKg(CARGO_G, scale)),
                })
              : t("settings.badNumber", { min: 0.01, max: MAX_MODEL_SCALE })}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={bandId} className="font-semibold">
            {t("settings.stableBand")}
          </label>
          <input
            id={bandId}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_STABLE_BAND_G}
            step={1}
            value={bandText}
            onChange={(event) => setBand(event.target.value)}
            className={INPUT}
          />
          <p className="text-sm text-muted-foreground">
            {bandOk && scaleOk
              ? t("settings.stableBandText", { kg: formatKg(gramsToKg(band, scale)) })
              : t("settings.badNumber", { min: 1, max: MAX_STABLE_BAND_G })}
          </p>
        </div>

        {problem && (
          <Banner tone="stop">
            <span role="alert">{problem}</span>
          </Banner>
        )}
        <Button
          type="submit"
          size="lg"
          disabled={!scaleOk || !bandOk || !changed || save.isPending}
        >
          {t("settings.modelSave")}
        </Button>
      </form>
    </Panel>
  );
}
