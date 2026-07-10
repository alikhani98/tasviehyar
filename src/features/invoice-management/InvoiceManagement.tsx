import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Party, Invoice } from "../../domain";
import {
  filterInvoices,
  findProbableInvoiceDraftWarnings,
  formatInvoiceAmount,
  formatInvoiceDate,
  invoiceDraftSchema,
  invoiceStatusFilterValues,
  parseInvoiceDraftFromInvoice,
  type InvoiceDraft,
  type InvoiceListFilter,
  type InvoiceStatusFilter
} from "../../domain/invoices";
import { db } from "../../db/tasviehyar-db";
import { createDestinationAccountRepository, type DestinationAccountRepository } from "../../services/destination-account-repository";
import { createInvoiceRepository, type InvoiceRepository } from "../../services/invoice-repository";
import { createPartyRepository, type PartyRepository } from "../../services/party-repository";
import { createPaymentInstructionRepository, type PaymentInstructionRepository } from "../../services/payment-instruction-repository";
import { PaymentInstructionManagement } from "./PaymentInstructionManagement";

export interface InvoiceManagementProps {
  repository?: InvoiceRepository;
  partyRepository?: PartyRepository;
  destinationAccountRepository?: DestinationAccountRepository;
  paymentInstructionRepository?: PaymentInstructionRepository;
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
  onRequestPartyManagement
}: InvoiceManagementProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
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
      const [partyRecords, invoiceRecords] = await Promise.all([partyRepository.listParties(), repository.listInvoices()]);
      if (!isMountedRef.current) {
        return;
      }

      setParties(partyRecords);
      setInvoices(invoiceRecords);
      if (typeof nextSelectionId !== "undefined") {
        setSelectedInvoiceId(nextSelectionId);
      }
      setLoading(false);
    },
    [partyRepository, repository]
  );

  useEffect(() => {
    setLoading(true);
    void loadData();
  }, [loadData]);

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
  const draftCandidate = useMemo(() => buildDraftCandidate(formState), [formState]);
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
              <label className="field">
                <span>تاریخ فاکتور</span>
                <input
                  type="date"
                  required
                  value={formState.invoiceDate}
                  disabled={!selectedInvoiceIsEditable}
                  onChange={(event) => setFormState((current) => ({ ...current, invoiceDate: event.target.value }))}
                />
              </label>

              <label className="field">
                <span>مبلغ کل فاکتور</span>
                <input
                  required
                  value={formState.totalAmountText}
                  disabled={!selectedInvoiceIsEditable}
                  onChange={(event) => setFormState((current) => ({ ...current, totalAmountText: event.target.value }))}
                  inputMode="numeric"
                  placeholder="مثلا: 125000000"
                />
              </label>
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

          <div className="detail-grid">
            <div>
              <dt>ایجاد شده</dt>
              <dd>{selectedInvoice.createdAt}</dd>
            </div>
            <div>
              <dt>آخرین تغییر</dt>
              <dd>{selectedInvoice.updatedAt}</dd>
            </div>
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
