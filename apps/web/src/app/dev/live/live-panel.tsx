"use client";

// Plain test screen. The real kiosk and dashboards come in later phases.
import {
  formatKg,
  type AuthResponse,
  type AuthUser,
  type CaptureBlockReason,
  type ErrorResponse,
  type HardwareStatusEvent,
  type KioskStateResponse,
} from "@trinetra/shared";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { socketClient } from "@/lib/socket";
import { useOnReconnect, useSocketEvent, useSocketStatus } from "@/lib/socket-hooks";

const LOG_LENGTH = 20;
/** The ESP32 sends 5 times a second: this long without a weight means it is old. */
const STALE_AFTER_MS = 1500;

interface ShownWeight {
  kg: number;
  stable: boolean;
  positionOk: boolean;
  canCapture: boolean;
  reason: CaptureBlockReason | null;
  receivedAt: number;
}

interface LogRow {
  id: number;
  time: string;
  event: string;
  text: string;
  /** Weights arrive 5 times a second, so a run of them shares one row. */
  count: number;
}

const clockTime = (date: Date) =>
  `${date.toLocaleTimeString("en-GB")}.${String(date.getMilliseconds()).padStart(3, "0")}`;

const callApi = (path: string, body?: object) =>
  fetch(path, {
    credentials: "include",
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });

export function LivePanel() {
  const status = useSocketStatus();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [username, setUsername] = useState("wb01");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [weight, setWeight] = useState<ShownWeight | null>(null);
  const [devices, setDevices] = useState<HardwareStatusEvent | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [reloads, setReloads] = useState(0);
  const [now, setNow] = useState(0);
  const nextRow = useRef(1);

  /** Reads the current state over REST: events sent while disconnected are gone. */
  const loadState = useCallback(async () => {
    const response = await callApi("/api/kiosk/state").catch(() => undefined);
    // Only the kiosk may read it; other roles get their data in later phases.
    if (!response?.ok) return;
    const state = (await response.json()) as KioskStateResponse;
    setDevices({
      main: state.devices.main.online,
      front: state.devices.front.online,
      back: state.devices.back.online,
    });
    setWeight(
      state.weight && {
        kg: state.weight.kg,
        stable: state.weight.stable,
        positionOk: state.weight.positionOk,
        canCapture: state.canCapture.ok,
        reason: state.canCapture.reason,
        receivedAt: Date.now() - state.weight.ageMs,
      },
    );
  }, []);

  const start = useCallback(
    (loggedIn: AuthUser) => {
      setUser(loggedIn);
      socketClient().disconnect();
      socketClient().connect();
      void loadState();
    },
    [loadState],
  );

  // Already logged in (a second tab, or a reload): connect straight away.
  useEffect(() => {
    let cancelled = false;
    void callApi("/api/auth/me")
      .then(async (response) => {
        if (response.ok && !cancelled) start(((await response.json()) as AuthResponse).user);
      })
      .catch(() => setError("Cannot reach the backend."));
    return () => {
      cancelled = true;
      socketClient().disconnect();
    };
  }, [start]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const { socket } = socketClient();
    const record = (event: string, payload: unknown) => {
      const fields = { ...(payload as Record<string, unknown>) };
      delete fields.at;
      const row = { event, text: JSON.stringify(fields), time: clockTime(new Date()) };
      setLog((rows) => {
        const [latest, ...older] = rows;
        if (event === "hw:weight" && latest?.event === event) {
          return [{ ...latest, ...row, count: latest.count + 1 }, ...older];
        }
        return [{ ...row, id: nextRow.current++, count: 1 }, ...rows].slice(0, LOG_LENGTH);
      });
    };
    socket.onAny(record);
    return () => void socket.offAny(record);
  }, []);

  useSocketEvent("hw:weight", (event) => setWeight({ ...event, receivedAt: Date.now() }));
  useSocketEvent("hw:status", (event) => {
    setDevices(event);
    if (!event.main) setWeight(null);
  });
  useOnReconnect(() => {
    setReloads((count) => count + 1);
    void loadState();
  });

  async function logIn(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await callApi("/api/auth/login", { username, pin }).catch(() => undefined);
    const body = await response?.json().catch(() => undefined);
    if (!response || !body) return setError("Cannot reach the backend.");
    if (!response.ok) return setError((body as ErrorResponse).error.message);
    setPin("");
    setLog([]);
    start((body as AuthResponse).user);
  }

  async function logOut() {
    await callApi("/api/auth/logout", {}).catch(() => undefined);
    socketClient().disconnect();
    setUser(null);
    setWeight(null);
    setDevices(null);
    setLog([]);
  }

  const connected = status === "connected";
  const online = connected && devices?.main === true;
  const stale = online && weight !== null && now - weight.receivedAt > STALE_AFTER_MS;
  const shown = online ? weight : null;
  const captureText = !shown
    ? "No (DEVICE_OFFLINE or not connected)"
    : stale
      ? "No (STALE_READING)"
      : shown.canCapture
        ? "Yes"
        : `No (${shown.reason})`;
  const onlineText = (value: boolean | undefined) =>
    !connected || value === undefined ? "unknown" : value ? "online" : "OFFLINE";
  const yesNo = (value: boolean | undefined) => (value === undefined ? "—" : value ? "yes" : "no");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">Live events (development only)</h1>

      {!user || status === "login-required" ? (
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
          <Button type="submit">Log in</Button>
        </form>
      ) : (
        <p className="flex items-center gap-3">
          Logged in as <strong>{user.name}</strong> ({user.role})
          <Button variant="outline" onClick={logOut}>
            Log out
          </Button>
        </p>
      )}
      {error && <p className="text-destructive">{error}</p>}
      {user && user.role !== "KIOSK" && (
        <p>Only the kiosk receives live weights. Log in as the kiosk (wb01) to see them.</p>
      )}

      <p data-testid="connection">
        Connection: <strong>{status}</strong> · reconnected {reloads} time(s)
      </p>

      <section className="rounded border p-4">
        <p className="text-5xl font-bold" data-testid="weight">
          {shown ? formatKg(shown.kg) : "— kg"}
        </p>
        <p>
          Stable (ESP32 flag): <strong>{yesNo(shown?.stable)}</strong> · Position OK:{" "}
          <strong>{yesNo(shown?.positionOk)}</strong>
        </p>
        <p data-testid="capture">
          Can capture: <strong>{captureText}</strong>
        </p>
      </section>

      <p data-testid="devices">
        ESP32: <strong>{onlineText(devices?.main)}</strong> · Front camera:{" "}
        <strong>{onlineText(devices?.front)}</strong> · Back camera:{" "}
        <strong>{onlineText(devices?.back)}</strong>
      </p>

      <section>
        <h2 className="font-bold">Last {LOG_LENGTH} events (newest first)</h2>
        <p className="text-sm text-muted-foreground">
          A run of weights shares one row, showing how many arrived and the latest one.
        </p>
        <table className="w-full text-left text-sm" data-testid="log">
          <thead>
            <tr>
              <th className="pr-3">Time received</th>
              <th className="pr-3">Event</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {log.map((row) => (
              <tr key={row.id} className="border-t align-top">
                <td className="pr-3 font-mono whitespace-nowrap">{row.time}</td>
                <td className="pr-3 whitespace-nowrap">
                  {row.event}
                  {row.count > 1 ? ` ×${row.count}` : ""}
                </td>
                <td className="font-mono break-all">{row.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
