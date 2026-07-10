import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Party } from "../../domain";
import {
  destinationAccountDraftSchema,
  filterDestinationAccounts,
  findProbableDestinationAccountDraftWarnings,
  findProbableDestinationAccountDuplicateWarnings,
  formatDestinationAccountLabel,
  maskDestinationAccountIdentifier,
  normalizeBankAccountNumber,
  normalizeCardNumber,
  normalizeIban,
  parseDestinationAccountDraftFromAccount,
  type DestinationAccountDraft,
  type DestinationAccountListFilter,
  type DestinationAccountDuplicateWarning
} from "../../domain/destination-accounts";
import type { DestinationAccount } from "../../domain";
import { db } from "../../db/tasviehyar-db";
import {
  createDestinationAccountRepository,
  type DestinationAccountRepository
} from "../../services/destination-account-repository";

export interface DestinationAccountManagementProps {
  party: Party;
  parties: readonly Party[];
  repository?: DestinationAccountRepository;
}

type DestinationAccountFormState = {
  accountLabel: string;
  bankName: string;
  cardNumber: string;
  iban: string;
  bankAccountNumber: string;
};

const emptyFormState: DestinationAccountFormState = {
  accountLabel: "",
  bankName: "",
  cardNumber: "",
  iban: "",
  bankAccountNumber: ""
};

const defaultFilter: DestinationAccountListFilter = {
  query: "",
  status: "active"
};

const defaultDestinationAccountRepository = createDestinationAccountRepository(db);

function formStateFromAccount(account: DestinationAccount): DestinationAccountFormState {
  const draft = parseDestinationAccountDraftFromAccount(account);
  return {
    accountLabel: draft.accountLabel,
    bankName: draft.bankName ?? "",
    cardNumber: draft.cardNumber ?? "",
    iban: draft.iban ?? "",
    bankAccountNumber: draft.bankAccountNumber ?? ""
  };
}

function toDraft(party: Party, form: DestinationAccountFormState): DestinationAccountDraft {
  return destinationAccountDraftSchema.parse({
    ownerPartyId: party.id,
    accountLabel: form.accountLabel,
    bankName: form.bankName,
    cardNumber: form.cardNumber,
    iban: form.iban,
    bankAccountNumber: form.bankAccountNumber
  });
}

function buildDraftCandidate(party: Party, form: DestinationAccountFormState): DestinationAccountDraft {
  return {
    ownerPartyId: party.id,
    accountLabel: form.accountLabel,
    bankName: form.bankName || undefined,
    cardNumber: normalizeCardNumber(form.cardNumber) || undefined,
    iban: normalizeIban(form.iban) || undefined,
    bankAccountNumber: normalizeBankAccountNumber(form.bankAccountNumber) || undefined
  };
}

function formatDuplicateWarning(warning: DestinationAccountDuplicateWarning): string {
  const ownerNames = warning.partyNames.join("، ");
  const accountLabels = warning.accountLabels.join("، ");

  switch (warning.kind) {
    case "duplicate_card_number":
      return `شماره کارت «${maskDestinationAccountIdentifier(warning.matchedValue)}» با حساب‌های ${accountLabels} در ${ownerNames} تکرار شده است.`;
    case "duplicate_iban":
      return `شماره شبا «${maskDestinationAccountIdentifier(warning.matchedValue)}» با حساب‌های ${accountLabels} در ${ownerNames} تکرار شده است.`;
    case "duplicate_bank_account_number":
      return `شماره حساب «${maskDestinationAccountIdentifier(warning.matchedValue)}» با حساب‌های ${accountLabels} در ${ownerNames} مشابه است.`;
  }
}

function formatIdentifierLine(label: string, value: string | undefined): string {
  if (!value) {
    return `${label}: ثبت نشده`;
  }

  return `${label}: ${maskDestinationAccountIdentifier(value)}`;
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return Promise.resolve();
}

export function DestinationAccountManagement({
  party,
  parties,
  repository = defaultDestinationAccountRepository
}: DestinationAccountManagementProps) {
  const [accounts, setAccounts] = useState<DestinationAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [formState, setFormState] = useState<DestinationAccountFormState>(emptyFormState);
  const [filter, setFilter] = useState<DestinationAccountListFilter>(defaultFilter);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [revealedIdentifiers, setRevealedIdentifiers] = useState({
    cardNumber: false,
    iban: false,
    bankAccountNumber: false
  });
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadAccounts = useCallback(
    async (nextSelectionId?: string | null) => {
      const records = await repository.listAccountsByParty(party.id, true);
      if (!isMountedRef.current) {
        return;
      }

      setAccounts(records);
      if (typeof nextSelectionId !== "undefined") {
        setSelectedAccountId(nextSelectionId);
      }
      setLoading(false);
    },
    [party.id, repository]
  );

  useEffect(() => {
    setSelectedAccountId(null);
    setFormState(emptyFormState);
    setCopyNotice(null);
    setNotice(null);
    setError(null);
    setLoading(true);
    void loadAccounts();
  }, [loadAccounts]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );

  useEffect(() => {
    if (selectedAccount) {
      setFormState(formStateFromAccount(selectedAccount));
      setRevealedIdentifiers({
        cardNumber: false,
        iban: false,
        bankAccountNumber: false
      });
      return;
    }

    setFormState(emptyFormState);
    setRevealedIdentifiers({
      cardNumber: false,
      iban: false,
      bankAccountNumber: false
    });
  }, [selectedAccount]);

  const visibleAccounts = useMemo(() => filterDestinationAccounts(accounts, filter), [accounts, filter]);
  const duplicateWarnings = useMemo(() => findProbableDestinationAccountDuplicateWarnings(accounts, parties), [accounts, parties]);
  const draftWarnings = useMemo(
    () => findProbableDestinationAccountDraftWarnings(accounts, parties, buildDraftCandidate(party, formState), selectedAccount?.id),
    [accounts, formState, party, parties, selectedAccount?.id]
  );
  const activeCount = accounts.filter((account) => account.active).length;
  const archivedCount = accounts.length - activeCount;
  const canCreate = party.active || Boolean(selectedAccount);
  const formIsDirty =
    formState.accountLabel.trim().length > 0 ||
    formState.bankName.trim().length > 0 ||
    formState.cardNumber.trim().length > 0 ||
    formState.iban.trim().length > 0 ||
    formState.bankAccountNumber.trim().length > 0;

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    setError(null);
    setCopyNotice(null);

    try {
      const parsedDraft = toDraft(party, formState);
      const savedAccount = selectedAccount
        ? await repository.updateAccount(selectedAccount.id, parsedDraft)
        : await repository.createAccount(parsedDraft);

      await loadAccounts(savedAccount.id);
      setNotice(selectedAccount ? "حساب مقصد با موفقیت به‌روزرسانی شد." : "حساب مقصد با موفقیت ثبت شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ذخیره‌سازی ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveRestore(nextActive: boolean) {
    if (!selectedAccount) {
      return;
    }

    const confirmationText = nextActive
      ? "آیا می‌خواهید این حساب مقصد را بازیابی کنید؟"
      : "آیا می‌خواهید این حساب مقصد را بایگانی کنید؟";
    if (!window.confirm(confirmationText)) {
      return;
    }

    setSaving(true);
    setNotice(null);
    setError(null);
    setCopyNotice(null);

    try {
      const updatedAccount = nextActive
        ? await repository.restoreAccount(selectedAccount.id)
        : await repository.archiveAccount(selectedAccount.id);

      await loadAccounts(updatedAccount.id);
      setNotice(nextActive ? "حساب مقصد بازیابی شد." : "حساب مقصد بایگانی شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "عملیات ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  function selectAccount(account: DestinationAccount) {
    setSelectedAccountId(account.id);
    setNotice(null);
    setError(null);
    setCopyNotice(null);
  }

  function clearSelection() {
    setSelectedAccountId(null);
    setFormState(emptyFormState);
    setNotice(null);
    setError(null);
    setCopyNotice(null);
  }

  async function handleCopy(identifier: "cardNumber" | "iban" | "bankAccountNumber") {
    if (!selectedAccount) {
      return;
    }

    const value = selectedAccount[identifier];
    if (!value) {
      setCopyNotice("این فیلد مقداری برای کپی ندارد.");
      return;
    }

    await copyText(value);
    setCopyNotice(
      identifier === "cardNumber"
        ? "شماره کارت کپی شد."
        : identifier === "iban"
          ? "شماره شبا کپی شد."
          : "شماره حساب کپی شد."
    );
  }

  const visibleCountLabel = filter.status === "active" ? "فعال" : filter.status === "archived" ? "بایگانی" : "همه";

  return (
    <section className="destination-account-section" aria-labelledby="destination-account-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">مرحله ۲</p>
          <h3 id="destination-account-title">حساب‌های مقصد</h3>
        </div>
        <button type="button" className="tertiary-button" onClick={clearSelection}>
          حساب جدید
        </button>
      </div>

      <div className="summary-strip" aria-label="خلاصه حساب‌ها">
        <span>کل: {accounts.length.toLocaleString("fa-IR")}</span>
        <span>فعال: {activeCount.toLocaleString("fa-IR")}</span>
        <span>بایگانی: {archivedCount.toLocaleString("fa-IR")}</span>
        <span>نمایش: {visibleCountLabel}</span>
      </div>

      {!party.active && (
        <div className="notice notice-warning" role="note">
          این طرف بایگانی شده است. ثبت حساب جدید برای طرف بایگانی‌شده مجاز نیست تا زمانی که طرف را بازیابی کنید.
        </div>
      )}

      {(notice || error || copyNotice) && (
        <div className={error ? "notice notice-error" : "notice notice-success"} role="status" aria-live="polite">
          {error ?? notice ?? copyNotice}
        </div>
      )}

      <div className="destination-account-layout">
        <section className="party-panel" aria-label="فرم حساب مقصد">
          <form className="party-form" onSubmit={handleSave}>
            <div className="form-grid">
              <label className="field">
                <span>عنوان حساب</span>
                <input
                  required
                  value={formState.accountLabel}
                  onChange={(event) => setFormState((current) => ({ ...current, accountLabel: event.target.value }))}
                  placeholder="مثل: حساب اصلی"
                />
              </label>

              <label className="field">
                <span>نام بانک</span>
                <input
                  value={formState.bankName}
                  onChange={(event) => setFormState((current) => ({ ...current, bankName: event.target.value }))}
                  placeholder="اختیاری"
                />
              </label>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>شماره کارت</span>
                <input
                  value={formState.cardNumber}
                  onChange={(event) => setFormState((current) => ({ ...current, cardNumber: event.target.value }))}
                  inputMode="numeric"
                  placeholder="اختیاری"
                />
              </label>

              <label className="field">
                <span>شماره شبا</span>
                <input
                  value={formState.iban}
                  onChange={(event) => setFormState((current) => ({ ...current, iban: event.target.value }))}
                  inputMode="text"
                  placeholder="IR..."
                />
              </label>
            </div>

            <label className="field">
              <span>شماره حساب</span>
              <input
                value={formState.bankAccountNumber}
                onChange={(event) => setFormState((current) => ({ ...current, bankAccountNumber: event.target.value }))}
                inputMode="numeric"
                placeholder="اختیاری"
              />
            </label>

            {draftWarnings.length > 0 && (
              <div className="warning-card warning-card-strong" role="note" aria-label="هشدارهای مشابهت حساب">
                <strong>هشدار مشابهت دقیق</strong>
                <ul>
                  {draftWarnings.map((warning, index) => (
                    <li key={`${warning.kind}-${warning.matchedValue}-${index}`}>{formatDuplicateWarning(warning)}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={saving || (!selectedAccount && (!formIsDirty || !canCreate))}>
                {selectedAccount ? "ذخیره تغییرات" : "ثبت حساب مقصد"}
              </button>
              {selectedAccount ? (
                selectedAccount.active ? (
                  <button type="button" className="secondary-button" onClick={() => void handleArchiveRestore(false)} disabled={saving}>
                    بایگانی
                  </button>
                ) : (
                  <button type="button" className="secondary-button" onClick={() => void handleArchiveRestore(true)} disabled={saving}>
                    بازیابی
                  </button>
                )
              ) : null}
            </div>
          </form>
        </section>

        <section className="party-panel" aria-label="فهرست حساب‌های مقصد">
          <div className="toolbar">
            <label className="field">
              <span>جست‌وجو</span>
              <input
                value={filter.query}
                onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
                placeholder="عنوان، بانک، کارت، شبا، حساب"
              />
            </label>

            <label className="field">
              <span>وضعیت</span>
              <select
                value={filter.status}
                onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value as DestinationAccountListFilter["status"] }))}
              >
                <option value="active">فعال</option>
                <option value="archived">بایگانی</option>
                <option value="all">همه</option>
              </select>
            </label>
          </div>

          {duplicateWarnings.length > 0 && (
            <div className="warning-card warning-card-strong" role="note" aria-label="هشدارهای مشابهت ثبت‌شده">
              <strong>تکرارهای دقیق در حساب‌ها</strong>
              <ul>
                {duplicateWarnings.map((warning, index) => (
                  <li key={`${warning.kind}-${warning.matchedValue}-${index}`}>{formatDuplicateWarning(warning)}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="party-list" aria-live="polite">
            {loading ? (
              <p className="muted-copy">در حال بارگذاری حساب‌ها...</p>
            ) : visibleAccounts.length === 0 ? (
              <div className="empty-state">
                <strong>حسابی پیدا نشد.</strong>
                <p>با جست‌وجو یا فیلتر بالاتر، فهرست را محدود کنید یا یک حساب جدید ثبت کنید.</p>
              </div>
            ) : (
              visibleAccounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  className={account.id === selectedAccountId ? "party-row party-row-selected" : "party-row"}
                  onClick={() => selectAccount(account)}
                >
                  <div className="party-row-top">
                    <strong>{formatDestinationAccountLabel(account)}</strong>
                    <span className={account.active ? "status-pill status-active" : "status-pill status-archived"}>
                      {account.active ? "فعال" : "بایگانی"}
                    </span>
                  </div>
                  <div className="party-row-meta">{account.bankName ?? "نام بانک ثبت نشده"}</div>
                  <div className="party-row-meta">
                    {formatIdentifierLine("کارت", account.cardNumber)}
                    {" · "}
                    {formatIdentifierLine("شبا", account.iban)}
                  </div>
                  <div className="party-row-meta">{formatIdentifierLine("حساب", account.bankAccountNumber)}</div>
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      {selectedAccount && (
        <section className="detail-card" aria-label="جزئیات حساب مقصد">
          <div className="detail-heading">
            <div>
              <p className="eyebrow">نمایش انتخاب‌شده</p>
              <h4>{selectedAccount.accountLabel}</h4>
            </div>
            <button type="button" className="tertiary-button" onClick={clearSelection}>
              بستن
            </button>
          </div>

          <dl className="detail-grid">
            <div>
              <dt>طرف مالک</dt>
              <dd>{party.displayName}</dd>
            </div>
            <div>
              <dt>نام بانک</dt>
              <dd>{selectedAccount.bankName ?? "ثبت نشده"}</dd>
            </div>
            <div>
              <dt>شماره کارت</dt>
              <dd className="identifier-detail">
                <span>{revealedIdentifiers.cardNumber ? selectedAccount.cardNumber ?? "ثبت نشده" : maskDestinationAccountIdentifier(selectedAccount.cardNumber ?? "") || "ثبت نشده"}</span>
                {selectedAccount.cardNumber && (
                  <div className="identifier-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setRevealedIdentifiers((current) => ({ ...current, cardNumber: !current.cardNumber }))}
                    >
                      {revealedIdentifiers.cardNumber ? "پنهان" : "نمایش"}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => void handleCopy("cardNumber")}>
                      کپی
                    </button>
                  </div>
                )}
              </dd>
            </div>
            <div>
              <dt>شماره شبا</dt>
              <dd className="identifier-detail">
                <span>{revealedIdentifiers.iban ? selectedAccount.iban ?? "ثبت نشده" : maskDestinationAccountIdentifier(selectedAccount.iban ?? "") || "ثبت نشده"}</span>
                {selectedAccount.iban && (
                  <div className="identifier-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setRevealedIdentifiers((current) => ({ ...current, iban: !current.iban }))}
                    >
                      {revealedIdentifiers.iban ? "پنهان" : "نمایش"}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => void handleCopy("iban")}>
                      کپی
                    </button>
                  </div>
                )}
              </dd>
            </div>
            <div>
              <dt>شماره حساب</dt>
              <dd className="identifier-detail">
                <span>
                  {revealedIdentifiers.bankAccountNumber
                    ? selectedAccount.bankAccountNumber ?? "ثبت نشده"
                    : maskDestinationAccountIdentifier(selectedAccount.bankAccountNumber ?? "") || "ثبت نشده"}
                </span>
                {selectedAccount.bankAccountNumber && (
                  <div className="identifier-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setRevealedIdentifiers((current) => ({ ...current, bankAccountNumber: !current.bankAccountNumber }))}
                    >
                      {revealedIdentifiers.bankAccountNumber ? "پنهان" : "نمایش"}
                    </button>
                    <button type="button" className="secondary-button" onClick={() => void handleCopy("bankAccountNumber")}>
                      کپی
                    </button>
                  </div>
                )}
              </dd>
            </div>
            <div>
              <dt>وضعیت</dt>
              <dd>{selectedAccount.active ? "فعال" : "بایگانی"}</dd>
            </div>
          </dl>

          <div className="detail-grid">
            <div>
              <dt>ایجاد شده</dt>
              <dd>{selectedAccount.createdAt}</dd>
            </div>
            <div>
              <dt>آخرین تغییر</dt>
              <dd>{selectedAccount.updatedAt}</dd>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
