"use client";

// Plain test screen. It spends real API quota.
import type {
  AuthResponse,
  AuthUser,
  ErrorResponse,
  InvoiceRead,
  PlateRead,
} from "@trinetra/shared";
import { formatKg, formatPlate } from "@trinetra/shared";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/config";

const callApi = (path: string, init: RequestInit = {}) =>
  fetch(`${apiUrl()}${path}`, { credentials: "include", cache: "no-store", ...init });

interface Answer<T> {
  result: T;
  totalMs: number;
  /** Including the upload from this browser. */
  browserMs: number;
}

async function upload<T>(path: string, file: File): Promise<Answer<T>> {
  const form = new FormData();
  form.append("file", file);
  const started = performance.now();
  const response = await callApi(path, { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok) {
    const { error } = body as ErrorResponse;
    throw new Error(`${error.code}: ${error.message}`);
  }
  return { ...body, browserMs: Math.round(performance.now() - started) };
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <table className="text-left text-sm">
      <tbody>
        {rows.map(([name, value]) => (
          <tr key={name} className="border-t align-top">
            <th className="py-1 pr-4 font-medium whitespace-nowrap">{name}</th>
            <td className="py-1 font-mono break-all">{value ?? "— (not read)"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const confidence = (value: number | null) =>
  value === null ? "not given" : `${Math.round(value * 100)}%`;

function PlateResult({ answer }: { answer: Answer<PlateRead> }) {
  const { result } = answer;
  return (
    <Rows
      rows={[
        ["Plate", result.plate && formatPlate(result.plate)],
        ["Shaped like an Indian plate", result.validFormat ? "yes" : "no"],
        ["Source", result.source ?? "neither service answered"],
        ["Confidence", confidence(result.confidence)],
        ["Time", `${result.ms} ms reading, ${answer.browserMs} ms in total`],
        ["Problems", result.problems.map((p) => `${p.service}: ${p.code}`).join(", ") || "none"],
      ]}
    />
  );
}

function InvoiceResult({ answer }: { answer: Answer<InvoiceRead> }) {
  const { result } = answer;
  const both = (value: InvoiceRead["material"]) =>
    value.raw === null ? null : `${value.raw} → ${value.matched ?? "no match"}`;
  return (
    <Rows
      rows={[
        ["Invoice number", result.invoiceNo],
        ["Invoice date", result.invoiceDate],
        ["Supplier", both(result.supplier)],
        ["Transporter", both(result.transporter)],
        ["Vehicle", result.vehicle.plate && formatPlate(result.vehicle.plate)],
        ["Material", both(result.material)],
        [
          "Quantity as written",
          result.quantity.value === null
            ? null
            : `${result.quantity.value} ${result.quantity.unit ?? "(no unit)"}`,
        ],
        ["Weight", result.weightKg === null ? null : formatKg(result.weightKg)],
        ["Warnings", result.warnings.map((w) => w.message).join(" ") || "none"],
        ["Source", result.source],
        ["Confidence", "not given for invoices"],
        ["Time", `${result.ms} ms reading, ${answer.browserMs} ms in total`],
      ]}
    />
  );
}

function Reader<T>(props: {
  title: string;
  accept: string;
  path: () => string;
  show: (answer: Answer<T>) => ReactNode;
  children?: ReactNode;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer<T> | null>(null);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setAnswer(null);
    setError("");
    try {
      setAnswer(await upload<T>(props.path(), file));
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded border p-4">
      <h2 className="font-bold">{props.title}</h2>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <input
          type="file"
          accept={props.accept}
          aria-label={`${props.title}: file`}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        {props.children}
        <Button type="submit" disabled={!file || busy}>
          {busy ? "Reading…" : "Read"}
        </Button>
      </form>
      {error && <p className="text-destructive">{error}</p>}
      {answer && props.show(answer)}
    </section>
  );
}

export function ReadersPanel() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [username, setUsername] = useState("wb01");
  const [pin, setPin] = useState("");
  const [loginError, setLoginError] = useState("");
  const [ticketPlate, setTicketPlate] = useState("");
  const unreachable = `Cannot reach the backend at ${apiUrl()}.`;

  useEffect(() => {
    void callApi("/api/auth/me")
      .then(async (response) => {
        if (response.ok) setUser(((await response.json()) as AuthResponse).user);
      })
      .catch(() => setLoginError("Cannot reach the backend."));
  }, []);

  async function logIn(event: FormEvent) {
    event.preventDefault();
    setLoginError("");
    const response = await callApi("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, pin }),
    }).catch(() => undefined);
    if (!response) return setLoginError(unreachable);
    const body = await response.json();
    if (!response.ok) return setLoginError((body as ErrorResponse).error.message);
    setPin("");
    setUser((body as AuthResponse).user);
  }

  const images = "image/jpeg,image/png,image/webp";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">Plate and invoice readers (development only)</h1>
      <p className="text-sm">
        Every read uses the real services and their free quota. Nothing uploaded here is saved. Use
        sample invoices only, never real company invoices.
      </p>

      {user?.role !== "KIOSK" ? (
        <form onSubmit={logIn} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-sm">
            Username
            <input
              className="rounded border px-2 py-1"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="flex flex-col text-sm">
            PIN
            <input
              className="rounded border px-2 py-1"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <Button type="submit">Log in as the kiosk</Button>
          {user && <p>These tools need the kiosk login.</p>}
          {loginError && <p className="text-destructive">{loginError}</p>}
        </form>
      ) : (
        <>
          <p>
            Logged in as <strong>{user.name}</strong>
          </p>
          <Reader<PlateRead>
            title="Number plate photo"
            accept={images}
            path={() => "/api/dev/read-plate"}
            show={(answer) => <PlateResult answer={answer} />}
          />
          <Reader<InvoiceRead>
            title="Invoice (photo or PDF)"
            accept={`${images},application/pdf`}
            path={() =>
              `/api/dev/read-invoice${ticketPlate ? `?plate=${encodeURIComponent(ticketPlate)}` : ""}`
            }
            show={(answer) => <InvoiceResult answer={answer} />}
          >
            <label className="flex flex-col text-sm">
              Truck plate (optional, to check the invoice)
              <input
                className="rounded border px-2 py-1"
                value={ticketPlate}
                onChange={(event) => setTicketPlate(event.target.value)}
              />
            </label>
          </Reader>
        </>
      )}
    </main>
  );
}
