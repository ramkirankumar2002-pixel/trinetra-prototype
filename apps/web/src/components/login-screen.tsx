"use client";

// The login page of the weighbridge, the supervisor and the store officer: a username and
// a PIN on a big number pad.
import type { AuthResponse, AuthUser } from "@trinetra/shared";
import { cn } from "cn";
import { LogIn, Truck, UserRound } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useT } from "@/i18n/use-t";
import type { MessageKey } from "@/i18n/translate";
import { api, ApiError } from "@/lib/api";
import { afterLoginPath, AREAS, type AreaName } from "@/lib/areas";
import { useMe } from "@/lib/session";
import { LanguageSwitch } from "./language-switch";
import { AuthShell } from "./layout/auth-shell";
import { KioskShell } from "./layout/kiosk-shell";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { NumberPad } from "./ui/number-pad";
import { Spinner } from "./ui/spinner";
import { TONE_SOFT } from "./ui/tone";

const PIN_MIN = 4;
const PIN_MAX = 6;

/** The username used last on this device, so it is typed only once. Never the PIN. */
const usernameKey = (area: AreaName) => `trinetra.username.${area}`;

function rememberedUsername(area: AreaName): string {
  try {
    return localStorage.getItem(usernameKey(area)) ?? "";
  } catch {
    return "";
  }
}

function rememberUsername(area: AreaName, username: string): void {
  try {
    localStorage.setItem(usernameKey(area), username);
  } catch {
    // Typed again next time.
  }
}

const neverChanges = () => () => {};

/** The words for a refused login, by the backend's error code. */
export function loginErrorKey(code: string): MessageKey {
  switch (code) {
    case "INVALID_CREDENTIALS":
      return "error.wrongPin";
    case "LOCKED":
      return "error.locked";
    case "RATE_LIMITED":
      return "error.tooMany";
    case "VALIDATION_ERROR":
      return "error.checkFields";
    case "NETWORK_ERROR":
    case "SERVER_UNREACHABLE":
      return "error.network";
    default:
      return "error.generic";
  }
}

type Problem =
  | { kind: "code"; code: string }
  | { kind: "wrongRole"; user: AuthUser }
  /** This username is locked until `until`. */
  | { kind: "locked"; username: string; until: number };

/** Whole seconds until `until`, counting down. 0 once it has passed. */
function useSecondsLeft(until: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [until]);
  return until === undefined ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

export function LoginScreen({
  area,
  goTo = (path: string) => window.location.assign(path),
}: {
  area: AreaName;
  /** A full page load, so nothing of an earlier login is left over. */
  goTo?: (path: string) => void;
}) {
  const t = useT();
  const { role } = AREAS[area];
  // The page that was open when the login ended, or this part's home.
  const home = () => afterLoginPath(area, window.location.search);
  const required = t(`role.${role}`);

  const me = useMe({ redirectOn401: false });
  const [typed, setTyped] = useState<string | null>(null);
  const remembered = useSyncExternalStore(
    neverChanges,
    () => rememberedUsername(area),
    () => "",
  );
  const username = typed ?? remembered;
  // False in the page the server sends. Until React has taken it over, anything typed
  // would be wiped, so the form waits.
  const interactive = useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const lock = problem?.kind === "locked" ? problem : undefined;
  const secondsLeft = useSecondsLeft(lock?.until);
  // The lock is for one username: another one can still log in.
  const locked = secondsLeft > 0 && lock?.username === username.trim().toLowerCase();
  const ready = username.trim() !== "" && pin.length >= PIN_MIN && !busy && !locked;

  // Already logged in with the right role (but not by the form just now).
  const alreadyIn = me.data?.role === role;
  useEffect(() => {
    if (alreadyIn) goTo(home());
    // Only when the answer arrives, not again for each new goTo function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadyIn, area]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    const name = username.trim().toLowerCase();
    try {
      const { user } = await api.post<AuthResponse>("/api/auth/login", {
        body: { username: name, pin },
      });
      if (user.role !== role) {
        // A correct PIN, but for another part: do not stay logged in here.
        await api.post("/api/auth/logout");
        setProblem({ kind: "wrongRole", user });
        setPin("");
        setBusy(false);
        return;
      }
      rememberUsername(area, name);
      // Stays busy while the next page loads.
      goTo(home());
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "UNKNOWN";
      const details = error instanceof ApiError ? error.details : undefined;
      const wait = (details as { secondsLeft?: number } | undefined)?.secondsLeft;
      setProblem(
        code === "LOCKED" && wait
          ? { kind: "locked", username: name, until: Date.now() + wait * 1000 }
          : { kind: "code", code },
      );
      setPin("");
      setBusy(false);
    }
  }

  let message: string | null = null;
  if (problem?.kind === "code") message = t(loginErrorKey(problem.code));
  if (problem?.kind === "wrongRole") {
    message = t("login.wrongRole", { role: t(`role.${problem.user.role}`), required });
  }
  if (locked) message = t("error.locked", { seconds: secondsLeft });

  const kiosk = area === "kiosk";
  const content = alreadyIn ? (
    <Spinner label={t("session.checking")} className="flex-1 py-10" />
  ) : (
    <form
      onSubmit={submit}
      noValidate
      className="flex w-full flex-col gap-3 kiosk:gap-y-0 kiosk:grid kiosk:grid-cols-2 kiosk:content-center kiosk:items-start kiosk:gap-x-14"
    >
      <div className="flex flex-col gap-3">
        {/* On the kiosk the page header says this instead: there is no height to spare. */}
        <h1 className="text-center text-2xl font-bold kiosk:hidden">{t(`login.title.${area}`)}</h1>
        {me.data && !problem && (
          <p className={cn("rounded-xl border p-3 kiosk:leading-tight", TONE_SOFT.wait)}>
            {t("login.otherAccount", {
              name: me.data.name,
              role: t(`role.${me.data.role}`),
              required,
            })}
          </p>
        )}
        <label className="flex flex-col gap-1 font-semibold">
          {t("login.username")}
          <span className="relative flex">
            <UserRound
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground kiosk:left-5 kiosk:size-10"
            />
            <input
              name="username"
              disabled={!interactive}
              value={username}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={50}
              className="min-h-13 w-full rounded-lg border border-input bg-field pr-4 pl-11 text-xl font-normal text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring/60 kiosk:min-h-24 kiosk:rounded-2xl kiosk:border-2 kiosk:pl-20 kiosk:text-5xl"
            />
          </span>
        </label>
        <div className="flex flex-col gap-1">
          <span className="font-semibold">
            {t("login.pin")}{" "}
            <span className="font-normal text-muted-foreground">({t("login.pinHint")})</span>
          </span>
          <div
            data-testid="pin-dots"
            className="flex min-h-8 items-center gap-3 kiosk:min-h-14 kiosk:gap-5"
          >
            {Array.from({ length: PIN_MAX }, (_, index) => (
              <span
                key={index}
                aria-hidden
                className={cn(
                  "size-4 rounded-full border-2 border-input kiosk:size-9",
                  index < pin.length &&
                    "border-primary-edge bg-primary kiosk:shadow-[0_0_1rem_var(--primary-edge)]",
                )}
              />
            ))}
            <span aria-live="polite" className="sr-only">
              {t("login.pinEntered", { count: pin.length })}
            </span>
          </div>
        </div>
        {message && (
          <p
            role="alert"
            className={cn(
              "rounded-xl border p-3 font-semibold kiosk:leading-tight",
              TONE_SOFT.stop,
            )}
          >
            {message}
          </p>
        )}
      </div>

      <div className="kiosk:col-start-2 kiosk:row-span-2 kiosk:row-start-1">
        <NumberPad
          value={pin}
          onChange={setPin}
          maxLength={PIN_MAX}
          disabled={!interactive || busy || locked}
          labels={{
            pad: t("numberPad.label"),
            clear: t("numberPad.clear"),
            backspace: t("numberPad.delete"),
          }}
        />
      </div>

      {/* Under the number pad on a phone; under the fields on the kiosk. */}
      <Button type="submit" size="lg" disabled={!ready} className="kiosk:mt-3">
        <LogIn aria-hidden />
        {t(busy ? "login.busy" : "login.submit")}
      </Button>
    </form>
  );

  if (kiosk) {
    return (
      <KioskShell
        header={{ icon: Truck, title: t("login.title.kiosk"), subtitle: t("login.heading") }}
      >
        <Card className="my-auto kiosk:p-4">{content}</Card>
      </KioskShell>
    );
  }
  return <AuthShell footer={<LanguageSwitch onNavy />}>{content}</AuthShell>;
}
