"use client";

import { useState, type ReactNode } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { NumberPad } from "@/components/ui/number-pad";
import { Spinner } from "@/components/ui/spinner";
import { StatusLight } from "@/components/ui/status-light";
import { StatusPill } from "@/components/ui/status-pill";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { YesNo } from "@/components/ui/yes-no";
import { MENUS } from "@/lib/menus";

function Samples() {
  const toast = useToast();
  const [digits, setDigits] = useState("");
  return (
    <>
      <Card>
        <CardTitle>Buttons</CardTitle>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => toast({ tone: "go", title: "Saved" })}>Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="dark">Dark</Button>
          <Button variant="danger">Danger</Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost">Open a dialog</Button>
            </DialogTrigger>
            <DialogContent title="Start over?" description="The answers will be cleared.">
              <YesNo yesLabel="Yes" noLabel="No" onYes={() => {}} onNo={() => {}} />
            </DialogContent>
          </Dialog>
        </div>
        <YesNo yesLabel="Yes" noLabel="No" onYes={() => {}} onNo={() => {}} />
      </Card>
      <Card>
        <CardTitle>Status</CardTitle>
        <div className="flex flex-wrap gap-3">
          <StatusPill tone="info">Arrived</StatusPill>
          <StatusPill tone="wait">Waiting</StatusPill>
          <StatusPill tone="go">Completed</StatusPill>
          <StatusPill tone="stop">Rejected</StatusPill>
          <StatusPill tone="idle">Not started</StatusPill>
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

export function UiPanel({ kioskLinks }: { kioskLinks: ReactNode }) {
  return (
    <DashboardShell
      title="Design system"
      subtitle="Development only"
      menu={MENUS.supervisor}
      active="/supervisor"
      user={{ name: "Sample User", role: "Supervisor", profileHref: "/dev/ui" }}
      status={<StatusLight tone="go" label="Online" />}
      alerts={{ count: 3, href: "/dev/ui" }}
      logout={<Button variant="nav-danger">Log out</Button>}
    >
      <nav className="flex flex-wrap gap-3">Kiosk screens: {kioskLinks}</nav>
      <ToastProvider label="Notification">
        <Samples />
      </ToastProvider>
    </DashboardShell>
  );
}
