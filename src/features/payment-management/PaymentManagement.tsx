import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DestinationAccount, Invoice, Payment, PaymentAllocation, PaymentInstruction, PaymentVerification, Party } from "../../domain";
import {
  formatPaymentLifecycleLabel,
  formatPaymentMethodLabel,
  formatPaymentVerificationMethodLabel,
  formatPaymentVerificationStatusLabel,
  findProbablePaymentDraftWarnings,
  findProbablePaymentDuplicateWarnings,
  filterPayments,
  isPaymentAllocatable,
  isPaymentEditable,
  isPaymentVerifiable,
  paymentAllocationDraftSchema,
  paymentDraftSchema,
  paymentLifecycleStatusValues,
  paymentVerificationDraftSchema,
  paymentVerificationStatusFilterValues,
  parsePaymentDraftFromPayment,
  summarizePaymentAllocationForDisplay,
  summarizePaymentAllocationProgress,
  summarizePaymentForDisplay,
  summarizePaymentVerificationForDisplay,
  type PaymentAllocationDraft,
  type PaymentDraft,
  type PaymentDuplicateWarning,
  type PaymentListFilter,
  type PaymentVerificationDraft
} from "../../domain/payments";
import { formatInvoiceAmount, formatInvoiceDate, normalizeInvoiceAmountInputText } from "../../domain/invoices";
import { db } from "../../db/tasviehyar-db";
import { createDestinationAccountRepository, type DestinationAccountRepository } from "../../services/destination-account-repository";
import { createInvoiceRepository, type InvoiceRepository } from "../../services/invoice-repository";
import { createPartyRepository, type PartyRepository } from "../../services/party-repository";
import { createPaymentInstructionRepository, type PaymentInstructionRepository } from "../../services/payment-instruction-repository";
import { createPaymentRepository, type PaymentRepository } from "../../services/payment-repository";
import { findDuplicateTrackingReferenceWarnings } from "../../domain/calculations";
import { paymentMethodValues, paymentVerificationMethodValues, paymentVerificationStatusValues } from "../../domain/schemas";
import { getTehranBusinessDate } from "../../domain/business-date";

export interface PaymentManagementProps {
  repository?: PaymentRepository;
  partyRepository?: PartyRepository;
  invoiceRepository?: InvoiceRepository;
  destinationAccountRepository?: DestinationAccountRepository;
  paymentInstructionRepository?: PaymentInstructionRepository;
}

type PaymentFormState = {
  payerPartyId: string;
  recipientPartyId: string;
  destinationAccountId: string;
  amountText: string;
  paymentDate: string;
  paymentMethod: Payment["paymentMethod"];
  verificationStatus: Payment["verificationStatus"];
  verificationMethod: PaymentVerification["verificationMethod"];
  verifierDescriptionOrPartyRef: string;
  trackingReference: string;
  note: string;
  initialInvoiceId: string;
  initialInstructionId: string;
  initialAllocationAmountText: string;
};

type AllocationFormState = {
  invoiceId: string;
  paymentInstructionId: string;
  allocatedAmountText: string;
};

function createEmptyPaymentFormState(): PaymentFormState {
  return {
  payerPartyId: "",
  recipientPartyId: "",
  destinationAccountId: "",
  amountText: "",
  paymentDate: getTehranBusinessDate(),
  paymentMethod: "bank_transfer",
  verificationStatus: "reported",
  verificationMethod: "receipt_review",
  verifierDescriptionOrPartyRef: "",
  trackingReference: "",
  note: "",
  initialInvoiceId: "",
  initialInstructionId: "",
  initialAllocationAmountText: ""
  };
}

const emptyAllocationFormState: AllocationFormState = {
  invoiceId: "",
  paymentInstructionId: "",
  allocatedAmountText: ""
};

const defaultPaymentRepository = createPaymentRepository(db);
const defaultPartyRepository = createPartyRepository(db);
const defaultInvoiceRepository = createInvoiceRepository(db);
const defaultDestinationAccountRepository = createDestinationAccountRepository(db);
const defaultPaymentInstructionRepository = createPaymentInstructionRepository(db);

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return Promise.resolve();
}

function paymentFormFromPayment(payment: Payment): PaymentFormState {
  const draft = parsePaymentDraftFromPayment(payment);
  return {
    payerPartyId: draft.payerPartyId,
    recipientPartyId: draft.recipientPartyId,
    destinationAccountId: draft.destinationAccountId ?? "",
    amountText: String(draft.amount),
    paymentDate: draft.paymentDate,
    paymentMethod: draft.paymentMethod,
    verificationStatus: draft.verificationStatus,
    verificationMethod: "receipt_review",
    verifierDescriptionOrPartyRef: "",
    trackingReference: draft.trackingReference ?? "",
    note: draft.note ?? "",
    initialInvoiceId: "",
    initialInstructionId: "",
    initialAllocationAmountText: ""
  };
}

function buildPaymentDraftCandidate(formState: PaymentFormState): PaymentDraft {
  return paymentDraftSchema.parse({
    payerPartyId: formState.payerPartyId,
    recipientPartyId: formState.recipientPartyId,
    destinationAccountId: formState.destinationAccountId,
    amountText: formState.amountText,
    paymentDate: formState.paymentDate,
    paymentMethod: formState.paymentMethod,
    verificationStatus: formState.verificationStatus,
    trackingReference: formState.trackingReference,
    note: formState.note
  });
}

function buildAllocationDraftCandidate(formState: PaymentFormState, instructions: readonly PaymentInstruction[]): PaymentAllocationDraft | undefined {
  if (!formState.initialInvoiceId && !formState.initialInstructionId && !formState.initialAllocationAmountText.trim()) {
    return undefined;
  }

  const instruction = formState.initialInstructionId
    ? instructions.find((entry) => entry.id === formState.initialInstructionId)
    : undefined;
  const invoiceId = formState.initialInvoiceId || instruction?.invoiceId;
  if (!invoiceId) {
    return undefined;
  }

  return paymentAllocationDraftSchema.parse({
    invoiceId,
    paymentInstructionId: formState.initialInstructionId,
    allocatedAmountText: formState.initialAllocationAmountText || formState.amountText
  });
}

function buildVerificationDraftCandidate(formState: PaymentFormState): PaymentVerificationDraft | undefined {
  if (formState.verificationStatus === "reported") {
    return undefined;
  }

  return paymentVerificationDraftSchema.parse({
    verificationResult: formState.verificationStatus,
    verifierDescriptionOrPartyRef: formState.verifierDescriptionOrPartyRef,
    verificationMethod: formState.verificationMethod,
    note: formState.note
  });
}

function formatPaymentWarning(warning: PaymentDuplicateWarning): string {
  const repeated = warning.matchedPaymentSummaries.join("، ");
  const trackingText = warning.trackingReference ? `، پیگیری «${warning.trackingReference}»` : "";
  return `پرداخت مشابه احتمالی برای تاریخ ${warning.paymentDate} و مبلغ ${formatInvoiceAmount(warning.amount)}${trackingText} پیدا شد: ${repeated}`;
}

function formatPaymentDraftSummary(
  paymentDraft: PaymentDraft,
  payerName?: string,
  recipientName?: string,
  allocation?: PaymentAllocationDraft
): string {
  const parts = [
    payerName ? `پرداخت‌کننده: ${payerName}` : "پرداخت‌کننده انتخاب نشده",
    recipientName ? `گیرنده: ${recipientName}` : "گیرنده انتخاب نشده",
    `مبلغ: ${formatInvoiceAmount(paymentDraft.amount)}`,
    `تاریخ: ${paymentDraft.paymentDate}`,
    `روش: ${formatPaymentMethodLabel(paymentDraft.paymentMethod)}`,
    `وضعیت اولیه: ${formatPaymentVerificationStatusLabel(paymentDraft.verificationStatus)}`
  ];

  if (paymentDraft.destinationAccountId) {
    parts.push(`حساب مقصد: ${paymentDraft.destinationAccountId}`);
  }

  if (paymentDraft.trackingReference) {
    parts.push(`شماره پیگیری: ${paymentDraft.trackingReference}`);
  }

  if (allocation) {
    parts.push(`تخصیص اولیه: ${formatInvoiceAmount(allocation.allocatedAmount)}`);
  }

  return parts.join(" · ");
}

function formatPartyLabel(party: Party): string {
  return party.active ? party.displayName : `${party.displayName} (بایگانی)`;
}

function filterActiveOrCurrent<T extends { id: string; active?: boolean }>(items: readonly T[], currentId: string): T[] {
  return items.filter((item) => item.active || item.id === currentId);
}

function notifyDataUpdated(): void {
  window.dispatchEvent(new Event("tasviehyar-data-updated"));
}

export function PaymentManagement({
  repository = defaultPaymentRepository,
  partyRepository = defaultPartyRepository,
  invoiceRepository = defaultInvoiceRepository,
  destinationAccountRepository = defaultDestinationAccountRepository,
  paymentInstructionRepository = defaultPaymentInstructionRepository
}: PaymentManagementProps) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);
  const [verifications, setVerifications] = useState<PaymentVerification[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [destinationAccounts, setDestinationAccounts] = useState<DestinationAccount[]>([]);
  const [instructions, setInstructions] = useState<PaymentInstruction[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [formState, setFormState] = useState<PaymentFormState>(createEmptyPaymentFormState);
  const [allocationFormState, setAllocationFormState] = useState<AllocationFormState>(emptyAllocationFormState);
  const [filter, setFilter] = useState<PaymentListFilter>({
    query: "",
    lifecycleStatus: "all",
    verificationStatus: "all"
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const savingRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadContext = useCallback(
    async (nextSelectionId?: string | null) => {
      const [nextPayments, nextAllocations, nextVerifications, nextParties, nextInvoices, nextDestinationAccounts, nextInstructions] =
        await Promise.all([
          repository.listPayments(),
          repository.listAllocations(),
          repository.listVerifications(),
          partyRepository.listParties(),
          invoiceRepository.listInvoices(),
          destinationAccountRepository.listAccounts(),
          paymentInstructionRepository.listInstructions()
        ]);

      if (!isMountedRef.current) {
        return;
      }

      setPayments(nextPayments);
      setAllocations(nextAllocations);
      setVerifications(nextVerifications);
      setParties(nextParties);
      setInvoices(nextInvoices);
      setDestinationAccounts(nextDestinationAccounts);
      setInstructions(nextInstructions);
      if (typeof nextSelectionId !== "undefined") {
        setSelectedPaymentId(nextSelectionId);
      }
      setLoading(false);
    },
    [destinationAccountRepository, invoiceRepository, partyRepository, paymentInstructionRepository, repository]
  );

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  useEffect(() => {
    function handleOpenRecord(event: Event) {
      const detail = (event as CustomEvent<{ section?: string; recordId?: string }>).detail;
      if (detail?.section === "payments" && detail.recordId) {
        setSelectedPaymentId(detail.recordId);
        document.getElementById("payment-management")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }
    }

    window.addEventListener("tasviehyar-open-record", handleOpenRecord as EventListener);
    return () => window.removeEventListener("tasviehyar-open-record", handleOpenRecord as EventListener);
  }, []);

  const selectedPayment = useMemo(() => payments.find((payment) => payment.id === selectedPaymentId) ?? null, [payments, selectedPaymentId]);

  useEffect(() => {
    if (selectedPayment) {
      setFormState(paymentFormFromPayment(selectedPayment));
      setAllocationFormState(emptyAllocationFormState);
      setCopyNotice(null);
      return;
    }

    setFormState(createEmptyPaymentFormState());
    setAllocationFormState(emptyAllocationFormState);
  }, [selectedPayment]);

  const filteredPayments = useMemo(
    () => filterPayments(payments, parties, destinationAccounts, invoices, instructions, allocations, filter),
    [allocations, destinationAccounts, filter, invoices, instructions, parties, payments]
  );

  const paymentWarnings = useMemo(
    () =>
      findDuplicateTrackingReferenceWarnings(payments).filter(
        (warning): warning is { kind: "duplicate_tracking_reference"; trackingReference: string; paymentIds: string[] } =>
          warning.kind === "duplicate_tracking_reference"
      ),
    [payments]
  );
  const duplicatePaymentWarnings = useMemo(
    () => findProbablePaymentDuplicateWarnings(payments, parties, destinationAccounts),
    [destinationAccounts, parties, payments]
  );
  const paymentDraft = useMemo(() => {
    try {
      return buildPaymentDraftCandidate(formState);
    } catch {
      return null;
    }
  }, [formState]);
  const allocationDraftPreview = useMemo(() => {
    try {
      return buildAllocationDraftCandidate(formState, instructions) ?? null;
    } catch {
      return null;
    }
  }, [formState, instructions]);
  const draftWarnings = useMemo(
    () =>
      paymentDraft
        ? findProbablePaymentDraftWarnings(payments, parties, destinationAccounts, paymentDraft, selectedPayment?.id)
        : [],
    [destinationAccounts, paymentDraft, parties, payments, selectedPayment?.id]
  );

  const payerOptions = useMemo(() => filterActiveOrCurrent(parties, formState.payerPartyId), [formState.payerPartyId, parties]);
  const recipientOptions = useMemo(() => filterActiveOrCurrent(parties, formState.recipientPartyId), [formState.recipientPartyId, parties]);
  const allocationInvoiceOptions = useMemo(
    () => invoices.filter((invoice) => invoice.lifecycleStatus !== "cancelled" || invoice.id === allocationFormState.invoiceId),
    [allocationFormState.invoiceId, invoices]
  );
  const allocationInstructionOptions = useMemo(
    () =>
      instructions.filter(
        (instruction) =>
          (!allocationFormState.invoiceId || instruction.invoiceId === allocationFormState.invoiceId) &&
          (instruction.lifecycleStatus === "active" || instruction.id === allocationFormState.paymentInstructionId)
      ),
    [allocationFormState.invoiceId, allocationFormState.paymentInstructionId, instructions]
  );
  const paymentDestinationAccountOptions = useMemo(
    () =>
      destinationAccounts.filter(
        (account) =>
          account.ownerPartyId === formState.recipientPartyId &&
          (account.active || account.id === formState.destinationAccountId)
      ),
    [destinationAccounts, formState.destinationAccountId, formState.recipientPartyId]
  );

  const selectedPaymentAllocations = useMemo(
    () => allocations.filter((allocation) => allocation.paymentId === selectedPayment?.id),
    [allocations, selectedPayment?.id]
  );
  const selectedPaymentVerifications = useMemo(
    () => verifications.filter((verification) => verification.paymentId === selectedPayment?.id),
    [selectedPayment?.id, verifications]
  );
  const selectedPaymentProgress = useMemo(
    () => (selectedPayment ? summarizePaymentAllocationProgress(selectedPayment, selectedPaymentAllocations) : null),
    [selectedPayment, selectedPaymentAllocations]
  );
  const selectedPaymentAllocationWarnings = useMemo(() => {
    if (!selectedPayment) {
      return [] as string[];
    }

    const warnings: string[] = [];
    if (selectedPaymentProgress?.isUnallocated) {
      warnings.push("این پرداخت هنوز تخصیص ندارد.");
    }
    if (selectedPayment.verificationStatus === "disputed") {
      warnings.push("این پرداخت مورد اختلاف است و باید بررسی شود.");
    }

    const allocationTotalsByInstruction = new Map<string, number>();
    for (const allocation of selectedPaymentAllocations) {
      if (!allocation.paymentInstructionId) {
        continue;
      }
      allocationTotalsByInstruction.set(
        allocation.paymentInstructionId,
        (allocationTotalsByInstruction.get(allocation.paymentInstructionId) ?? 0) + allocation.allocatedAmount
      );
    }

    for (const [instructionId, allocatedAmount] of allocationTotalsByInstruction.entries()) {
      const instruction = instructions.find((entry) => entry.id === instructionId);
      if (instruction && allocatedAmount > instruction.instructedAmount) {
        warnings.push(`تخصیص به دستور «${instruction.id}» از مبلغ دستور بیشتر شده است.`);
      }
    }

    return warnings;
  }, [instructions, selectedPayment, selectedPaymentAllocations, selectedPaymentProgress?.isUnallocated]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    setError(null);
    setCopyNotice(null);

    try {
      const parsedDraft = buildPaymentDraftCandidate(formState);
      const initialAllocation = buildAllocationDraftCandidate(formState, instructions);
      const initialVerification = buildVerificationDraftCandidate(formState);
      const savedPayment = selectedPayment
        ? await repository.updatePayment(selectedPayment.id, parsedDraft)
        : await repository.createPayment(parsedDraft, initialAllocation, initialVerification);

      await loadContext(savedPayment.id);
      notifyDataUpdated();
      setNotice(selectedPayment ? "پرداخت با موفقیت به‌روزرسانی شد." : "پرداخت جدید با موفقیت ثبت شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ذخیره‌سازی ناموفق بود.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPayment) {
      return;
    }
    if (savingRef.current) {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const verificationDraft = paymentVerificationDraftSchema.parse({
        verificationResult: formState.verificationStatus,
        verifierDescriptionOrPartyRef: formState.verifierDescriptionOrPartyRef,
        verificationMethod: formState.verificationMethod,
        note: formState.note
      });
      await repository.recordVerification(selectedPayment.id, verificationDraft);
      await loadContext(selectedPayment.id);
      notifyDataUpdated();
      setNotice("وضعیت تأیید پرداخت ثبت شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ثبت تأیید ناموفق بود.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleAllocationSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPayment) {
      return;
    }
    if (savingRef.current) {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const allocationDraft = paymentAllocationDraftSchema.parse({
        invoiceId: allocationFormState.invoiceId,
        paymentInstructionId: allocationFormState.paymentInstructionId,
        allocatedAmountText: allocationFormState.allocatedAmountText
      });
      await repository.createAllocation(selectedPayment.id, allocationDraft);
      await loadContext(selectedPayment.id);
      notifyDataUpdated();
      setNotice("تخصیص جدید پرداخت ثبت شد.");
      setAllocationFormState(emptyAllocationFormState);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ثبت تخصیص ناموفق بود.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleLifecycleChange(nextStatus: "cancelled" | "reversed") {
    if (!selectedPayment) {
      return;
    }
    if (savingRef.current) {
      return;
    }

    const confirmText = nextStatus === "cancelled" ? "آیا می‌خواهید این پرداخت را لغو کنید؟" : "آیا می‌خواهید این پرداخت را برگشت بزنید؟";
    if (!window.confirm(confirmText)) {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const savedPayment = nextStatus === "cancelled" ? await repository.cancelPayment(selectedPayment.id) : await repository.reversePayment(selectedPayment.id);
      await loadContext(savedPayment.id);
      notifyDataUpdated();
      setNotice(nextStatus === "cancelled" ? "پرداخت لغو شد." : "پرداخت برگشت خورد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "عملیات ناموفق بود.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleCopyTrackingReference() {
    if (!selectedPayment?.trackingReference) {
      setCopyNotice("شماره پیگیری برای کپی وجود ندارد.");
      return;
    }

    await copyText(selectedPayment.trackingReference);
    setCopyNotice("شماره پیگیری کپی شد.");
  }

  function selectPayment(payment: Payment) {
    if (payment.id !== selectedPaymentId && !requestDiscardChanges()) {
      return;
    }

    setSelectedPaymentId(payment.id);
    setNotice(null);
    setError(null);
    setCopyNotice(null);
  }

  function clearSelection() {
    if (!requestDiscardChanges()) {
      return;
    }

    setSelectedPaymentId(null);
    setFormState(createEmptyPaymentFormState());
    setAllocationFormState(emptyAllocationFormState);
    setNotice(null);
    setError(null);
    setCopyNotice(null);
  }

  const activeCount = payments.filter((payment) => payment.lifecycleStatus === "active").length;
  const reportedCount = payments.filter((payment) => payment.verificationStatus === "reported" && payment.lifecycleStatus === "active").length;
  const confirmedCount = payments.filter((payment) => payment.verificationStatus === "confirmed" && payment.lifecycleStatus === "active").length;
  const allocatedCount = allocations.length;
  const formIsDirty =
    formState.payerPartyId.trim().length > 0 ||
    formState.recipientPartyId.trim().length > 0 ||
    formState.amountText.trim().length > 0 ||
    formState.paymentDate.trim().length > 0 ||
    formState.trackingReference.trim().length > 0 ||
    formState.note.trim().length > 0 ||
    formState.initialInvoiceId.trim().length > 0 ||
    formState.initialInstructionId.trim().length > 0 ||
    formState.initialAllocationAmountText.trim().length > 0;
  const selectedPaymentIsEditable = selectedPayment ? isPaymentEditable(selectedPayment) : false;
  const hasUnsavedChanges = formIsDirty;

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasUnsavedChanges]);

  function requestDiscardChanges(): boolean {
    if (!hasUnsavedChanges) {
      return true;
    }

    return window.confirm("تغییرات ذخیره‌نشده از بین می‌روند. ادامه می‌دهید؟");
  }

  const selectedPayer = parties.find((party) => party.id === formState.payerPartyId);
  const selectedRecipient = parties.find((party) => party.id === formState.recipientPartyId);
  return (
    <section id="payment-management" className="payment-management" aria-labelledby="payment-management-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">مرحله ۵</p>
          <h2 id="payment-management-title">ثبت پرداخت</h2>
        </div>
        <button type="button" className="tertiary-button" onClick={clearSelection}>
          پرداخت جدید
        </button>
      </div>

      <div className="summary-strip" aria-label="خلاصه پرداخت‌ها">
        <span>کل: {payments.length.toLocaleString("fa-IR")}</span>
        <span>فعال: {activeCount.toLocaleString("fa-IR")}</span>
        <span>اعلام‌شده: {reportedCount.toLocaleString("fa-IR")}</span>
        <span>تأییدشده: {confirmedCount.toLocaleString("fa-IR")}</span>
        <span>تخصیص‌ها: {allocatedCount.toLocaleString("fa-IR")}</span>
      </div>

      {(notice || error || copyNotice) && (
        <div className={error ? "notice notice-error" : "notice notice-success"} role="status" aria-live="polite">
          {error ?? notice ?? copyNotice}
        </div>
      )}

      <div className="payment-layout">
        <section className="party-panel" aria-label="فرم پرداخت">
          <form className="party-form" onSubmit={handleSave}>
            <div className="form-grid">
              <label className="field">
                <span>پرداخت‌کننده</span>
                <select
                  required
                  value={formState.payerPartyId}
                  onChange={(event) => setFormState((current) => ({ ...current, payerPartyId: event.target.value }))}
                >
                  <option value="">انتخاب کنید</option>
                  {payerOptions.map((party) => (
                    <option key={party.id} value={party.id}>
                      {formatPartyLabel(party)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>گیرنده</span>
                <select
                  required
                  value={formState.recipientPartyId}
                  onChange={(event) => setFormState((current) => ({ ...current, recipientPartyId: event.target.value }))}
                >
                  <option value="">انتخاب کنید</option>
                  {recipientOptions.map((party) => (
                    <option key={party.id} value={party.id}>
                      {formatPartyLabel(party)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>حساب مقصد</span>
                <select
                  value={formState.destinationAccountId}
                  onChange={(event) => setFormState((current) => ({ ...current, destinationAccountId: event.target.value }))}
                >
                  <option value="">بدون حساب مقصد</option>
                  {paymentDestinationAccountOptions.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.accountLabel}
                    </option>
                  ))}
                </select>
              </label>

              <div className="field">
                <label htmlFor="payment-amount-input">
                  <span>مبلغ پرداخت</span>
                </label>
                <input
                  id="payment-amount-input"
                  required
                  value={formState.amountText}
                  onChange={(event) => setFormState((current) => ({ ...current, amountText: normalizeInvoiceAmountInputText(event.target.value) }))}
                  inputMode="numeric"
                  dir="ltr"
                  placeholder="مثلا ۱۰۰٬۰۰۰٬۰۰۰"
                />
                <p className="field-hint">{paymentDraft ? formatInvoiceAmount(paymentDraft.amount) : "مبلغ را به تومان وارد کنید."}</p>
              </div>
            </div>

            <div className="form-grid">
              <div className="field">
                <label htmlFor="payment-date-input">
                  <span>تاریخ پرداخت</span>
                </label>
                <input
                  id="payment-date-input"
                  required
                  type="date"
                  value={formState.paymentDate}
                  onChange={(event) => setFormState((current) => ({ ...current, paymentDate: event.target.value }))}
                />
                <p className="field-hint">{formState.paymentDate ? formatInvoiceDate(formState.paymentDate) : "بعد از انتخاب تاریخ، پیش‌نمایش اینجا دیده می‌شود."}</p>
              </div>

              <label className="field">
                <span>روش پرداخت</span>
                <select
                  value={formState.paymentMethod}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, paymentMethod: event.target.value as Payment["paymentMethod"] }))
                  }
                >
                  {paymentMethodValues.map((value) => (
                    <option key={value} value={value}>
                      {formatPaymentMethodLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>وضعیت اولیه</span>
                <select
                  value={formState.verificationStatus}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, verificationStatus: event.target.value as Payment["verificationStatus"] }))
                  }
                  disabled={Boolean(selectedPayment)}
                >
                  {paymentVerificationStatusValues.map((value) => (
                    <option key={value} value={value}>
                      {formatPaymentVerificationStatusLabel(value)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>روش تأیید اولیه</span>
                <select
                  value={formState.verificationMethod}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, verificationMethod: event.target.value as PaymentVerification["verificationMethod"] }))
                  }
                  disabled={Boolean(selectedPayment)}
                >
                  {paymentVerificationMethodValues.map((value) => (
                    <option key={value} value={value}>
                      {formatPaymentVerificationMethodLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field">
              <span>شناسه یا توضیح تأییدکننده</span>
              <input
                value={formState.verifierDescriptionOrPartyRef}
                onChange={(event) => setFormState((current) => ({ ...current, verifierDescriptionOrPartyRef: event.target.value }))}
                placeholder="اختیاری برای وضعیت اعلام‌شده"
                disabled={Boolean(selectedPayment)}
              />
            </label>

            <label className="field">
              <span>شماره پیگیری</span>
              <input
                value={formState.trackingReference}
                onChange={(event) => setFormState((current) => ({ ...current, trackingReference: event.target.value }))}
                placeholder="اختیاری"
              />
            </label>

            <label className="field">
              <span>توضیحات</span>
              <textarea
                value={formState.note}
                onChange={(event) => setFormState((current) => ({ ...current, note: event.target.value }))}
                rows={3}
                placeholder="اختیاری"
              />
            </label>

            <fieldset className="field">
              <legend>تخصیص اولیه</legend>
              <div className="form-grid">
                <label className="field">
                  <span>فاکتور مرتبط</span>
                  <select
                    value={formState.initialInvoiceId}
                    onChange={(event) => setFormState((current) => ({ ...current, initialInvoiceId: event.target.value }))}
                    disabled={Boolean(selectedPayment)}
                  >
                    <option value="">بدون تخصیص اولیه</option>
                    {allocationInvoiceOptions.map((invoice) => (
                      <option key={invoice.id} value={invoice.id}>
                        {invoice.referenceNumber ?? invoice.id}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>دستور پرداخت مرتبط</span>
                  <select
                    value={formState.initialInstructionId}
                    onChange={(event) => setFormState((current) => ({ ...current, initialInstructionId: event.target.value }))}
                    disabled={Boolean(selectedPayment)}
                  >
                    <option value="">بدون دستور</option>
                    {allocationInstructionOptions.map((instruction) => (
                      <option key={instruction.id} value={instruction.id}>
                        {instruction.id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="field">
                <label htmlFor="initial-allocation-amount-input">
                  <span>مبلغ تخصیص اولیه</span>
                </label>
                <input
                  id="initial-allocation-amount-input"
                  value={formState.initialAllocationAmountText}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, initialAllocationAmountText: normalizeInvoiceAmountInputText(event.target.value) }))
                  }
                  inputMode="numeric"
                  dir="ltr"
                  placeholder="اختیاری"
                  disabled={Boolean(selectedPayment)}
                />
                <p className="field-hint">
                  {buildAllocationDraftCandidate(formState, instructions)
                    ? formatInvoiceAmount(buildAllocationDraftCandidate(formState, instructions)!.allocatedAmount)
                    : "اگر تخصیص اولیه می‌خواهید، مبلغ را وارد کنید."}
                </p>
              </div>
            </fieldset>

            {paymentDraft && (
              <div className="summary-card" role="note" aria-label="خلاصه پرداخت">
                <strong>پیش‌نمایش</strong>
                <p>{formatPaymentDraftSummary(paymentDraft, selectedPayer?.displayName, selectedRecipient?.displayName, allocationDraftPreview ?? undefined)}</p>
                {draftWarnings.length > 0 && (
                  <div className="warning-card warning-card-strong" role="note" aria-label="هشدار مشابهت پرداخت">
                    <strong>هشدار مشابهت احتمالی</strong>
                    <ul>
                      {draftWarnings.map((warning, index) => (
                        <li key={`${warning.kind}-${warning.paymentDate}-${warning.amount}-${index}`}>{formatPaymentWarning(warning)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="form-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={saving || (selectedPayment ? !selectedPaymentIsEditable : !formIsDirty)}
              >
                {selectedPayment ? "ذخیره تغییرات" : "ثبت پرداخت"}
              </button>
              {selectedPayment && selectedPayment.lifecycleStatus === "active" && (
                <>
                  <button type="button" className="secondary-button" onClick={() => void handleLifecycleChange("cancelled")} disabled={saving}>
                    لغو پرداخت
                  </button>
                  <button type="button" className="secondary-button" onClick={() => void handleLifecycleChange("reversed")} disabled={saving}>
                    برگشت پرداخت
                  </button>
                </>
              )}
            </div>
          </form>
        </section>

        <section className="party-panel" aria-label="فهرست پرداخت‌ها">
          <div className="toolbar">
            <label className="field">
              <span>جست‌وجو</span>
              <input
                value={filter.query}
                onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
                placeholder="پرداخت‌کننده، گیرنده، پیگیری، توضیحات"
              />
            </label>

            <div className="toolbar-grid">
              <label className="field">
                <span>وضعیت</span>
                <select
                  value={filter.lifecycleStatus}
                  onChange={(event) =>
                    setFilter((current) => ({ ...current, lifecycleStatus: event.target.value as PaymentListFilter["lifecycleStatus"] }))
                  }
                >
                  {paymentLifecycleStatusValues.map((value) => (
                    <option key={value} value={value}>
                      {value === "all" ? "همه" : formatPaymentLifecycleLabel(value)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>وضعیت تأیید</span>
                <select
                  value={filter.verificationStatus}
                  onChange={(event) =>
                    setFilter((current) => ({ ...current, verificationStatus: event.target.value as PaymentListFilter["verificationStatus"] }))
                  }
                >
                  {paymentVerificationStatusFilterValues.map((value) => (
                    <option key={value} value={value}>
                      {value === "all" ? "همه" : formatPaymentVerificationStatusLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {paymentWarnings.length > 0 && (
            <div className="warning-card warning-card-strong" role="note" aria-label="شماره‌های پیگیری تکراری">
              <strong>شماره‌های پیگیری تکراری</strong>
              <ul>
                {paymentWarnings.map((warning, index) => (
                  <li key={`${warning.kind}-${warning.trackingReference}-${index}`}>
                    شماره پیگیری «{warning.trackingReference}» در پرداخت‌های {warning.paymentIds.join("، ")} تکرار شده است.
                  </li>
                ))}
              </ul>
            </div>
          )}

          {duplicatePaymentWarnings.length > 0 && (
            <div className="warning-card warning-card-strong" role="note" aria-label="هشدارهای مشابهت پرداخت">
              <strong>مشابهت‌های احتمالی پرداخت</strong>
              <ul>
                {duplicatePaymentWarnings.map((warning, index) => (
                  <li key={`${warning.kind}-${warning.paymentDate}-${warning.amount}-${index}`}>
                    {warning.matchedPaymentSummaries.join("، ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="party-list" aria-live="polite">
            {loading ? (
              <p className="muted-copy">در حال بارگذاری پرداخت‌ها...</p>
            ) : filteredPayments.length === 0 ? (
              <div className="empty-state">
                <strong>پرداختی پیدا نشد.</strong>
                <p>با جست‌وجو یا فیلتر بالاتر، فهرست را محدود کنید یا یک پرداخت جدید ثبت کنید.</p>
              </div>
            ) : (
              filteredPayments.map((payment) => {
                const payerName = parties.find((party) => party.id === payment.payerPartyId)?.displayName ?? payment.payerPartyId;
                const recipientName = parties.find((party) => party.id === payment.recipientPartyId)?.displayName ?? payment.recipientPartyId;
                const accountLabel = destinationAccounts.find((account) => account.id === payment.destinationAccountId)?.accountLabel;
                const paymentAllocationList = allocations.filter((allocation) => allocation.paymentId === payment.id);
                const progress = summarizePaymentAllocationProgress(payment, paymentAllocationList);
                return (
                  <button
                    key={payment.id}
                    type="button"
                    className={payment.id === selectedPaymentId ? "party-row party-row-selected" : "party-row"}
                    onClick={() => selectPayment(payment)}
                  >
                    <div className="party-row-top">
                      <strong>{summarizePaymentForDisplay(payment, payerName, recipientName, accountLabel)}</strong>
                      <span className={payment.lifecycleStatus === "active" ? "status-pill status-active" : "status-pill status-archived"}>
                        {formatPaymentLifecycleLabel(payment.lifecycleStatus)}
                      </span>
                    </div>
                    <div className="party-row-meta">
                      {formatPaymentVerificationStatusLabel(payment.verificationStatus)} · {formatPaymentMethodLabel(payment.paymentMethod)}
                    </div>
                    <div className="party-row-meta">
                      تخصیص: {progress.allocatedAmount.toLocaleString("fa-IR")} از {payment.amount.toLocaleString("fa-IR")} تومان
                    </div>
                    <div className="party-row-meta">{payment.trackingReference ? `پیگیری: ${payment.trackingReference}` : "پیگیری ثبت نشده"}</div>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>

      {selectedPayment && (
        <section className="detail-card" aria-label="جزئیات پرداخت">
          <div className="detail-heading">
            <div>
              <p className="eyebrow">نمایش انتخاب‌شده</p>
              <h3>{selectedPayment.amount.toLocaleString("fa-IR")} تومان</h3>
            </div>
            <button type="button" className="tertiary-button" onClick={clearSelection}>
              بستن
            </button>
          </div>

          <dl className="detail-grid">
            <div>
              <dt>پرداخت‌کننده</dt>
              <dd>{parties.find((party) => party.id === selectedPayment.payerPartyId)?.displayName ?? selectedPayment.payerPartyId}</dd>
            </div>
            <div>
              <dt>گیرنده</dt>
              <dd>{parties.find((party) => party.id === selectedPayment.recipientPartyId)?.displayName ?? selectedPayment.recipientPartyId}</dd>
            </div>
            <div>
              <dt>حساب مقصد</dt>
              <dd>{destinationAccounts.find((account) => account.id === selectedPayment.destinationAccountId)?.accountLabel ?? "ثبت نشده"}</dd>
            </div>
            <div>
              <dt>روش پرداخت</dt>
              <dd>{formatPaymentMethodLabel(selectedPayment.paymentMethod)}</dd>
            </div>
            <div>
              <dt>وضعیت تأیید</dt>
              <dd>{formatPaymentVerificationStatusLabel(selectedPayment.verificationStatus)}</dd>
            </div>
            <div>
              <dt>وضعیت جریان</dt>
              <dd>{formatPaymentLifecycleLabel(selectedPayment.lifecycleStatus)}</dd>
            </div>
            <div>
              <dt>تاریخ پرداخت</dt>
              <dd>{formatInvoiceDate(selectedPayment.paymentDate)}</dd>
            </div>
            <div>
              <dt>شماره پیگیری</dt>
              <dd className="identifier-detail">
                <span>{selectedPayment.trackingReference ?? "ثبت نشده"}</span>
                {selectedPayment.trackingReference && (
                  <div className="identifier-actions">
                    <button type="button" className="secondary-button" onClick={() => void handleCopyTrackingReference()}>
                      کپی
                    </button>
                  </div>
                )}
              </dd>
            </div>
          </dl>

          {selectedPayment.note && <p className="detail-copy">{selectedPayment.note}</p>}

          <section className="summary-card" aria-label="وضعیت تخصیص">
            <strong>تخصیص پرداخت</strong>
            {selectedPaymentProgress && (
              <p>
                تخصیص‌شده: {selectedPaymentProgress.allocatedAmount.toLocaleString("fa-IR")} تومان · باقی‌مانده:{" "}
                {selectedPaymentProgress.remainingAmount.toLocaleString("fa-IR")} تومان
              </p>
            )}
            {selectedPaymentAllocationWarnings.length > 0 && (
              <div className="warning-card warning-card-strong" role="note">
                <strong>هشدارهای تخصیص</strong>
                <ul>
                  {selectedPaymentAllocationWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section aria-label="تخصیص‌ها">
            <div className="section-heading">
              <div>
                <h4>تخصیص‌های پرداخت</h4>
              </div>
            </div>

            <div className="party-list">
              {selectedPaymentAllocations.length === 0 ? (
                <p className="muted-copy">برای این پرداخت تخصیصی ثبت نشده است.</p>
              ) : (
                selectedPaymentAllocations.map((allocation) => {
                  const invoice = invoices.find((entry) => entry.id === allocation.invoiceId);
                  const instruction = allocation.paymentInstructionId
                    ? instructions.find((entry) => entry.id === allocation.paymentInstructionId)
                    : undefined;
                  return (
                    <div key={allocation.id} className="party-row">
                      <strong>{invoice?.referenceNumber ?? allocation.invoiceId}</strong>
                      <div className="party-row-meta">
                        {summarizePaymentAllocationForDisplay(allocation, invoice?.referenceNumber, instruction?.id)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section aria-label="فرم تخصیص پرداخت" className="summary-card">
            <h4>تخصیص جدید</h4>
            <form
              className="party-form"
              aria-label="فرم تخصیص پرداخت"
              onSubmit={(event) => void handleAllocationSave(event)}
              aria-disabled={!isPaymentAllocatable(selectedPayment)}
            >
              <div className="form-grid">
                <label className="field">
                  <span>فاکتور</span>
                  <select
                    value={allocationFormState.invoiceId}
                    onChange={(event) => setAllocationFormState((current) => ({ ...current, invoiceId: event.target.value }))}
                    disabled={!isPaymentAllocatable(selectedPayment)}
                  >
                    <option value="">انتخاب کنید</option>
                    {allocationInvoiceOptions.map((invoice) => (
                      <option key={invoice.id} value={invoice.id}>
                        {invoice.referenceNumber ?? invoice.id}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>دستور پرداخت</span>
                  <select
                    value={allocationFormState.paymentInstructionId}
                    onChange={(event) => setAllocationFormState((current) => ({ ...current, paymentInstructionId: event.target.value }))}
                    disabled={!isPaymentAllocatable(selectedPayment)}
                  >
                    <option value="">بدون دستور</option>
                    {allocationInstructionOptions.map((instruction) => (
                      <option key={instruction.id} value={instruction.id}>
                        {instruction.id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="field">
                <span>مبلغ تخصیص</span>
                <input
                  value={allocationFormState.allocatedAmountText}
                  onChange={(event) => setAllocationFormState((current) => ({ ...current, allocatedAmountText: event.target.value }))}
                  inputMode="numeric"
                  placeholder="مثلا ۵۰٬۰۰۰٬۰۰۰"
                  disabled={!isPaymentAllocatable(selectedPayment)}
                />
              </label>

              <button type="submit" className="primary-button" disabled={!isPaymentAllocatable(selectedPayment) || saving}>
                ثبت تخصیص
              </button>
            </form>
          </section>

          <section aria-label="فرم تأیید پرداخت" className="summary-card">
            <h4>ثبت وضعیت تأیید</h4>
            <form
              className="party-form"
              aria-label="فرم تأیید پرداخت"
              onSubmit={(event) => void handleVerify(event)}
              aria-disabled={!isPaymentVerifiable(selectedPayment)}
            >
              <div className="form-grid">
                <label className="field">
                  <span>وضعیت</span>
                  <select
                    value={formState.verificationStatus}
                    onChange={(event) =>
                      setFormState((current) => ({ ...current, verificationStatus: event.target.value as Payment["verificationStatus"] }))
                    }
                    disabled={!isPaymentVerifiable(selectedPayment)}
                  >
                    {paymentVerificationStatusValues.map((value) => (
                      <option key={value} value={value}>
                        {formatPaymentVerificationStatusLabel(value)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>روش تأیید</span>
                  <select
                    value={formState.verificationMethod}
                    onChange={(event) =>
                      setFormState((current) => ({ ...current, verificationMethod: event.target.value as PaymentVerification["verificationMethod"] }))
                    }
                    disabled={!isPaymentVerifiable(selectedPayment)}
                  >
                    {paymentVerificationMethodValues.map((value) => (
                      <option key={value} value={value}>
                        {formatPaymentVerificationMethodLabel(value)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="field">
                <span>توضیح تأییدکننده</span>
                <input
                  value={formState.verifierDescriptionOrPartyRef}
                  onChange={(event) => setFormState((current) => ({ ...current, verifierDescriptionOrPartyRef: event.target.value }))}
                  placeholder="اختیاری"
                  disabled={!isPaymentVerifiable(selectedPayment)}
                />
              </label>

              <label className="field">
                <span>توضیحات</span>
                <textarea
                  value={formState.note}
                  onChange={(event) => setFormState((current) => ({ ...current, note: event.target.value }))}
                  rows={2}
                  disabled={!isPaymentVerifiable(selectedPayment)}
                />
              </label>

              <button type="submit" className="secondary-button" disabled={!isPaymentVerifiable(selectedPayment) || saving}>
                ثبت تأیید
              </button>
            </form>
          </section>

          <section aria-label="تاریخچه تأیید">
            <div className="section-heading">
              <div>
                <h4>تاریخچه تأیید</h4>
              </div>
            </div>
            <div className="party-list">
              {selectedPaymentVerifications.length === 0 ? (
                <p className="muted-copy">هنوز هیچ ثبت تأییدی انجام نشده است.</p>
              ) : (
                selectedPaymentVerifications.map((verification) => (
                  <div key={verification.id} className="party-row">
                    <strong>{summarizePaymentVerificationForDisplay(verification)}</strong>
                    <div className="party-row-meta">{verification.verifierDescriptionOrPartyRef}</div>
                    <div className="party-row-meta">{verification.verifiedAt}</div>
                  </div>
                ))
              )}
            </div>
          </section>
        </section>
      )}
    </section>
  );
}
