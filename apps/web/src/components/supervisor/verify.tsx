"use client";

// Verify a truck: a live photo of its number plate at the unloading point, what the
// backend read from it, and the supervisor's decision. The backend judges the photo and
// checks every decision again.
import { useQueryClient } from "@tanstack/react-query";
import {
  formatKg,
  formatPlate,
  OVERRIDE_REASON_MIN,
  type DecideRequest,
  type SupervisorPhotoResponse,
  type TicketView,
} from "@trinetra/shared";
import { ArrowLeft, Check, Keyboard, RotateCcw, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { api, ApiError } from "@/lib/api";
import { useAction } from "@/lib/kiosk/use-action";
import {
  SUPERVISOR_KEY,
  supervisorTicketKey,
  useSupervisorTicket,
  useSupervisorTrucks,
} from "@/lib/supervisor/queries";
import {
  firstWeightFrontPhoto,
  photoById,
  photosLeft,
  reasonIsLongEnough,
  SOMEONE_ELSE,
  supervisorCheck,
  typedPlateMatches,
} from "@/lib/supervisor/verify";
import { LiveCamera, type Shot } from "../camera/live-camera";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { Card, CardTitle } from "../ui/card";
import { Spinner } from "../ui/spinner";
import { materialText, PlateText, REJECT_REASONS, ZoomPhoto } from "./parts";

const FIELD =
  "min-h-12 w-full rounded-lg border border-input bg-field px-3 py-2 text-lg text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring/60";

const PROBLEMS: Partial<Record<string, MessageKey>> = {
  NETWORK_ERROR: "error.network",
  SERVER_UNREACHABLE: "error.network",
  RATE_LIMITED: "error.tooMany",
  PHOTO_LIMIT: "sup.error.photoLimit",
  PHOTO_IN_PROGRESS: "sup.error.photoBusy",
  PLATE_DIFFERS: "sup.error.plateDiffers",
  REASON_REQUIRED: "sup.error.reason",
  INVALID_IMAGE: "camera.badPhoto",
  UNSUPPORTED_FILE_TYPE: "camera.badPhoto",
  FILE_TOO_LARGE: "camera.badPhoto",
};
const problemKey = (error: ApiError): MessageKey => PROBLEMS[error.code] ?? "error.generic";

function Problem({ message }: { message: MessageKey }) {
  const t = useT();
  return (
    <Banner tone="stop">
      <span role="alert">{t(message)}</span>
    </Banner>
  );
}

function BackToTrucks({ primary = false }: { primary?: boolean }) {
  const t = useT();
  return (
    <Button asChild size="lg" variant={primary ? "primary" : "outline"}>
      <Link href="/supervisor/trucks">
        <ArrowLeft aria-hidden />
        {t("sup.backToTrucks")}
      </Link>
    </Button>
  );
}

/** What the truck is: everything the photo is checked against. */
function TruckSummary({ ticket }: { ticket: TicketView }) {
  const t = useT();
  const facts: [MessageKey, string][] = [
    ["column.material", materialText(ticket.material, t)],
    ["sup.column.trip", String(ticket.tripNo ?? "—")],
    [
      "sup.chainage",
      ticket.unloadingPoint
        ? [...new Set([ticket.unloadingPoint.code, ticket.unloadingPoint.name])].join(" · ")
        : "—",
    ],
    ["sup.firstWeight", ticket.firstWeightKg === null ? "—" : formatKg(ticket.firstWeightKg)],
  ];
  return (
    <Card>
      <PlateText plate={ticket.plate} className="self-center" />
      <div className="flex items-start gap-3">
        <dl className="grid min-w-0 flex-1 gap-1">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{t(label)}:</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <figure className="flex w-28 shrink-0 flex-col gap-1 sm:w-40">
          <ZoomPhoto
            url={firstWeightFrontPhoto(ticket)?.url}
            label={t("sup.frontPhoto")}
            className="h-24"
          />
          <figcaption className="text-center text-xs text-muted-foreground">
            {t("sup.frontPhoto")}
          </figcaption>
        </figure>
      </div>
    </Card>
  );
}

/** The photo just taken: use it or take another. It stays here until it has arrived. */
function Preview({
  shot,
  busy,
  problem,
  onUse,
  onRetake,
}: {
  shot: Shot;
  busy: boolean;
  problem: MessageKey | null;
  onUse: () => void;
  onRetake: () => void;
}) {
  const t = useT();
  // The picture's temporary address is made with the element and freed with it.
  const showPhoto = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image) return;
      const url = URL.createObjectURL(shot.blob);
      image.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [shot],
  );
  return (
    <Card>
      {/* eslint-disable-next-line @next/next/no-img-element -- the photo just taken */}
      <img
        ref={showPhoto}
        alt={t("sup.myPhoto")}
        data-testid="preview"
        className="max-h-[50dvh] w-full rounded-xl bg-black object-contain"
      />
      {problem && <Problem message={problem} />}
      {busy ? (
        <Spinner label={t("sup.reading")} className="min-h-14" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" variant="outline" onClick={onRetake}>
            <RotateCcw aria-hidden />
            {t("sup.retake")}
          </Button>
          <Button size="lg" onClick={onUse}>
            <Upload aria-hidden />
            {t(problem ? "kiosk.tryAgain" : "sup.usePhoto")}
          </Button>
        </div>
      )}
    </Card>
  );
}

function RejectForm({
  busy,
  problem,
  onReject,
  onBack,
}: {
  busy: boolean;
  problem: MessageKey | null;
  onReject: (reason: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [chosen, setChosen] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const OTHER = "Other";
  const reason =
    chosen === OTHER ? (other.trim() ? `Other: ${other.trim()}` : null) : (chosen ?? null);
  const options: { value: string; key: MessageKey }[] = [
    ...REJECT_REASONS,
    { value: OTHER, key: "sup.reason.other" },
  ];
  return (
    <Card>
      <CardTitle>{t("sup.rejectWhy")}</CardTitle>
      <div role="group" aria-label={t("sup.rejectWhy")} className="grid gap-2 sm:grid-cols-2">
        {options.map(({ value, key }) => (
          <Button
            key={value}
            size="lg"
            variant={chosen === value ? "primary" : "outline"}
            aria-pressed={chosen === value}
            disabled={busy}
            onClick={() => setChosen(value)}
          >
            {chosen === value && <Check aria-hidden />}
            {t(key)}
          </Button>
        ))}
      </div>
      {chosen === OTHER && (
        <label className="flex flex-col gap-1 font-semibold">
          {t("sup.reason.type")}
          <textarea
            className={FIELD}
            rows={2}
            maxLength={280}
            value={other}
            onChange={(event) => setOther(event.target.value)}
          />
        </label>
      )}
      {problem && <Problem message={problem} />}
      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" variant="outline" disabled={busy} onClick={onBack}>
          <ArrowLeft aria-hidden />
          {t("kiosk.back")}
        </Button>
        <Button
          size="lg"
          variant="stop"
          disabled={busy || reason === null}
          onClick={() => reason && onReject(reason)}
        >
          <X aria-hidden />
          {t("sup.rejectTruck")}
        </Button>
      </div>
    </Card>
  );
}

function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useT();
  return (
    <label className="flex flex-col gap-1 font-semibold">
      {t("sup.overrideReason", { count: OVERRIDE_REASON_MIN })}
      <textarea
        className={FIELD}
        rows={2}
        maxLength={500}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

type Approval = Omit<DecideRequest, "decision">;

/** What the backend read from the photo, and what may be done about it. */
function Result({
  ticket,
  busy,
  problem,
  onApprove,
  onReject,
  onRetake,
}: {
  ticket: TicketView;
  busy: boolean;
  problem: MessageKey | null;
  onApprove: (approval: Approval) => void;
  onReject: () => void;
  onRetake: () => void;
}) {
  const t = useT();
  const check = supervisorCheck(ticket)!;
  const result = check.matchResult ?? "NOT_READ";
  const left = photosLeft(ticket);
  const [reason, setReason] = useState("");
  const [manual, setManual] = useState(false);
  const [seen, setSeen] = useState("");
  const plateOk = typedPlateMatches(seen, ticket.plate);

  const rejectButton = (
    <Button size="lg" variant="danger" disabled={busy} onClick={onReject}>
      <X aria-hidden />
      {t("action.reject")}
    </Button>
  );
  const retakeButton = (primary = false) => (
    <Button
      size="lg"
      variant={primary ? "primary" : "outline"}
      disabled={busy || left === 0}
      onClick={onRetake}
    >
      <RotateCcw aria-hidden />
      {t("sup.retakeLeft", { count: left })}
    </Button>
  );
  const banners = {
    MATCH: { tone: "go", key: "sup.banner.MATCH" },
    CLOSE: { tone: "wait", key: "sup.banner.CLOSE" },
    NO_MATCH: { tone: "stop", key: "sup.banner.NO_MATCH" },
    NOT_READ: { tone: "stop", key: "sup.banner.NOT_READ" },
    MANUAL: { tone: "info", key: "sup.result.MANUAL" },
  } as const;
  const banner = banners[result];

  return (
    <Card>
      <div data-testid="result" data-result={result} className="flex flex-col gap-3">
        <Banner tone={banner.tone} className="py-3 text-lg">
          <span role="status" className="font-bold">
            {t(banner.key)}
          </span>
        </Banner>
        <div className="flex items-stretch gap-3">
          <ZoomPhoto
            url={photoById(ticket, check.photoId)?.url}
            label={t("sup.myPhoto")}
            className="h-28 w-36 shrink-0 sm:w-52"
          />
          <dl className="grid min-w-0 flex-1 content-center gap-2">
            <div>
              <dt className="text-sm text-muted-foreground">{t("sup.ticketPlate")}</dt>
              <dd className="text-xl font-extrabold">{formatPlate(ticket.plate)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("sup.photoReads")}</dt>
              <dd data-testid="plate-read" className="text-xl font-extrabold">
                {check.plateRead ? formatPlate(check.plateRead) : "—"}
              </dd>
            </div>
          </dl>
        </div>
      </div>
      {problem && <Problem message={problem} />}
      {busy && <Spinner label={t("sup.saving")} />}

      {result === "MATCH" && (
        <>
          <Button
            size="lg"
            variant="go"
            className="min-h-20 text-2xl"
            disabled={busy}
            onClick={() => onApprove({})}
          >
            <Check aria-hidden />
            {t("action.approve")}
          </Button>
          <div className="grid grid-cols-2 gap-3">
            {retakeButton()}
            {rejectButton}
          </div>
        </>
      )}

      {result === "CLOSE" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              variant="go"
              className="min-h-16 text-xl"
              disabled={busy}
              onClick={() => onApprove({ manualCheck: true })}
            >
              <Check aria-hidden />
              {t("action.approve")}
            </Button>
            <Button
              size="lg"
              variant="stop"
              className="min-h-16 text-xl"
              disabled={busy}
              onClick={onReject}
            >
              <X aria-hidden />
              {t("action.reject")}
            </Button>
          </div>
          {retakeButton()}
        </>
      )}

      {result === "NO_MATCH" && (
        <>
          <Button
            size="lg"
            variant="stop"
            className="min-h-20 text-2xl"
            disabled={busy}
            onClick={onReject}
          >
            <X aria-hidden />
            {t("action.reject")}
          </Button>
          {retakeButton()}
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <ReasonField value={reason} onChange={setReason} />
            <Button
              size="lg"
              variant="outline"
              disabled={busy || !reasonIsLongEnough(reason)}
              onClick={() => onApprove({ manualCheck: true, note: reason.trim() })}
            >
              <Check aria-hidden />
              {t("sup.approveAnyway")}
            </Button>
          </div>
        </>
      )}

      {result === "NOT_READ" && (
        <>
          {retakeButton(true)}
          {!manual ? (
            <div className="grid grid-cols-2 gap-3">
              <Button size="lg" variant="outline" disabled={busy} onClick={() => setManual(true)}>
                <Keyboard aria-hidden />
                {t("sup.manualCheck")}
              </Button>
              {rejectButton}
            </div>
          ) : (
            <div data-testid="manual" className="flex flex-col gap-3 border-t border-border pt-3">
              <CardTitle>{t("sup.manualCheck")}</CardTitle>
              <label className="flex flex-col gap-1 font-semibold">
                {t("sup.typePlate")}
                <input
                  className={`${FIELD} font-extrabold tracking-wide uppercase`}
                  value={seen}
                  maxLength={20}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => setSeen(event.target.value)}
                />
              </label>
              {seen.trim().length >= ticket.plate.length && !plateOk && (
                <Banner tone="stop">{t("sup.error.plateDiffers")}</Banner>
              )}
              <ReasonField value={reason} onChange={setReason} />
              <Button
                size="lg"
                variant="go"
                disabled={busy || !plateOk || !reasonIsLongEnough(reason)}
                onClick={() =>
                  onApprove({ manualCheck: true, note: reason.trim(), seenPlate: seen })
                }
              >
                <Check aria-hidden />
                {t("sup.approveManual")}
              </Button>
              {rejectButton}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** After the decision, or when it turns out to have been made already. */
function Finished({ outcome, ticketId }: { outcome: Outcome; ticketId: number }) {
  const t = useT();
  const router = useRouter();
  const { data } = useSupervisorTrucks("pending");
  const next = data?.tickets.find((truck) => truck.ticketId !== ticketId);

  // "Already done" needs no answer: back to the list by itself.
  useEffect(() => {
    if (outcome !== "taken") return;
    const timer = setTimeout(() => router.replace("/supervisor/trucks"), 4000);
    return () => clearTimeout(timer);
  }, [outcome, router]);

  const shown = {
    approved: { tone: "go", key: "sup.done.approved" },
    rejected: { tone: "stop", key: "sup.done.rejected" },
    taken: { tone: "info", key: "sup.done.taken" },
  } as const;
  return (
    <Card>
      <div data-testid="outcome" data-outcome={outcome}>
        <Banner tone={shown[outcome].tone} className="py-4 text-lg">
          <span role="status" className="font-bold">
            {t(shown[outcome].key)}
          </span>
        </Banner>
      </div>
      {next && outcome !== "taken" && (
        <Button asChild size="lg">
          <Link href={`/supervisor/verify/${next.ticketId}`}>
            {t("sup.nextTruckPlate", { plate: formatPlate(next.plate) })}
          </Link>
        </Button>
      )}
      <BackToTrucks primary={!next || outcome === "taken"} />
    </Card>
  );
}

type Outcome = "approved" | "rejected" | "taken";

export function Verify({ ticketId }: { ticketId: number }) {
  const t = useT();
  const queryClient = useQueryClient();
  const query = useSupervisorTicket(ticketId);
  const { busy, run } = useAction();
  /** A photo not yet taken, one waiting to be sent, or "show the result". */
  const [shot, setShot] = useState<Shot | null>(null);
  const [retaking, setRetaking] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /** What was last sent from this page: its answer may have been lost on the way back. */
  const [tried, setTried] = useState<DecideRequest["decision"] | null>(null);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  /** The name of the photo being sent: the same photo, sent again, keeps its key. */
  const shotNumber = useRef(0);

  const refresh = () => queryClient.invalidateQueries({ queryKey: SUPERVISOR_KEY });

  function failed(error: ApiError) {
    if (SOMEONE_ELSE.has(error.code)) setOutcome("taken");
    else setProblem(problemKey(error));
    void refresh();
  }

  async function send(photo: Shot) {
    setProblem(null);
    const answer = await run(`photo:${shotNumber.current}`, async (key) => {
      const form = new FormData();
      form.append("captureSource", photo.source);
      form.append("file", photo.blob, "plate.jpg");
      const result = await api.post<SupervisorPhotoResponse>(
        `/api/supervisor/tickets/${ticketId}/photo`,
        { body: form, idempotencyKey: key },
      );
      // The result is shown from the ticket, so it is loaded before the preview goes.
      await queryClient.refetchQueries({ queryKey: supervisorTicketKey(ticketId) });
      return result;
    });
    if (!answer) return;
    if (!answer.ok) return failed(answer.error);
    setShot(null);
    setRetaking(false);
    void refresh();
  }

  async function decide(approvalId: number, body: DecideRequest) {
    setProblem(null);
    setTried(body.decision);
    const answer = await run(`decide:${approvalId}:${JSON.stringify(body)}`, (key) =>
      api.post(`/api/approvals/${approvalId}/decide`, { body, idempotencyKey: key }),
    );
    if (!answer) return;
    if (!answer.ok) return failed(answer.error);
    setOutcome(body.decision === "APPROVE" ? "approved" : "rejected");
    void refresh();
  }

  const ticket = query.data;
  if (!ticket) {
    const error = query.error instanceof ApiError ? query.error : null;
    const refused = error && !error.retryable;
    return (
      <Card>
        {refused ? (
          <Problem message={error.status === 403 ? "sup.error.notYours" : "sup.error.noTruck"} />
        ) : error ? (
          <>
            <Problem message="error.network" />
            <Button size="lg" onClick={() => void query.refetch()}>
              {t("session.retry")}
            </Button>
          </>
        ) : (
          <Spinner label={t("sup.loading")} className="py-10" />
        )}
        <BackToTrucks />
      </Card>
    );
  }

  if (outcome) return <Finished outcome={outcome} ticketId={ticketId} />;
  const check = supervisorCheck(ticket);
  // While a decision of this page is on its way, the ticket may already show it.
  if (!check || (!busy && ticket.status !== "SUPERVISOR_PENDING")) {
    // It was this page's own decision if it was saved as it was sent.
    const saved = tried === "APPROVE" ? "APPROVED" : tried === "REJECT" ? "REJECTED" : null;
    const own = saved !== null && check?.status === saved;
    return (
      <Finished
        outcome={own ? (tried === "APPROVE" ? "approved" : "rejected") : "taken"}
        ticketId={ticketId}
      />
    );
  }

  const showResult = check.photoId !== null && !retaking && !shot;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <TruckSummary ticket={ticket} />
      {rejecting ? (
        <RejectForm
          busy={busy}
          problem={problem}
          onBack={() => {
            setRejecting(false);
            setProblem(null);
          }}
          onReject={(reason) => void decide(check.id, { decision: "REJECT", reason })}
        />
      ) : shot ? (
        <Preview
          shot={shot}
          busy={busy}
          problem={problem}
          onUse={() => void send(shot)}
          onRetake={() => {
            setShot(null);
            setProblem(null);
          }}
        />
      ) : showResult ? (
        <Result
          // A new photo starts with empty fields.
          key={check.photoId}
          ticket={ticket}
          busy={busy}
          problem={problem}
          onApprove={(approval) => void decide(check.id, { decision: "APPROVE", ...approval })}
          onReject={() => {
            setProblem(null);
            setRejecting(true);
          }}
          onRetake={() => {
            setProblem(null);
            setRetaking(true);
          }}
        />
      ) : (
        <Card>
          <CardTitle>{t("sup.photographPlate")}</CardTitle>
          {problem && <Problem message={problem} />}
          {photosLeft(ticket) === 0 ? (
            <Banner tone="wait">{t("sup.error.photoLimit")}</Banner>
          ) : (
            <LiveCamera
              onShot={(taken) => {
                shotNumber.current += 1;
                setProblem(null);
                setShot(taken);
              }}
            />
          )}
          {check.photoId !== null && (
            <Button size="lg" variant="outline" onClick={() => setRetaking(false)}>
              <ArrowLeft aria-hidden />
              {t("sup.backToResult")}
            </Button>
          )}
        </Card>
      )}
      {!rejecting && <BackToTrucks />}
    </div>
  );
}
