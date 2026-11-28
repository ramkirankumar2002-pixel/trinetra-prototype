"use client";

// One request: everything about the truck, and the decision. The backend checks every
// decision again and saves who made it, when and why.
import { useQueryClient } from "@tanstack/react-query";
import {
  formatIST,
  formatKg,
  formatPlate,
  waitsForPerson,
  type DecideRequest,
  type StoreRequestView,
  type TicketView,
} from "@trinetra/shared";
import { ArrowRight, Check, CheckCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { api, ApiError } from "@/lib/api";
import { useAction } from "@/lib/kiosk/use-action";
import {
  ALLOW_CHIPS,
  ALREADY_HANDLED,
  canAccept,
  decisionWords,
  cancellationOf,
  holdSum,
  INVOICE_WEIGHT_CHIPS,
  mayUploadBill,
  plateWarningData,
  reasonWords,
  REJECT_CHIPS,
  visitHasEnded,
  type ReasonChip,
} from "@/lib/store/logic";
import {
  STORE_KEY,
  useMaterials,
  useStorePending,
  useStoreRequest,
  useStoreTicket,
} from "@/lib/store/queries";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { Card, CardTitle } from "../ui/card";
import { Spinner } from "../ui/spinner";
import { materialText, PlateText } from "../supervisor/parts";
import { WaitPill } from "../wait-pill";
import { CancelVisit } from "./cancel-visit";
import { BackLink, Facts, KindPill, LoadFailed, Loading, PageState } from "./parts";
import { FIELD, ReasonForm } from "./reason-form";
import {
  BillCard,
  HoldCalculation,
  PhotosCard,
  TimelineCard,
  TruckCard,
  WeightsCard,
} from "./ticket-panels";
import { UploadBill } from "./upload-bill";

const LIST = "/store/approvals";
/** How long "Already handled" is shown before the list comes back by itself. */
const BACK_AFTER_MS = 4000;

const PROBLEMS: Partial<Record<string, MessageKey>> = {
  NETWORK_ERROR: "error.network",
  SERVER_UNREACHABLE: "error.network",
  RATE_LIMITED: "error.tooMany",
  REASON_REQUIRED: "store.error.reason",
  CHOICE_NOT_AVAILABLE: "store.error.choice",
};

type Outcome =
  "approved" | "rejected" | "seen" | "handled" | "uploaded" | "material" | "cancelled" | "taken";

const OUTCOMES: Record<Outcome, { tone: "go" | "stop" | "info"; key: MessageKey }> = {
  approved: { tone: "go", key: "store.done.approved" },
  rejected: { tone: "stop", key: "store.done.rejected" },
  seen: { tone: "go", key: "store.done.seen" },
  handled: { tone: "go", key: "store.done.handled" },
  uploaded: { tone: "go", key: "store.done.uploaded" },
  material: { tone: "go", key: "store.done.material" },
  cancelled: { tone: "go", key: "store.done.cancelled" },
  taken: { tone: "info", key: "store.done.taken" },
};

/** A decision that first asks why. */
interface Asking {
  title: string;
  chips: readonly ReasonChip[];
  confirm: MessageKey;
  danger: boolean;
  body: Omit<DecideRequest, "reason">;
  outcome: Outcome;
}

type Decide = (body: DecideRequest, outcome: Outcome) => void;

interface ActionProps {
  request: StoreRequestView;
  ticket: TicketView | undefined;
  busy: boolean;
  decide: Decide;
  ask: (asking: Asking) => void;
}

const BIG = "h-auto min-h-16 py-2 text-lg";

function useReject(ask: ActionProps["ask"], plate: string) {
  const t = useT();
  return () =>
    ask({
      title: t("store.ask.reject", { plate }),
      chips: REJECT_CHIPS,
      confirm: "store.action.rejectTruck",
      danger: true,
      body: { decision: "REJECT" },
      outcome: "rejected",
    });
}

function RejectButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <Button size="lg" variant="danger" className={BIG} disabled={busy} onClick={onClick}>
      <X aria-hidden />
      {t("action.reject")}
    </Button>
  );
}

function Type2Actions({ request, busy, decide, ask }: ActionProps) {
  const t = useT();
  const ticket = request.ticket!;
  const reject = useReject(ask, formatPlate(ticket.plate));
  return (
    <>
      <p>
        {t(ticket.noInvoice ? "store.noInvoice.text" : "store.type2.text", {
          kg: ticket.heldWeightKg === null ? "—" : formatKg(ticket.heldWeightKg),
        })}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Button
          size="lg"
          variant="go"
          className={BIG}
          disabled={busy}
          onClick={() => decide({ decision: "APPROVE" }, "approved")}
        >
          <Check aria-hidden />
          {t("action.approve")}
        </Button>
        <RejectButton busy={busy} onClick={reject} />
      </div>
    </>
  );
}

function HoldActions({ request, ticket, busy, decide, ask }: ActionProps) {
  const t = useT();
  const plate = formatPlate(request.ticket!.plate);
  const reject = useReject(ask, plate);
  const { netKg, invoiceKg } = holdSum(ticket!);
  return (
    <>
      <p>{t("store.hold.text")}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Button
          size="lg"
          variant="go"
          className={BIG}
          disabled={busy || !canAccept(netKg)}
          onClick={() => decide({ decision: "APPROVE", chosenWeight: "NET" }, "approved")}
        >
          <Check aria-hidden />
          {t("store.action.acceptNet", { kg: canAccept(netKg) ? formatKg(netKg) : "—" })}
        </Button>
        <Button
          size="lg"
          variant="outline"
          className={BIG}
          disabled={busy || !canAccept(invoiceKg)}
          onClick={() =>
            ask({
              title: t("store.ask.invoice", { kg: formatKg(invoiceKg!), plate }),
              chips: INVOICE_WEIGHT_CHIPS,
              confirm: "store.action.confirmInvoice",
              danger: false,
              body: { decision: "APPROVE", chosenWeight: "INVOICE" },
              outcome: "approved",
            })
          }
        >
          <Check aria-hidden />
          {t("store.action.acceptInvoice", {
            kg: canAccept(invoiceKg) ? formatKg(invoiceKg) : "—",
          })}
        </Button>
      </div>
      <RejectButton busy={busy} onClick={reject} />
    </>
  );
}

function MismatchActions({ request, ticket, busy, decide, ask }: ActionProps) {
  const t = useT();
  const reject = useReject(ask, formatPlate(request.ticket!.plate));
  const { data, isError } = useMaterials(true);
  const [material, setMaterial] = useState("");
  const said = ticket?.timeline.filter((entry) => entry.type === "MATERIAL_MISMATCH").at(-1)?.data;
  const words = (value: unknown) => (typeof value === "string" ? materialText(value, t) : null);
  return (
    <>
      <Facts
        facts={[
          ["store.driverSaid", words(said?.driverSaid)],
          ["store.billSays", words(said?.invoiceSays)],
        ]}
      />
      <label className="flex flex-col gap-1 font-semibold">
        {t("store.mismatch.pick")}
        <select
          className={FIELD}
          value={material}
          disabled={busy || !data}
          onChange={(event) => setMaterial(event.target.value)}
        >
          <option value="">{t("store.mismatch.choose")}</option>
          {data?.materials.map(({ name }) => (
            <option key={name} value={name}>
              {materialText(name, t)}
            </option>
          ))}
        </select>
      </label>
      {isError && <Banner tone="stop">{t("sup.loadFailed")}</Banner>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Button
          size="lg"
          variant="go"
          className={BIG}
          disabled={busy || material === ""}
          onClick={() => decide({ decision: "APPROVE", chosenMaterial: material }, "material")}
        >
          <ArrowRight aria-hidden />
          {t("store.action.setMaterial")}
        </Button>
        <RejectButton busy={busy} onClick={reject} />
      </div>
    </>
  );
}

function PlateWarningActions({ request, ticket, busy, decide, ask }: ActionProps) {
  const t = useT();
  const plate = formatPlate(request.ticket!.plate);
  const reject = useReject(ask, plate);
  const data = ticket && plateWarningData(ticket, request.approval.id);
  const shown = (read: string | null | undefined) => (read ? formatPlate(read) : "—");

  if (request.approval.plateWarningReason === "FRONT_BACK_MISMATCH") {
    return (
      <>
        <Banner tone="wait">{t("store.frontBack.text")}</Banner>
        <Facts
          facts={[
            ["store.photo.front", shown(data?.front)],
            ["store.photo.back", shown(data?.back)],
          ]}
        />
        <Button
          size="lg"
          className={BIG}
          disabled={busy}
          onClick={() => decide({ decision: "APPROVE" }, "seen")}
        >
          <CheckCheck aria-hidden />
          {t("store.action.seen")}
        </Button>
      </>
    );
  }
  return (
    <>
      <Banner tone="stop">{t("store.blocked.text")}</Banner>
      <Facts
        facts={[
          ["store.blocked.earlierTicket", data?.earlierTicketNo],
          [
            "store.blocked.earlierResult",
            data?.earlierStatus &&
              t(
                data.earlierStatus === "BLOCKED"
                  ? "store.blocked.bySupervisor"
                  : "store.blocked.byStore",
              ),
          ],
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Button
          size="lg"
          variant="go"
          className={BIG}
          disabled={busy}
          onClick={() =>
            ask({
              title: t("store.ask.allow", { plate }),
              chips: ALLOW_CHIPS,
              confirm: "store.action.allowTruck",
              danger: false,
              body: { decision: "APPROVE" },
              outcome: "approved",
            })
          }
        >
          <Check aria-hidden />
          {t("store.action.allow")}
        </Button>
        <RejectButton busy={busy} onClick={reject} />
      </div>
    </>
  );
}

function HelpActions({
  request,
  ticket,
  busy,
  decide,
  onSent,
  onRefused,
}: ActionProps & { onSent: () => void; onRefused: (error: ApiError) => boolean }) {
  const t = useT();
  const upload = mayUploadBill(ticket);
  return (
    <>
      {upload ? (
        <UploadBill
          approvalId={request.approval.id}
          ticket={ticket!}
          onSent={onSent}
          onRefused={onRefused}
        />
      ) : (
        <p>{t(request.ticket ? "store.help.text" : "store.help.noTicket")}</p>
      )}
      <Button
        size="lg"
        variant={upload ? "outline" : "primary"}
        className={BIG}
        disabled={busy}
        onClick={() => decide({ decision: "APPROVE" }, "handled")}
      >
        <CheckCheck aria-hidden />
        {t("store.action.handled")}
      </Button>
    </>
  );
}

/** What was decided: for a request that is no longer waiting. */
function Decision({ request }: { request: StoreRequestView }) {
  const t = useT();
  const { approval } = request;
  const { result } = decisionWords({
    ...approval,
    status: approval.status === "APPROVED" ? "APPROVED" : "REJECTED",
  });
  return (
    <Card data-testid="decision">
      <CardTitle>{t("store.decision")}</CardTitle>
      <Facts
        facts={[
          ["slip.status", t(result)],
          // Not "Approved by": the answer may have been no.
          ["store.decidedBy", approval.decidedBy],
          ["sup.decidedAt", approval.decidedAt && formatIST(new Date(approval.decidedAt))],
          ["sup.reasonLabel", approval.reason && reasonWords(approval.reason, t)],
          [
            "store.chosenWeight",
            approval.chosenWeight &&
              t(
                approval.chosenWeight === "MEASURED_NET"
                  ? "slip.acceptedNet"
                  : "slip.acceptedInvoice",
              ),
          ],
          ["column.material", approval.chosenMaterial && materialText(approval.chosenMaterial, t)],
        ]}
      />
    </Card>
  );
}

/** After the decision, or when it turns out to have been made already. */
function Finished({ outcome, approvalId }: { outcome: Outcome; approvalId: number }) {
  const t = useT();
  const router = useRouter();
  const { data } = useStorePending();
  const next = data?.requests.filter((item) => item.approval.id !== approvalId).at(-1);

  // "Already handled" needs no answer: back to the list by itself.
  useEffect(() => {
    if (outcome !== "taken") return;
    const timer = setTimeout(() => router.replace(LIST), BACK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [outcome, router]);

  return (
    <Card>
      <div data-testid="outcome" data-outcome={outcome}>
        <Banner tone={OUTCOMES[outcome].tone} className="py-4 text-lg">
          <span role="status" className="font-bold">
            {t(OUTCOMES[outcome].key)}
          </span>
        </Banner>
      </div>
      {next && outcome !== "taken" && (
        <Button asChild size="lg">
          <Link href={`${LIST}/${next.approval.id}`}>
            {next.ticket
              ? t("store.nextPlate", { plate: formatPlate(next.ticket.plate) })
              : t("store.next")}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      )}
      <BackLink href={LIST} label="store.backToApprovals" primary={!next || outcome === "taken"} />
    </Card>
  );
}

export function RequestDetail({ approvalId }: { approvalId: number }) {
  const t = useT();
  const queryClient = useQueryClient();
  const query = useStoreRequest(approvalId);
  const ticketQuery = useStoreTicket(query.data?.ticket?.id);
  const { busy, run } = useAction();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  /** What was last sent from this page: its answer may have been lost on the way back. */
  const [sent, setSent] = useState<Outcome | null>(null);
  /** The page has shown this request waiting. */
  const [wasWaiting, setWasWaiting] = useState(false);

  const request = query.data;
  const ticket = ticketQuery.data;
  // A request whose visit has ended (cancelled, for example) is no longer waiting.
  const pending =
    request?.approval.status === "PENDING" && !visitHasEnded(ticket, request.approval);
  if (pending && !wasWaiting) setWasWaiting(true);

  const refresh = () => queryClient.invalidateQueries({ queryKey: STORE_KEY });

  /** True if the refusal means there is nothing left to do here. */
  function refused(error: ApiError): boolean {
    void refresh();
    if (!ALREADY_HANDLED.has(error.code)) return false;
    setAsking(null);
    setOutcome("taken");
    return true;
  }

  async function send(body: DecideRequest, wanted: Outcome) {
    setProblem(null);
    setSent(wanted);
    // The same press, sent again after a lost answer, keeps its Idempotency-Key.
    const answer = await run(`decide:${approvalId}:${JSON.stringify(body)}`, (key) =>
      api.post(`/api/approvals/${approvalId}/decide`, { body, idempotencyKey: key }),
    );
    if (!answer) return;
    if (!answer.ok) {
      if (!refused(answer.error)) setProblem(PROBLEMS[answer.error.code] ?? "error.generic");
      return;
    }
    setAsking(null);
    setOutcome(wanted);
    void refresh();
  }

  if (!request || (request.ticket && !ticket)) {
    const error = query.error ?? ticketQuery.error;
    const gone = error instanceof ApiError && !error.retryable;
    return (
      <PageState>
        {gone ? (
          <Banner tone="stop">{t("store.error.noRequest")}</Banner>
        ) : error ? (
          <LoadFailed onRetry={() => void refresh()} />
        ) : (
          <Loading />
        )}
        <BackLink href={LIST} label="store.backToApprovals" />
      </PageState>
    );
  }

  const { approval } = request;
  if (outcome) return <Finished outcome={outcome} approvalId={approvalId} />;
  // It was waiting here and now it is not, while nothing of this page is on its way.
  if (wasWaiting && !pending && !busy) {
    // This page's own, if it was saved as it was sent: the answer was lost on the way.
    const own =
      sent === "cancelled"
        ? ticket !== undefined && cancellationOf(ticket) !== null
        : sent !== null && (approval.status === "APPROVED") === (sent !== "rejected");
    return <Finished outcome={own && sent ? sent : "taken"} approvalId={approvalId} />;
  }

  const props: ActionProps = {
    request,
    ticket,
    busy,
    decide: (body, wanted) => void send(body, wanted),
    ask: (next) => {
      setProblem(null);
      setAsking(next);
    },
  };
  const problemBanner = problem && (
    <Banner tone="stop">
      <span role="alert">{t(problem)}</span>
    </Banner>
  );

  const actions = !pending ? (
    <>
      <Banner tone="info">{t("store.done.taken")}</Banner>
      {approval.status !== "PENDING" && <Decision request={request} />}
    </>
  ) : cancelling ? null : asking ? (
    <ReasonForm
      title={asking.title}
      chips={asking.chips}
      confirm={asking.confirm}
      danger={asking.danger}
      busy={busy}
      problem={problemBanner}
      onBack={() => {
        setAsking(null);
        setProblem(null);
      }}
      onConfirm={(reason) => void send({ ...asking.body, reason }, asking.outcome)}
    />
  ) : (
    <Card data-testid="actions">
      <CardTitle>{t("store.yourDecision")}</CardTitle>
      {problemBanner}
      {approval.kind === "STORE_TYPE2" && <Type2Actions {...props} />}
      {approval.kind === "HOLD" && <HoldActions {...props} />}
      {approval.kind === "MISMATCH" && <MismatchActions {...props} />}
      {approval.kind === "PLATE_WARNING" && <PlateWarningActions {...props} />}
      {approval.kind === "DRIVER_HELP" && (
        <HelpActions
          {...props}
          // A bill read from here answers the call by itself: that is this page's "done".
          onSent={() => setSent("uploaded")}
          onRefused={refused}
        />
      )}
      {busy && <Spinner label={t("sup.saving")} />}
    </Card>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <KindPill
          approval={approval}
          needsBill={request.needsBill}
          noInvoice={request.ticket?.noInvoice}
        />
        {pending && <WaitPill since={approval.createdAt} />}
        {!ticket && <p>{t("store.help.noTicket")}</p>}
      </div>
      {/* On a laptop the decision stays beside the facts; on a phone it follows them. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {ticket && (
          <div className="flex min-w-0 flex-col gap-4">
            <TruckCard ticket={ticket} />
            {approval.kind === "HOLD" && <HoldCalculation ticket={ticket} />}
            <PhotosCard ticket={ticket} />
            <BillCard ticket={ticket} />
            {approval.kind !== "HOLD" && <WeightsCard ticket={ticket} />}
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
          {ticket && (
            <p className="lg:hidden">
              <PlateText plate={ticket.plate} size="small" />
            </p>
          )}
          {actions}
          {pending &&
            !asking &&
            ticket &&
            waitsForPerson(
              ticket.status,
              ticket.approvals.filter((row) => row.status === "PENDING"),
            ) && (
              <CancelVisit
                ticket={ticket}
                open={cancelling}
                onOpen={setCancelling}
                onSend={() => setSent("cancelled")}
                onDone={setOutcome}
              />
            )}
          <BackLink href={LIST} label="store.backToApprovals" />
        </div>
        {ticket && (
          <div className="min-w-0 lg:col-span-2">
            <TimelineCard ticket={ticket} />
          </div>
        )}
      </div>
    </div>
  );
}
