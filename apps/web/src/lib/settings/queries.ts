"use client";

import { useQuery } from "@tanstack/react-query";
import type { DemoMasterData, DemoOverview, DemoSettings } from "@trinetra/shared";
import { DEMO_KEY } from "@/components/demo-badge";
import { api } from "../api";

/** Usage and devices change by themselves, so the open page asks again. */
const OVERVIEW_MS = 5000;

export const SETTINGS_KEY = [...DEMO_KEY, "settings"] as const;

export const useDemoSettings = () =>
  useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: ({ signal }) => api.get<DemoSettings>("/api/demo/settings", { signal }),
  });

export const useDemoOverview = () =>
  useQuery({
    queryKey: [...DEMO_KEY, "overview"],
    queryFn: ({ signal }) => api.get<DemoOverview>("/api/demo/overview", { signal }),
    refetchInterval: OVERVIEW_MS,
  });

export const useDemoMasterData = () =>
  useQuery({
    queryKey: [...DEMO_KEY, "master-data"],
    queryFn: ({ signal }) => api.get<DemoMasterData>("/api/demo/master-data", { signal }),
  });
