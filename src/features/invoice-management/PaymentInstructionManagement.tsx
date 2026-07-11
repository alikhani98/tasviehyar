import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DestinationAccount, Invoice, Party, PaymentInstruction } from "../../domain";
import {
  filterPaymentInstructions,
  findProbablePaymentInstructionDraftWarnings,
  formatPaymentInstructionAmount,
  formatPaymentInstructionStatus,
  paymentInstructionDraftSchema,
  parsePaymentInstructionDraftFromInstruction,
  summarizePaymentInstructionForDisplay,
  type PaymentInstructionDraft,
  type PaymentInstructionListFilter
} from "../../domain/payment-instructions";
import { formatInvoiceDate, formatInvoiceTimestamp, normalizeInvoiceAmountInputText } from "../../domain/invoices";
import { createDestinationAccountRepository, type DestinationAccountRepository } from "../../services/destination-account-repository";
import { createPaymentInstructionRepository, type PaymentInstructionRepository } from "../../services/payment-instruction-repository";
import { db } from "../../db/tasviehyar-db";

export interface PaymentInstructionManagementProps {
  invoice: Invoice;
  parties: readonly Party[];
  repository?: PaymentInstructionRepository;
  destinationAccountRepository?: DestinationAccountRepository;
}

type PaymentInstructionFormState = {
  recipientPartyId: string;
  destinationAccountId: string;
  instructedAmountText: string;
  note: string;
};

const emptyFormState: PaymentInstructionFormState = {
  recipientPartyId: "",
  destinationAccountId: "",
  instructedAmountText: "",
  note: ""
};

const defaultFilter: PaymentInstructionListFilter = {
  query: "",
  status: "active"
};

const defaultInstructionRepository = createPaymentInstructionRepository(db);
const defaultDestinationAccountRepository = createDestinationAccountRepository(db);

function formStateFromInstruction(instruction: PaymentInstruction): PaymentInstructionFormState {
  const draft = parsePaymentInstructionDraftFromInstruction(instruction);
  return {
    recipientPartyId: draft.recipientPartyId,
    destinationAccountId: draft.destinationAccountId ?? "",
    instructedAmountText: String(draft.instructedAmount),
    note: draft.note ?? ""
  };
}

function toDraft(invoice: Invoice, form: PaymentInstructionFormState): PaymentInstructionDraft {
  return paymentInstructionDraftSchema.parse({
    invoiceId: invoice.id,
    recipientPartyId: form.recipientPartyId,
    destinationAccountId: form.destinationAccountId,
    instructedAmountText: form.instructedAmountText,
    note: form.note
  });
}

function isSameForm(left: PaymentInstructionFormState, right: PaymentInstructionFormState): boolean {
  return (
    left.recipientPartyId === right.recipientPartyId &&
    left.destinationAccountId === right.destinationAccountId &&
    left.instructedAmountText === right.instructedAmountText &&
    left.note === right.note
  );
}

function formatPartyLabel(party: Party): string {
  return party.active ? party.displayName : `${party.displayName} (بایگانی)`;
}

function formatAccountLabel(account: DestinationAccount): string {
  const archiveSuffix = account.active ? "" : " (بایگانی)";
  return `${account.accountLabel}${archiveSuffix}`;
}

function sumInstructionAmounts(instructions: readonly PaymentInstruction[]): number {
  return instructions
    .filter((instruction) => instruction.lifecycleStatus === "active")
    .reduce((sum, instruction) => sum + instruction.instructedAmount, 0);
}

export function PaymentInstructionManagement({
  invoice,
  parties,
  repository = defaultInstructionRepository,
  destinationAccountRepository = defaultDestinationAccountRepository,
}: PaymentInstructionManagementProps) {
  const [instructions, setInstructions] = useState<PaymentInstruction[]>([]);
  const [accounts, setAccounts] = useState<DestinationAccount[]>([]);
  const [selectedInstructionId, setSelectedInstructionId] = useState<string | null>(null);
  const [formState, setFormState] = useState<PaymentInstructionFormState>(emptyFormState);
  const [filter, setFilter] = useState<PaymentInstructionListFilter>(defaultFilter);
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
      const [instructionRecords, accountRecords] = await Promise.all([
        repository.listInstructionsByInvoice(invoice.id),
        destinationAccountRepository.listAccounts()
      ]);

      if (!isMountedRef.current) {
        return;
      }

      setInstructions(instructionRecords);
      setAccounts(accountRecords);
      if (typeof nextSelectionId !== "undefined") {
        setSelectedInstructionId(nextSelectionId);
      }
      setLoading(false);
    },
    [destinationAccountRepository, invoice.id, repository]
  );

  useEffect(() => {
    setLoading(true);
    setSelectedInstructionId(null);
    setFormState(emptyFormState);
    setNotice(null);
    setError(null);
    void loadData();
  }, [loadData]);

  const selectedInstruction = useMemo(
    () => instructions.find((instruction) => instruction.id === selectedInstructionId) ?? null,
    [instructions, selectedInstructionId]
  );
  const selectedFormState = useMemo(
    () => (selectedInstruction ? formStateFromInstruction(selectedInstruction) : emptyFormState),
    [selectedInstruction]
  );

  useEffect(() => {
    if (selectedInstruction) {
      setFormState(selectedFormState);
      return;
    }

    setFormState(emptyFormState);
  }, [selectedFormState, selectedInstruction]);

  const recipientOptions = useMemo(() => {
    const activeRecipients = parties.filter((party) => party.active);
    if (selectedInstruction) {
      const currentRecipient = parties.find((party) => party.id === selectedInstruction.recipientPartyId);
      if (currentRecipient && !activeRecipients.some((party) => party.id === currentRecipient.id)) {
        activeRecipients.push(currentRecipient);
      }
    }

    return activeRecipients.sort((left, right) => left.displayName.localeCompare(right.displayName, "fa"));
  }, [parties, selectedInstruction]);

  const selectedRecipient = useMemo(
    () => parties.find((party) => party.id === formState.recipientPartyId) ?? null,
    [formState.recipientPartyId, parties]
  );
  const availableAccounts = useMemo(() => {
    if (!selectedRecipient) {
      return selectedInstruction?.destinationAccountId
        ? accounts.filter((account) => account.id === selectedInstruction.destinationAccountId)
        : [];
    }

    const options = accounts.filter((account) => account.ownerPartyId === selectedRecipient.id && account.active);
    if (selectedInstruction?.destinationAccountId) {
      const currentAccount = accounts.find((account) => account.id === selectedInstruction.destinationAccountId);
      if (currentAccount && !options.some((account) => account.id === currentAccount.id)) {
        options.push(currentAccount);
      }
    }

    return options.sort((left, right) => left.accountLabel.localeCompare(right.accountLabel, "fa"));
  }, [accounts, selectedInstruction?.destinationAccountId, selectedRecipient]);

  useEffect(() => {
    if (formState.destinationAccountId && !availableAccounts.some((account) => account.id === formState.destinationAccountId)) {
      setFormState((current) => ({ ...current, destinationAccountId: "" }));
    }
  }, [availableAccounts, formState.destinationAccountId]);

  const visibleInstructions = useMemo(
    () => filterPaymentInstructions(instructions, parties, accounts, filter),
    [accounts, filter, instructions, parties]
  );
  const draftCandidate = useMemo(
    () =>
      (() => {
        try {
          return toDraft(invoice, formState);
        } catch {
          return null;
        }
      })(),
    [formState, invoice]
  );
  const duplicateWarnings = useMemo(
    () =>
      draftCandidate
        ? findProbablePaymentInstructionDraftWarnings(instructions, parties, accounts, draftCandidate, selectedInstruction?.id)
        : [],
    [accounts, draftCandidate, instructions, parties, selectedInstruction?.id]
  );

  const activeInstructionTotal = sumInstructionAmounts(instructions);
  const unassignedInvoiceAmount = Math.max(0, invoice.totalAmount - activeInstructionTotal);
  const selectedInstructionIsEditable = !selectedInstruction || selectedInstruction.lifecycleStatus === "active";
  const formIsDirty = selectedInstruction ? !isSameForm(formState, selectedFormState) : JSON.stringify(formState) !== JSON.stringify(emptyFormState);
  const hasUnsavedChanges = formIsDirty;
  const hasRecipientOptions = recipientOptions.length > 0;
  const canSave = selectedInstructionIsEditable && !saving && Boolean(formState.recipientPartyId && formState.instructedAmountText && invoice.lifecycleStatus !== "cancelled");

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === formState.destinationAccountId) ?? null,
    [accounts, formState.destinationAccountId]
  );
  const selectedRecipientParty = useMemo(
    () => parties.find((party) => party.id === formState.recipientPartyId) ?? null,
    [formState.recipientPartyId, parties]
  );

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

  async function refresh(nextSelectionId?: string | null) {
    await loadData(nextSelectionId);
  }

  function requestDiscardChanges(): boolean {
    if (!formIsDirty) {
      return true;
    }

    return window.confirm("تغییرات ذخیره‌نشده از بین می‌روند. ادامه می‌دهید؟");
  }

  function startNewInstruction() {
    if (!requestDiscardChanges()) {
      return;
    }

    setSelectedInstructionId(null);
    setFormState(emptyFormState);
    setNotice(null);
    setError(null);
  }

  function selectInstruction(instruction: PaymentInstruction) {
    if (instruction.id !== selectedInstructionId && !requestDiscardChanges()) {
      return;
    }

    setSelectedInstructionId(instruction.id);
    setNotice(null);
    setError(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || !selectedInstructionIsEditable || invoice.lifecycleStatus === "cancelled") {
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const parsedDraft = toDraft(invoice, formState);
      const savedInstruction = selectedInstruction
        ? await repository.updateInstruction(selectedInstruction.id, parsedDraft)
        : await repository.createInstruction(parsedDraft);

      await refresh(savedInstruction.id);
      window.dispatchEvent(new Event("tasviehyar-data-updated"));
      setNotice(selectedInstruction ? "دستور پرداخت با موفقیت به‌روزرسانی شد." : "دستور پرداخت جدید با موفقیت ثبت شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ذخیره‌سازی ناموفق بود.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleCancelOrRestore(nextActive: boolean) {
    if (!selectedInstruction) {
      return;
    }

    const confirmed = window.confirm(nextActive ? "آیا این دستور پرداخت را بازیابی می‌کنید؟" : "آیا این دستور پرداخت را لغو می‌کنید؟");
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const updatedInstruction = nextActive
        ? await repository.restoreInstruction(selectedInstruction.id)
        : await repository.cancelInstruction(selectedInstruction.id);
      await refresh(updatedInstruction.id);
      window.dispatchEvent(new Event("tasviehyar-data-updated"));
      setNotice(nextActive ? "دستور پرداخت بازیابی شد." : "دستور پرداخت لغو شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "عملیات ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  const summaryRecipientName = selectedRecipientParty?.displayName ?? "انتخاب نشده";
  const summaryAccountName = selectedAccount ? selectedAccount.accountLabel : "حساب هنوز تعیین نشده";
  const summaryAmount = draftCandidate ? formatPaymentInstructionAmount(draftCandidate.instructedAmount) : formState.instructedAmountText || "وارد نشده";

  return (
    <section className="instruction-section" aria-labelledby="instruction-management-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">دستورهای پرداخت</p>
          <h3 id="instruction-management-title">دستور پرداخت</h3>
        </div>
        <button type="button" className="tertiary-button" onClick={startNewInstruction}>
          دستور جدید
        </button>
      </div>

      <div className="summary-strip" aria-label="خلاصه دستورهای پرداخت">
        <span>مبلغ کل فاکتور: {invoice.totalAmount.toLocaleString("fa-IR")}</span>
        <span>مبلغ دارای دستور: {activeInstructionTotal.toLocaleString("fa-IR")}</span>
        <span>مبلغ بدون مقصد: {unassignedInvoiceAmount.toLocaleString("fa-IR")}</span>
      </div>

      {invoice.lifecycleStatus === "cancelled" && (
        <div className="notice notice-warning" role="note">
          این فاکتور لغوشده است و دستورهای پرداخت آن فقط خواندنی هستند.
        </div>
      )}

      {(notice || error) && (
        <div className={error ? "notice notice-error" : "notice notice-success"} role="status" aria-live="polite">
          {error ?? notice}
        </div>
      )}

      <div className="invoice-layout">
        <section className="party-panel" aria-label="فرم دستور پرداخت">
          <form className="party-form" onSubmit={handleSave}>
            <label className="field">
              <span>گیرنده</span>
              <select
                required
                value={formState.recipientPartyId}
                disabled={!selectedInstructionIsEditable || invoice.lifecycleStatus === "cancelled" || (!hasRecipientOptions && !selectedInstruction)}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    recipientPartyId: event.target.value,
                    destinationAccountId: ""
                  }))
                }
              >
                <option value="">گیرنده را انتخاب کنید</option>
                {recipientOptions.map((party) => (
                  <option key={party.id} value={party.id}>
                    {formatPartyLabel(party)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>حساب مقصد</span>
              <select
                value={formState.destinationAccountId}
                disabled={!selectedInstructionIsEditable || invoice.lifecycleStatus === "cancelled" || !selectedRecipientParty}
                onChange={(event) => setFormState((current) => ({ ...current, destinationAccountId: event.target.value }))}
              >
                <option value="">حساب هنوز تعیین نشده</option>
                {availableAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {formatAccountLabel(account)}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-grid">
              <div className="field">
                <label htmlFor="instruction-amount-input">
                  <span>مبلغ دستور پرداخت</span>
                </label>
                <input
                  id="instruction-amount-input"
                  required
                  value={formState.instructedAmountText}
                  disabled={!selectedInstructionIsEditable || invoice.lifecycleStatus === "cancelled"}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, instructedAmountText: normalizeInvoiceAmountInputText(event.target.value) }))
                  }
                  inputMode="numeric"
                  dir="ltr"
                  placeholder="مثلا: 200000000"
                />
                <p className="field-hint">{draftCandidate ? formatPaymentInstructionAmount(draftCandidate.instructedAmount) : "مبلغ را به تومان وارد کنید."}</p>
              </div>

              <div className="field">
                <label htmlFor="instruction-note-input">
                  <span>توضیحات</span>
                </label>
                <input
                  id="instruction-note-input"
                  value={formState.note}
                  disabled={!selectedInstructionIsEditable || invoice.lifecycleStatus === "cancelled"}
                  onChange={(event) => setFormState((current) => ({ ...current, note: event.target.value }))}
                  placeholder="اختیاری"
                />
              </div>
            </div>

            <div className="summary-card" aria-label="پیش‌نمایش دستور">
              <strong>خلاصه قبل از ذخیره</strong>
              <dl className="detail-grid">
                <div>
                  <dt>گیرنده</dt>
                  <dd>{summaryRecipientName}</dd>
                </div>
                <div>
                  <dt>حساب مقصد</dt>
                  <dd>{summaryAccountName}</dd>
                </div>
                <div>
                  <dt>مبلغ دستور پرداخت</dt>
                  <dd>{summaryAmount}</dd>
                </div>
                <div>
                  <dt>توضیحات</dt>
                  <dd>{formState.note || "ثبت نشده"}</dd>
                </div>
              </dl>
            </div>

            {duplicateWarnings.length > 0 && (
              <div className="warning-card warning-card-strong" role="note" aria-label="هشدار مشابهت دستور پرداخت">
                <strong>دستور مشابه احتمالی</strong>
                <ul>
                  {duplicateWarnings.map((warning, index) => (
                    <li key={`${warning.kind}-${warning.matchedInstructionIds.join("-")}-${index}`}>
                      {warning.matchedInstructionSummaries.map((summary) => (
                        <div key={summary}>{summary}</div>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!selectedInstructionIsEditable && selectedInstruction && (
              <div className="notice notice-warning" role="note">
                این دستور لغوشده است و از مسیر معمول قابل ویرایش نیست.
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={!canSave}>
                {selectedInstruction ? "ذخیره تغییرات" : "ثبت دستور پرداخت"}
              </button>
              {selectedInstruction?.lifecycleStatus === "active" ? (
                <button type="button" className="secondary-button" onClick={() => void handleCancelOrRestore(false)} disabled={saving}>
                  لغو دستور
                </button>
              ) : selectedInstruction ? (
                <button type="button" className="secondary-button" onClick={() => void handleCancelOrRestore(true)} disabled={saving}>
                  بازیابی
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="party-panel" aria-label="فهرست دستورهای پرداخت">
          <div className="toolbar">
            <label className="field">
              <span>جست‌وجو</span>
              <input
                value={filter.query}
                onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
                placeholder="گیرنده، حساب یا مبلغ"
              />
            </label>

            <label className="field">
              <span>وضعیت</span>
              <select
                value={filter.status}
                onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value as PaymentInstructionListFilter["status"] }))}
              >
                <option value="active">فعال</option>
                <option value="cancelled">لغوشده</option>
                <option value="all">همه</option>
              </select>
            </label>
          </div>

          <div className="party-list" aria-live="polite">
            {loading ? (
              <p className="muted-copy">در حال بارگذاری دستورهای پرداخت...</p>
            ) : visibleInstructions.length === 0 ? (
              <div className="empty-state">
                <strong>هنوز دستوری ثبت نشده است.</strong>
                <p>برای شروع، یک دستور پرداخت جدید بسازید.</p>
              </div>
            ) : (
              visibleInstructions.map((instruction) => {
                const recipient = parties.find((party) => party.id === instruction.recipientPartyId);
                const account = accounts.find((candidate) => candidate.id === instruction.destinationAccountId);
                return (
                  <button
                    key={instruction.id}
                    type="button"
                    className={instruction.id === selectedInstructionId ? "party-row party-row-selected" : "party-row"}
                    onClick={() => selectInstruction(instruction)}
                  >
                    <div className="party-row-top">
                      <strong>{recipient ? formatPartyLabel(recipient) : "گیرنده نامشخص"}</strong>
                      <span className={instruction.lifecycleStatus === "active" ? "status-pill status-active" : "status-pill status-archived"}>
                        {formatPaymentInstructionStatus(instruction.lifecycleStatus)}
                      </span>
                    </div>
                    <div className="party-row-meta">{account ? formatAccountLabel(account) : "حساب هنوز تعیین نشده"}</div>
                    <div className="party-row-meta">{formatPaymentInstructionAmount(instruction.instructedAmount)}</div>
                    <div className="party-row-meta">{instruction.note ?? "توضیحات ثبت نشده"}</div>
                    <div className="party-row-meta">نمایش جزئیات</div>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>

      {selectedInstruction && (
        <section className="detail-card" aria-label="جزئیات دستور پرداخت">
          <div className="detail-heading">
            <div>
              <p className="eyebrow">نمایش انتخاب‌شده</p>
              <h4>{summarizePaymentInstructionForDisplay(selectedInstruction, selectedRecipientParty?.displayName ?? "گیرنده نامشخص", selectedAccount?.accountLabel)}</h4>
            </div>
            <button type="button" className="tertiary-button" onClick={startNewInstruction}>
              دستور جدید
            </button>
          </div>

          <dl className="detail-grid">
            <div>
              <dt>گیرنده</dt>
              <dd>{selectedRecipientParty ? formatPartyLabel(selectedRecipientParty) : "نامشخص"}</dd>
            </div>
            <div>
              <dt>حساب مقصد</dt>
              <dd>{selectedAccount ? formatAccountLabel(selectedAccount) : "حساب هنوز تعیین نشده"}</dd>
            </div>
            <div>
              <dt>مبلغ دستور پرداخت</dt>
              <dd>{formatPaymentInstructionAmount(selectedInstruction.instructedAmount)}</dd>
            </div>
            <div>
              <dt>وضعیت</dt>
              <dd>{formatPaymentInstructionStatus(selectedInstruction.lifecycleStatus)}</dd>
            </div>
            <div>
              <dt>توضیحات</dt>
              <dd>{selectedInstruction.note ?? "ثبت نشده"}</dd>
            </div>
            <div>
              <dt>فاکتور</dt>
              <dd>{formatInvoiceDate(invoice.invoiceDate)}</dd>
            </div>
          </dl>

          <div className="detail-grid">
            <div>
              <dt>ایجاد شده</dt>
              <dd>{formatInvoiceTimestamp(selectedInstruction.createdAt)}</dd>
            </div>
            <div>
              <dt>آخرین تغییر</dt>
              <dd>{formatInvoiceTimestamp(selectedInstruction.updatedAt)}</dd>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
