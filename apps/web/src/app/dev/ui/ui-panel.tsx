"use client";

import { useState } from "react";
import type { ThemeName } from "@/components/layout/theme-context";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { NumberPad } from "@/components/ui/number-pad";
import { Spinner } from "@/components/ui/spinner";
import { StatusLight } from "@/components/ui/status-light";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { YesNo } from "@/components/ui/yes-no";

function Samples() {
  const toast = useToast();
  const [digits, setDigits] = useState("");
  return (
    <>
      <Card>
        <CardTitle>Buttons</CardTitle>
        <div className="flex flex-wrap gap-3">
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="wait">Wait</Button>
          <Button onClick={() => toast({ tone: "go", title: "Saved" })}>Show a toast</Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open a dialog</Button>
            </DialogTrigger>
            <DialogContent title="Start over?" description="The answers will be cleared.">
              <YesNo yesLabel="Yes" noLabel="No" onYes={() => {}} onNo={() => {}} />
            </DialogContent>
          </Dialog>
        </div>
        <Button size="kiosk-xl">Kiosk XL</Button>
        <YesNo yesLabel="Yes" noLabel="No" onYes={() => {}} onNo={() => {}} />
      </Card>
      <Card>
        <CardTitle>Status</CardTitle>
        <div className="flex flex-wrap gap-3">
          <Badge tone="go">Go</Badge>
          <Badge tone="wait">Wait</Badge>
          <Badge tone="stop">Stop</Badge>
          <Badge>Note</Badge>
        </div>
        <StatusLight tone="go" label="Online" />
        <StatusLight tone="stop" label="Offline" />
        <Spinner label="Loading…" />
      </Card>
      <Card>
        <CardTitle>{`Number pad: ${digits || "—"}`}</CardTitle>
        <NumberPad
          value={digits}
          onChange={setDigits}
          maxLength={10}
          labels={{ pad: "Number pad", clear: "Clear", backspace: "Delete" }}
          className="max-w-md"
        />
      </Card>
      <EmptyState title="Nothing here yet">New items will appear here.</EmptyState>
    </>
  );
}

export function UiPanel({ layout }: { layout: ThemeName }) {
  return (
    <PageShell
      layout={layout}
      brand="Trinetra"
      title={`Design system (${layout})`}
      topRight={<StatusLight tone="go" label="Online" />}
      bottomBar={
        <Button variant="outline" asChild>
          <a href={layout === "kiosk" ? "/dev/ui" : "/dev/ui?layout=kiosk"}>Other layout</a>
        </Button>
      }
    >
      <ToastProvider label="Notification">
        <Samples />
      </ToastProvider>
    </PageShell>
  );
}
