"use client";

// Sample kiosk screens made only from the shared parts, to compare with the design
// references and to check the driver rules (tests/e2e). The values are made up. The real
// screens come in Phase 10.
import {
  ArrowRight,
  Box,
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Globe,
  Pencil,
  Phone,
  Receipt,
  RotateCcw,
  Scale,
  Truck,
  TriangleAlert,
  UserRound,
  Weight,
} from "lucide-react";
import { useState } from "react";
import { ActionCard } from "@/components/kiosk/action-card";
import { DetailGrid, type Detail } from "@/components/kiosk/detail-grid";
import { LiveWeight } from "@/components/kiosk/live-weight";
import { KioskShell } from "@/components/layout/kiosk-shell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { NumberPad } from "@/components/ui/number-pad";
import { StatusLight } from "@/components/ui/status-light";
import { StatusPill } from "@/components/ui/status-pill";
import { YesNo } from "@/components/ui/yes-no";
import type { KioskScreen } from "./screens";

const status = (
  <>
    <StatusLight tone="go" label="Weighbridge online" />
    <StatusLight tone="go" label="Online" />
  </>
);

const DETAILS: Detail[] = [
  { icon: Receipt, label: "Ticket no", value: "SAMPLE-0001" },
  { icon: Building2, label: "Supplier", value: "Sample Supplier" },
  { icon: CalendarDays, label: "Time", value: "10:30" },
  { icon: Phone, label: "Phone", value: "90000 00000" },
  { icon: Truck, label: "Vehicle", value: "XX 00 AA 0001" },
  { icon: Weight, label: "First weight", value: "32,560 kg", emphasis: "highlight" },
  { icon: Box, label: "Material", value: "Steel Scrap" },
  { icon: Weight, label: "Net weight", value: null },
  { icon: FileText, label: "Invoice no", value: "SAMPLE-INV-1" },
  { icon: Scale, label: "Invoice kg", value: "14,250 kg" },
];

function Start() {
  return (
    <KioskShell
      header={{ icon: Truck, title: "Welcome", subtitle: "Sample screen" }}
      status={status}
    >
      <div className="my-auto grid grid-cols-2 gap-8 px-8">
        <ActionCard icon={Globe} title="Choose language" description="English or हिंदी" />
        <ActionCard
          tone="teal"
          icon={Truck}
          title="Find my truck"
          description="Read the number plate"
        />
      </div>
    </KioskShell>
  );
}

function Details() {
  return (
    <KioskShell
      header={{ icon: ClipboardCheck, title: "First weight", subtitle: "Check the details" }}
      status={status}
      actions={
        <>
          <Button variant="danger">
            <TriangleAlert aria-hidden />
            Wrong weight
          </Button>
          <Button variant="dark">
            <Pencil aria-hidden />
            Edit
          </Button>
          <Button>
            Next
            <ArrowRight aria-hidden />
          </Button>
        </>
      }
    >
      <Banner>Dear driver, please check your details.</Banner>
      <DetailGrid items={DETAILS} />
    </KioskShell>
  );
}

function LiveScreen() {
  return (
    <KioskShell
      header={{ icon: Scale, title: "First weight", subtitle: "Please stay still" }}
      status={status}
      actions={
        <>
          <Button variant="dark">
            <RotateCcw aria-hidden />
            Weigh again
          </Button>
          <Button>
            Correct
            <ArrowRight aria-hidden />
          </Button>
        </>
      }
    >
      <LiveWeight
        className="flex-1"
        kg={32_560}
        label="Live weight"
        status={{ tone: "go", label: "Stable weight" }}
      />
    </KioskShell>
  );
}

function Question() {
  return (
    <KioskShell
      header={{ icon: Truck, title: "Number plate", subtitle: "Check your truck" }}
      status={status}
      actions={<YesNo yesLabel="Yes" noLabel="No" onYes={() => {}} onNo={() => {}} />}
    >
      <Card className="flex-1 items-center justify-center text-center">
        <p className="rounded-2xl border-4 border-foreground px-10 py-4 text-7xl font-extrabold tracking-wider">
          XX 00 AA 0001
        </p>
        <CardTitle>Is this your truck?</CardTitle>
        <div className="flex gap-4">
          <StatusPill tone="info">Arrived</StatusPill>
          <StatusPill tone="wait">Waiting</StatusPill>
          <StatusPill tone="stop">Blocked</StatusPill>
          <StatusPill tone="idle">Not started</StatusPill>
        </div>
      </Card>
    </KioskShell>
  );
}

function NumberEntry() {
  const [digits, setDigits] = useState("90000");
  return (
    <KioskShell
      header={{ icon: UserRound, title: "Phone number", subtitle: "Type 10 digits" }}
      actions={
        <Button disabled={digits.length !== 10}>
          Next
          <ArrowRight aria-hidden />
        </Button>
      }
    >
      <Card className="my-auto grid grid-cols-2 items-center gap-10">
        <p className="text-center text-6xl font-bold tracking-widest tabular-nums">
          {digits || "———"}
        </p>
        <NumberPad
          value={digits}
          onChange={setDigits}
          maxLength={10}
          labels={{ pad: "Number pad", clear: "Clear", backspace: "Delete" }}
        />
      </Card>
    </KioskShell>
  );
}

export function KioskSample({ screen }: { screen: KioskScreen }) {
  if (screen === "start") return <Start />;
  if (screen === "details") return <Details />;
  if (screen === "weight") return <LiveScreen />;
  if (screen === "question") return <Question />;
  return <NumberEntry />;
}
