import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Payment, PaymentAllocation, PaymentInstruction, Party, Invoice } from "../../domain";
import {
  filterInvoices,
  findProbableInvoiceDraftWarnings,
  formatInvoiceAmount,
  formatInvoiceDate,
  formatInvoiceTimestamp,
  normalizeInvoiceAmountInputText,
  invoiceDraftSchema,
  invoiceStatusFilterValues,
  parseInvoiceDraftFromInvoice,
  type InvoiceDraft,
  type InvoiceListFilter,
  type InvoiceStatusFilter
} from "../../domain/invoices";
import { summarizeInvoiceBalance, summarizeInstructionBalance } from "../../domain/settlement";
import {
  formatPaymentLifecycleLabel,
  formatPaymentMethodLabel,
  formatPaymentVerificationStatusLabel
} from "../../domain/payments";
import { db } from "../../db/tasviehyar-db";
import { createDestinationAccountRepository, type DestinationAccountRepository } from "../../services/destination-account-repository";
import { createInvoiceRepository, type InvoiceRepository } from "../../services/invoice-repository";
import { createPartyRepository, type PartyRepository } from "../../services/party-repository";
import { createPaymentInstructionRepository, type PaymentInstructionRepository } from "../../services/payment-instruction-repository";
import { createPaymentRepository, type PaymentRepository } from "../../services/payment-repository";
import { PaymentInstructionManagement } from "./PaymentInstructionManagement";

export interface InvoiceManagementProps {
  repository?: InvoiceRepository;
  partyRepository?: PartyRepository;
  destinationAccountRepository?: DestinationAccountRepository;
  paymentInstructionRepository?: PaymentInstructionRepository;
  paymentRepository?: PaymentRepository;
  onRequestPartyManagement?: () => void;
}

type InvoiceFormState = {
  customerPartyId: string;
  invoiceDate: string;
  totalAmountText: string;
  referenceNumber: string;
  note: string;
};

const emptyFormState: InvoiceFormState = {
  customerPartyId: "",
  invoiceDate: "",
  totalAmountText: "",
  referenceNumber: "",
  note: ""
};

const defaultFilter: InvoiceListFilter = {
  query: "",
  status: "active"
};

const defaultInvoiceRepository = createInvoiceRepository(db);
const defaultPartyRepository = createPartyRepository(db);
const defaultDestinationAccountRepository = createDestinationAccountRepository(db);
const defaultPaymentInstructionRepository = createPaymentInstructionRepository(db);
const defaultPaymentRepository = createPaymentRepository(db);

function formStateFromInvoice(invoice: Invoice): InvoiceFormState {
  const draft = parseInvoiceDraftFromInvoice(invoice);
  return {
    customerPartyId: draft.customerPartyId,
    invoiceDate: draft.invoiceDate,
    totalAmountText: String(draft.totalAmount),
    referenceNumber: draft.referenceNumber ?? "",
    note: draft.note ?? ""
  };
}

function toDraft(form: InvoiceFormState): InvoiceDraft {
  return invoiceDraftSchema.parse({
    customerPartyId: form.customerPartyId,
    invoiceDate: form.invoiceDate,
    totalAmountText: form.totalAmountText,
    referenceNumber: form.referenceNumber,
    note: form.note
  });
}

function buildDraftCandidate(form: InvoiceFormState): InvoiceDraft | null {
  try {
    return toDraft(form);
  } catch {
    return null;
  }
}

function isSameForm(left: InvoiceFormState, right: InvoiceFormState): boolean {
  return (
    left.customerPartyId === right.customerPartyId &&
    left.invoiceDate === right.invoiceDate &&
    left.totalAmountText === right.totalAmountText &&
    left.referenceNumber === right.referenceNumber &&
    left.note === right.note
  );
}

function formatCustomerOption(party: Party): string {
  return party.active ? party.displayName : `${party.displayName} (بایگانی)`;
}

function formatInvoiceStatus(status: Invoice["lifecycleStatus"]): string {
  return status === "cancelled" ? "لغوشده" : "فعال";
}

function getActiveCustomerParties(parties: readonly Party[]): Party[] {
  return parties
    .filter((party) => party.active && party.roles.includes("customer"))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "fa"));
}

export function InvoiceManagement({
  repository = defaultInvoiceRepository,
  partyRepository = defaultPartyRepository,
  destinationAccountRepository = defaultDestinationAccountRepository,
  paymentInstructionRepository = defaultPaymentInstructionRepository,
  paymentRepository = defaultPaymentRepository,
  onRequestPartyManagement
}: InvoiceManagementProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentAllocations, setPaymentAllocations] = useState<PaymentAllocation[]>([]);
  const [instructions, setInstructions] = useState<PaymentInstruction[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [formState, setFormState] = useState<InvoiceFormState>(emptyFormState);
  const [filter, setFilter] = useState<InvoiceListFilter>(defaultFilter);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const savingRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadData = useCallback(
    async (nextSelectionId?: string | null) => {
      const [partyRecords, invoiceRecords, paymentRecords, allocationRecords, instructionRecords] = await Promise.all([
        partyRepository.listParties(),
        repository.listInvoices(),
        paymentRepository.listPayments(),
        paymentRepository.listAllocations(),
        paymentInstructionRepository.listInstructions()
      ]);
      if (!isMountedRef.current) {
        return;
      }

      setParties(partyRecords);
      setInvoices(invoiceRecords);
      setPayments(paymentRecords);
      setPaymentAllocations(allocationRecords);
      setInstructions(instructionRecords);
      if (typeof nextSelectionId !== "undefined") {
        setSelectedInvoiceId(nextSelectionId);
      }
      setLoading(false);
    },
    [partyRepository, paymentInstructionRepository, paymentRepository, repository]
  );

  useEffect(() => {
    setLoading(true);
    void loadData();
  }, [loadData]);

  useEffect(() => {
    function handleOpenRecord(event: Event) {
      const detail = (event as CustomEvent<{ section?: string; recordId?: string }>).detail;
      if (detail?.section === "invoices" && detail.recordId) {
        setSelectedInvoiceId(detail.recordId);
        document.getElementById("invoice-management")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }
    }

    window.addEventListener("tasviehyar-open-record", handleOpenRecord as EventListener);
    return () => window.removeEventListener("tasviehyar-open-record", handleOpenRecord as EventListener);
  }, []);

  useEffect(() => {
    function handleDataChange() {
      setLoading(true);
      void loadData(selectedInvoiceId);
    }

    window.addEventListener("tasviehyar-data-updated", handleDataChange as EventListener);
    return () => window.removeEventListener("tasviehyar-data-updated", handleDataChange as EventListener);
  }, [loadData, selectedInvoiceId]);

  const selectedInvoice = useMemo(() => invoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null, [invoices, selectedInvoiceId]);
  const selectedInvoiceCustomer = useMemo(
    () => parties.find((party) => party.id === selectedInvoice?.customerPartyId) ?? null,
    [parties, selectedInvoice?.customerPartyId]
  );
  const draftCustomer = useMemo(
    () => parties.find((party) => party.id === formState.customerPartyId) ?? null,
    [formState.customerPartyId, parties]
  );
  const selectedFormState = useMemo(() => (selectedInvoice ? formStateFromInvoice(selectedInvoice) : emptyFormState), [selectedInvoice]);

  useEffect(() => {
    if (selectedInvoice) {
      setFormState(selectedFormState);
      return;
    }

    setFormState(emptyFormState);
  }, [selectedFormState, selectedInvoice]);

  const activeCustomers = useMemo(() => getActiveCustomerParties(parties), [parties]);
  const customerOptions = useMemo(() => {
    const options = [...activeCustomers];
    if (selectedInvoiceCustomer && !options.some((party) => party.id === selectedInvoiceCustomer.id)) {
      options.push(selectedInvoiceCustomer);
    }

    return options.sort((left, right) => left.displayName.localeCompare(right.displayName, "fa"));
  }, [activeCustomers, selectedInvoiceCustomer]);

  const visibleInvoices = useMemo(() => filterInvoices(invoices, parties, filter), [filter, invoices, parties]);
  const selectedInvoicePaymentAllocations = useMemo(
    () => paymentAllocations.filter((allocation) => allocation.invoiceId === selectedInvoice?.id),
    [paymentAllocations, selectedInvoice?.id]
  );
  const selectedInvoicePayments = useMemo(
    () => {
      const paymentIds = new Set(selectedInvoicePaymentAllocations.map((allocation) => allocation.paymentId));
      return payments.filter((payment) => paymentIds.has(payment.id));
    },
    [payments, selectedInvoicePaymentAllocations]
  );
  const draftCandidate = useMemo(() => buildDraftCandidate(formState), [formState]);
  const selectedInvoiceInstructions = useMemo(
    () => instructions.filter((instruction) => instruction.invoiceId === selectedInvoice?.id && instruction.lifecycleStatus === "active"),
    [instructions, selectedInvoice?.id]
  );
  const selectedInvoiceSummary = useMemo(
    () =>
      selectedInvoice
        ? summarizeInvoiceBalance(
            selectedInvoice,
            selectedInvoiceInstructions,
            payments,
            paymentAllocations.filter((allocation) => allocation.invoiceId === selectedInvoice.id)
          )
        : null,
    [paymentAllocations, payments, selectedInvoice, selectedInvoiceInstructions]
  );
  const selectedInstructionSummaries = useMemo(
    () => selectedInvoiceInstructions.map((instruction) => summarizeInstructionBalance(instruction, payments, paymentAllocations)),
    [paymentAllocations, payments, selectedInvoiceInstructions]
  );
  const duplicateWarnings = useMemo(
    () => (draftCandidate ? findProbableInvoiceDraftWarnings(invoices, parties, draftCandidate, selectedInvoice?.id) : []),
    [draftCandidate, invoices, parties, selectedInvoice?.id]
  );

  const activeCount = invoices.filter((invoice) => invoice.lifecycleStatus === "active").length;
  const cancelledCount = invoices.length - activeCount;
  const selectedInvoiceIsEditable = !selectedInvoice || selectedInvoice.lifecycleStatus === "active";
  const formIsDirty = selectedInvoice ? !isSameForm(formState, selectedFormState) : JSON.stringify(formState) !== JSON.stringify(emptyFormState);
  const canSave = selectedInvoiceIsEditable && !saving && (selectedInvoice ? formIsDirty : Boolean(formState.customerPartyId && formState.invoiceDate && formState.totalAmountText));
  const hasCustomerOptions = activeCustomers.length > 0;

  useEffect(() => {
    if (!formIsDirty) {
      return;
    }

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [formIsDirty]);

  function requestDiscardChanges(): boolean {
    if (!formIsDirty) {
      return true;
    }

    return window.confirm("تغییرات ذخیره‌نشده از بین می‌روند. ادامه می‌دهید؟");
  }

  function startNewInvoice() {
    if (!requestDiscardChanges()) {
      return;
    }

    setSelectedInvoiceId(null);
    setFormState(emptyFormState);
    setNotice(null);
    setError(null);
  }

  function selectInvoice(invoice: Invoice) {
    if (invoice.id !== selectedInvoiceId && !requestDiscardChanges()) {
      return;
    }

    setSelectedInvoiceId(invoice.id);
    setNotice(null);
    setError(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || !selectedInvoiceIsEditable) {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const parsedDraft = toDraft(formState);
      const savedInvoice = selectedInvoice
        ? await repository.updateInvoice(selectedInvoice.id, parsedDraft)
        : await repository.createInvoice(parsedDraft);

      await loadData(savedInvoice.id);
      window.dispatchEvent(new Event("tasviehyar-data-updated"));
      setNotice(selectedInvoice ? "فاکتور با موفقیت به‌روزرسانی شد." : "فاکتور جدید با موفقیت ثبت شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ذخیره‌سازی ناموفق بود.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleCancelInvoice() {
    if (!selectedInvoice || selectedInvoice.lifecycleStatus === "cancelled") {
      return;
    }

    if (!window.confirm("آیا از لغو این فاکتور مطمئن هستید؟")) {
      return;
    }

    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const updatedInvoice = await repository.cancelInvoice(selectedInvoice.id);
      await loadData(updatedInvoice.id);
      window.dispatchEvent(new Event("tasviehyar-data-updated"));
      setNotice("فاکتور لغو شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "عملیات ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  function openPartyManagement() {
    if (onRequestPartyManagement) {
      onRequestPartyManagement();
      return;
    }

    document.getElementById("party-management")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  const summaryCustomerName = draftCustomer?.displayName ?? "انتخاب نشده";
  const summaryDate = formState.invoiceDate ? formatInvoiceDate(formState.invoiceDate) : "انتخاب نشده";
  const summaryAmount = draftCandidate ? formatInvoiceAmount(draftCandidate.totalAmount) : formState.totalAmountText || "وارد نشده";
  const summaryReference = formState.referenceNumber || "ثبت نشده";

  return (
    <section id="invoice-management" className="invoice-management" aria-labelledby="invoice-management-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">مرحله ۴</p>
          <h2 id="invoice-management-title">ثبت فاکتور</h2>
        </div>
        <button type="button" className="tertiary-button" onClick={startNewInvoice}>
          فاکتور جدید
        </button>
      </div>

      <div className="summary-strip" aria-label="خلاصه فاکتورها">
        <span>کل: {invoices.length.toLocaleString("fa-IR")}</span>
        <span>فعال: {activeCount.toLocaleString("fa-IR")}</span>
        <span>لغوشده: {cancelledCount.toLocaleString("fa-IR")}</span>
      </div>

      {!hasCustomerOptions && (
        <div className="notice notice-warning" role="note">
          هنوز مشتری فعال وجود ندارد. برای ثبت فاکتور جدید ابتدا در «حساب اشخاص» یک طرف فعال با نقش مشتری بسازید یا فعال کنید.
          <div className="form-actions" style={{ marginTop: "0.75rem" }}>
            <button type="button" className="secondary-button" onClick={openPartyManagement}>
              رفتن به حساب اشخاص
            </button>
          </div>
        </div>
      )}

      {(notice || error) && (
        <div className={error ? "notice notice-error" : "notice notice-success"} role="status" aria-live="polite">
          {error ?? notice}
        </div>
      )}

      <div className="invoice-layout">
        <section className="party-panel" aria-label="فرم فاکتور">
          <form className="party-form" onSubmit={handleSave}>
            <label className="field">
              <span>مشتری</span>
              <select
                required
                value={formState.customerPartyId}
                disabled={!selectedInvoiceIsEditable || (!hasCustomerOptions && !selectedInvoice)}
                onChange={(event) => setFormState((current) => ({ ...current, customerPartyId: event.target.value }))}
              >
                <option value="">مشتری را انتخاب کنید</option>
                {customerOptions.map((party) => (
                  <option key={party.id} value={party.id} disabled={!party.active && party.id !== selectedInvoice?.customerPartyId}>
                    {formatCustomerOption(party)}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-grid">
              <div className="field">
                <label htmlFor="invoice-date-input">
                  <span>تاریخ فاکتور</span>
                </label>
                <input
                  id="invoice-date-input"
                  type="date"
                  required
                  value={formState.invoiceDate}
                  disabled={!selectedInvoiceIsEditable}
                  onChange={(event) => setFormState((current) => ({ ...current, invoiceDate: event.target.value }))}
                />
                <p className="field-hint">{formState.invoiceDate ? formatInvoiceDate(formState.invoiceDate) : "بعد از انتخاب تاریخ، پیش‌نمایش اینجا دیده می‌شود."}</p>
              </div>

              <div className="field">
                <label htmlFor="invoice-amount-input">
                  <span>مبلغ کل فاکتور</span>
                </label>
                <input
                  id="invoice-amount-input"
                  required
                  value={formState.totalAmountText}
                  disabled={!selectedInvoiceIsEditable}
                  onChange={(event) => setFormState((current) => ({ ...current, totalAmountText: normalizeInvoiceAmountInputText(event.target.value) }))}
                  inputMode="numeric"
                  dir="ltr"
                  placeholder="مثلا: 125000000"
                />
                <p className="field-hint">{draftCandidate ? formatInvoiceAmount(draftCandidate.totalAmount) : "مبلغ را به تومان وارد کنید."}</p>
              </div>
            </div>

            <label className="field">
              <span>شماره یا عنوان فاکتور</span>
              <input
                value={formState.referenceNumber}
                disabled={!selectedInvoiceIsEditable}
                onChange={(event) => setFormState((current) => ({ ...current, referenceNumber: event.target.value }))}
                placeholder="اختیاری"
              />
            </label>

            <label className="field">
              <span>توضیحات</span>
              <textarea
                value={formState.note}
                disabled={!selectedInvoiceIsEditable}
                onChange={(event) => setFormState((current) => ({ ...current, note: event.target.value }))}
                rows={3}
                placeholder="اختیاری"
              />
            </label>

            <div className="summary-card" aria-label="پیش‌نمایش ذخیره">
              <strong>خلاصه قبل از ذخیره</strong>
              <dl className="detail-grid">
                <div>
                  <dt>مشتری</dt>
                  <dd>{summaryCustomerName}</dd>
                </div>
                <div>
                  <dt>تاریخ</dt>
                  <dd>{summaryDate}</dd>
                </div>
                <div>
                  <dt>مبلغ کل</dt>
                  <dd>{summaryAmount}</dd>
                </div>
                <div>
                  <dt>شماره یا عنوان</dt>
                  <dd>{summaryReference}</dd>
                </div>
              </dl>
            </div>

            {duplicateWarnings.length > 0 && (
              <div className="warning-card warning-card-strong" role="note" aria-label="هشدار مشابهت فاکتور">
                <strong>فاکتور مشابه احتمالی</strong>
                <ul>
                  {duplicateWarnings.map((warning, index) => (
                    <li key={`${warning.kind}-${warning.matchedInvoiceIds.join("-")}-${index}`}>
                      {warning.matchedInvoiceSummaries.map((summary) => (
                        <div key={summary}>{summary}</div>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!selectedInvoiceIsEditable && selectedInvoice && (
              <div className="notice notice-warning" role="note">
                این فاکتور لغوشده است و از مسیر معمول قابل ویرایش نیست.
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={!canSave}>
                {selectedInvoice ? "ذخیره تغییرات" : "ثبت فاکتور"}
              </button>
              {selectedInvoice?.lifecycleStatus === "active" ? (
                <button type="button" className="secondary-button" onClick={() => void handleCancelInvoice()} disabled={saving}>
                  لغو فاکتور
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="party-panel" aria-label="فهرست فاکتورها">
          <div className="toolbar">
            <label className="field">
              <span>جست‌وجو</span>
              <input
                value={filter.query}
                onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
                placeholder="نام مشتری، شماره یا عنوان"
              />
            </label>

            <label className="field">
              <span>وضعیت</span>
              <select
                value={filter.status}
                onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value as InvoiceStatusFilter }))}
              >
                {invoiceStatusFilterValues.map((status) => (
                  <option key={status} value={status}>
                    {status === "all" ? "همه" : status === "active" ? "فعال" : "لغوشده"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="party-list" aria-live="polite">
            {loading ? (
              <p className="muted-copy">در حال بارگذاری فاکتورها...</p>
            ) : invoices.length === 0 ? (
              <div className="empty-state">
                <strong>هنوز فاکتوری ثبت نشده است.</strong>
                <p>برای شروع، یک فاکتور جدید بسازید.</p>
              </div>
            ) : visibleInvoices.length === 0 ? (
              <div className="empty-state">
                <strong>فاکتوری پیدا نشد.</strong>
                <p>با جست‌وجو یا فیلتر بالاتر، فهرست را محدود کنید.</p>
              </div>
            ) : (
              visibleInvoices.map((invoice) => {
                const customerName = parties.find((party) => party.id === invoice.customerPartyId)?.displayName ?? "مشتری نامشخص";
                return (
                  <button
                    key={invoice.id}
                    type="button"
                    className={invoice.id === selectedInvoiceId ? "party-row party-row-selected" : "party-row"}
                    onClick={() => selectInvoice(invoice)}
                  >
                    <div className="party-row-top">
                      <strong>{customerName}</strong>
                      <span className={invoice.lifecycleStatus === "active" ? "status-pill status-active" : "status-pill status-archived"}>
                        {formatInvoiceStatus(invoice.lifecycleStatus)}
                      </span>
                    </div>
                    <div className="party-row-meta">{formatInvoiceDate(invoice.invoiceDate)}</div>
                    <div className="party-row-meta">{formatInvoiceAmount(invoice.totalAmount)}</div>
                    <div className="party-row-meta">{invoice.referenceNumber ?? "شماره/عنوان ثبت نشده"}</div>
                    <div className="party-row-meta">نمایش جزئیات</div>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>

      {selectedInvoice && (
        <section className="detail-card" aria-label="جزئیات فاکتور">
          <div className="detail-heading">
            <div>
              <p className="eyebrow">نمایش انتخاب‌شده</p>
              <h3>{selectedInvoiceCustomer?.displayName ?? "مشتری نامشخص"}</h3>
            </div>
            <button type="button" className="tertiary-button" onClick={startNewInvoice}>
              فاکتور جدید
            </button>
          </div>

          <dl className="detail-grid">
            <div>
              <dt>مشتری</dt>
              <dd>{selectedInvoiceCustomer ? formatCustomerOption(selectedInvoiceCustomer) : "نامشخص"}</dd>
            </div>
            <div>
              <dt>تاریخ فاکتور</dt>
              <dd>{formatInvoiceDate(selectedInvoice.invoiceDate)}</dd>
            </div>
            <div>
              <dt>مبلغ کل</dt>
              <dd>{formatInvoiceAmount(selectedInvoice.totalAmount)}</dd>
            </div>
            <div>
              <dt>شماره یا عنوان</dt>
              <dd>{selectedInvoice.referenceNumber ?? "ثبت نشده"}</dd>
            </div>
            <div>
              <dt>وضعیت</dt>
              <dd>{formatInvoiceStatus(selectedInvoice.lifecycleStatus)}</dd>
            </div>
            <div>
              <dt>توضیحات</dt>
              <dd>{selectedInvoice.note ?? "ثبت نشده"}</dd>
            </div>
          </dl>

          {selectedInvoiceSummary && (
            <div className="summary-card" aria-label="خلاصه تسویه فاکتور">
              <strong>خلاصه مالی</strong>
              <dl className="detail-grid">
                <div>
                  <dt>مبلغ کل</dt>
                  <dd>{formatInvoiceAmount(selectedInvoiceSummary.invoiceTotal)}</dd>
                </div>
                <div>
                  <dt>پرداخت تأییدشده</dt>
                  <dd>{formatInvoiceAmount(selectedInvoiceSummary.confirmedAllocatedAmount)}</dd>
                </div>
                <div>
                  <dt>پرداخت اعلام‌شده</dt>
                  <dd>{formatInvoiceAmount(selectedInvoiceSummary.reportedAllocatedAmount)}</dd>
                </div>
                <div>
                  <dt>مانده قطعی</dt>
                  <dd>{formatInvoiceAmount(selectedInvoiceSummary.confirmedOutstandingAmount)}</dd>
                </div>
                <div>
                  <dt>مانده احتمالی</dt>
                  <dd>{formatInvoiceAmount(selectedInvoiceSummary.provisionalOutstandingAmount)}</dd>
                </div>
                <div>
                  <dt>مبلغ دارای دستور</dt>
                  <dd>{formatInvoiceAmount(selectedInvoiceSummary.activeInstructedTotal)}</dd>
                </div>
                <div>
                  <dt>مبلغ بدون مقصد</dt>
                  <dd>{formatInvoiceAmount(selectedInvoiceSummary.unassignedInvoiceAmount)}</dd>
                </div>
                <div>
                  <dt>مبلغ بیش‌پرداخت</dt>
                  <dd>{formatInvoiceAmount(selectedInvoiceSummary.overpaymentAmount)}</dd>
                </div>
              </dl>
              <p className="detail-copy">وضعیت تسویه: {selectedInvoiceSummary.derivedSettlementLabel}</p>
            </div>
          )}

          {selectedInstructionSummaries.length > 0 && (
            <div className="summary-card" aria-label="پیشرفت دستورهای فاکتور">
              <strong>پیشرفت دستور پرداخت</strong>
              <div className="party-list">
                {selectedInstructionSummaries.map((summary) => (
                  <div key={summary.instructionId} className="party-row">
                    <div className="party-row-top">
                      <strong>{summary.instructionId}</strong>
                      <span className="status-pill status-active">{summary.derivedInstructionLabel}</span>
                    </div>
                    <div className="party-row-meta">
                      دریافت قطعی: {formatInvoiceAmount(summary.confirmedReceived)} · اعلام‌شده: {formatInvoiceAmount(summary.reportedButUnconfirmedAmount)}
                    </div>
                    <div className="party-row-meta">
                      مانده قطعی: {formatInvoiceAmount(summary.confirmedRemainingAmount)} · مانده احتمالی: {formatInvoiceAmount(summary.provisionalRemainingAmount)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="detail-grid">
            <div>
              <dt>ایجاد شده</dt>
              <dd>{formatInvoiceTimestamp(selectedInvoice.createdAt)}</dd>
            </div>
            <div>
              <dt>آخرین تغییر</dt>
              <dd>{formatInvoiceTimestamp(selectedInvoice.updatedAt)}</dd>
            </div>
          </div>
        </section>
      )}

      {selectedInvoice && (
        <section className="summary-card" aria-label="تاریخچه پرداخت فاکتور">
          <strong>تاریخچه پرداخت</strong>
          <p className="detail-copy">پرداخت‌های مرتبط با این فاکتور از تخصیص‌های ثبت‌شده به‌دست می‌آیند.</p>
          <div className="party-list">
            {selectedInvoicePayments.length === 0 ? (
              <p className="muted-copy">برای این فاکتور هنوز پرداختی ثبت نشده است.</p>
            ) : (
              selectedInvoicePayments.map((payment) => {
                const payerName = parties.find((party) => party.id === payment.payerPartyId)?.displayName ?? payment.payerPartyId;
                const recipientName = parties.find((party) => party.id === payment.recipientPartyId)?.displayName ?? payment.recipientPartyId;
                const allocatedAmount = selectedInvoicePaymentAllocations
                  .filter((allocation) => allocation.paymentId === payment.id)
                  .reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
                return (
                  <div key={payment.id} className="party-row">
                    <div className="party-row-top">
                      <strong>
                        {payerName} → {recipientName}
                      </strong>
                      <span className={payment.lifecycleStatus === "active" ? "status-pill status-active" : "status-pill status-archived"}>
                        {formatPaymentLifecycleLabel(payment.lifecycleStatus)}
                      </span>
                    </div>
                    <div className="party-row-meta">
                      {formatPaymentVerificationStatusLabel(payment.verificationStatus)} · {formatPaymentMethodLabel(payment.paymentMethod)}
                    </div>
                    <div className="party-row-meta">
                      تخصیص به این فاکتور: {allocatedAmount.toLocaleString("fa-IR")} از {payment.amount.toLocaleString("fa-IR")} تومان
                    </div>
                    <div className="party-row-meta">{payment.trackingReference ?? "پیگیری ثبت نشده"}</div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      {selectedInvoice && (
        <PaymentInstructionManagement
          invoice={selectedInvoice}
          parties={parties}
          repository={paymentInstructionRepository}
          destinationAccountRepository={destinationAccountRepository}
        />
      )}
    </section>
  );
}
