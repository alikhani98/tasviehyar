import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Party, PartyRole } from "../../domain";
import { partyRoleValues } from "../../domain";
import {
  filterParties,
  findProbablePartyDraftWarnings,
  findProbablePartyDuplicateWarnings,
  partyDraftSchema,
  partyRoleLabels,
  parsePartyDraftFromParty,
  type PartyDraft,
  type PartyListFilter,
  type PartyRoleFilter,
  type PartyStatusFilter
} from "../../domain/parties";
import { db } from "../../db/tasviehyar-db";
import { createPartyRepository, type PartyRepository } from "../../services/party-repository";

export interface PartyManagementProps {
  repository?: PartyRepository;
}

const defaultFilter: PartyListFilter = {
  query: "",
  status: "all",
  role: "all"
};

type PartyFormState = {
  displayName: string;
  aliasesText: string;
  searchableDescription: string;
  roles: PartyRole[];
  phoneNumber: string;
  notes: string;
};

const defaultFormState: PartyFormState = {
  displayName: "",
  aliasesText: "",
  searchableDescription: "",
  roles: ["customer"],
  phoneNumber: "",
  notes: ""
};

const defaultPartyRepository = createPartyRepository(db);

function splitAliases(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,؛;]+/u)
        .map((alias) => alias.trim())
        .filter(Boolean)
    )
  );
}

function formatAliases(aliases: readonly string[]): string {
  return aliases.join("، ");
}

function formatPartyRoles(roles: readonly PartyRole[]): string {
  return roles.map((role) => partyRoleLabels[role]).join("، ");
}

function toPartyDraft(form: PartyFormState): PartyDraft {
  return partyDraftSchema.parse({
    displayName: form.displayName,
    aliases: splitAliases(form.aliasesText),
    searchableDescription: form.searchableDescription,
    roles: form.roles,
    phoneNumber: form.phoneNumber,
    notes: form.notes
  });
}

function buildDraftCandidate(form: PartyFormState): PartyDraft {
  return {
    displayName: form.displayName,
    aliases: splitAliases(form.aliasesText),
    searchableDescription: form.searchableDescription,
    roles: form.roles,
    phoneNumber: form.phoneNumber || undefined,
    notes: form.notes || undefined
  };
}

function formStateFromParty(party: Party): PartyFormState {
  const draft = parsePartyDraftFromParty(party);
  return {
    displayName: draft.displayName,
    aliasesText: draft.aliases.join("، "),
    searchableDescription: draft.searchableDescription ?? "",
    roles: draft.roles,
    phoneNumber: draft.phoneNumber ?? "",
    notes: draft.notes ?? ""
  };
}

export function PartyManagement({ repository = defaultPartyRepository }: PartyManagementProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);
  const [formState, setFormState] = useState<PartyFormState>(defaultFormState);
  const [filter, setFilter] = useState<PartyListFilter>(defaultFilter);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadParties = useCallback(
    async (nextSelectionId?: string | null) => {
      const records = await repository.listParties();
      if (!isMountedRef.current) {
        return;
      }

      setParties(records);
      setSelectedPartyId((currentSelected) => {
        if (typeof nextSelectionId !== "undefined") {
          return nextSelectionId;
        }

        if (currentSelected && records.some((party) => party.id === currentSelected)) {
          return currentSelected;
        }

        return currentSelected;
      });
      setLoading(false);
    },
    [repository]
  );

  useEffect(() => {
    void loadParties();
  }, [loadParties]);

  const selectedParty = useMemo(() => parties.find((party) => party.id === selectedPartyId) ?? null, [parties, selectedPartyId]);

  useEffect(() => {
    if (selectedParty) {
      setFormState(formStateFromParty(selectedParty));
      return;
    }

    setFormState(defaultFormState);
  }, [selectedParty]);

  const visibleParties = useMemo(() => filterParties(parties, filter), [filter, parties]);
  const selectedWarnings = useMemo(
    () => findProbablePartyDraftWarnings(parties, buildDraftCandidate(formState), selectedParty?.id),
    [formState, parties, selectedParty?.id]
  );
  const duplicateWarnings = useMemo(() => findProbablePartyDuplicateWarnings(parties), [parties]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const parsedDraft = toPartyDraft(formState);
      const savedParty = selectedParty
        ? await repository.updateParty(selectedParty.id, parsedDraft)
        : await repository.createParty(parsedDraft);

      await loadParties(savedParty.id);
      setNotice(selectedParty ? "تغییرات طرف با موفقیت ذخیره شد." : "طرف جدید با موفقیت ثبت شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ذخیره‌سازی ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveRestore(nextActive: boolean) {
    if (!selectedParty) {
      return;
    }

    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const updatedParty = nextActive
        ? await repository.restoreParty(selectedParty.id)
        : await repository.archiveParty(selectedParty.id);

      await loadParties(updatedParty.id);
      setNotice(nextActive ? "طرف بازیابی شد." : "طرف بایگانی شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "عملیات ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  function selectParty(party: Party) {
    setSelectedPartyId(party.id);
    setNotice(null);
    setError(null);
  }

  function clearSelection() {
    setSelectedPartyId(null);
    setFormState(defaultFormState);
    setNotice(null);
    setError(null);
  }

  const activeCount = parties.filter((party) => party.active).length;
  const archivedCount = parties.length - activeCount;
  const formIsDirty =
    formState.displayName.trim().length > 0 ||
    formState.aliasesText.trim().length > 0 ||
    formState.phoneNumber.trim().length > 0 ||
    formState.notes.trim().length > 0 ||
    formState.searchableDescription.trim().length > 0 ||
    formState.roles.length !== defaultFormState.roles.length ||
    formState.roles.some((role, index) => role !== defaultFormState.roles[index]);

  return (
    <section id="party-management" className="party-management" aria-labelledby="party-management-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">مرحله ۱</p>
          <h2 id="party-management-title">حساب اشخاص</h2>
        </div>
        <button type="button" className="tertiary-button" onClick={clearSelection}>
          طرف جدید
        </button>
      </div>

      <div className="summary-strip" aria-label="خلاصه اشخاص">
        <span>کل: {parties.length.toLocaleString("fa-IR")}</span>
        <span>فعال: {activeCount.toLocaleString("fa-IR")}</span>
        <span>بایگانی: {archivedCount.toLocaleString("fa-IR")}</span>
      </div>

      {(notice || error) && (
        <div className={error ? "notice notice-error" : "notice notice-success"} role="status" aria-live="polite">
          {error ?? notice}
        </div>
      )}

      <div className="party-layout">
        <section className="party-panel" aria-label="فرم طرف">
          <form className="party-form" onSubmit={handleSave}>
            <div className="form-grid">
              <label className="field">
                <span>نام نمایشی</span>
                <input
                  required
                  value={formState.displayName}
                  onChange={(event) => setFormState((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="مثلا: کرباسیان"
                />
              </label>

              <label className="field">
                <span>شماره تماس</span>
                <input
                  value={formState.phoneNumber}
                  onChange={(event) => setFormState((current) => ({ ...current, phoneNumber: event.target.value }))}
                  inputMode="tel"
                  placeholder="اختیاری"
                />
              </label>
            </div>

            <label className="field">
              <span>نام‌های دیگر</span>
              <textarea
                value={formState.aliasesText}
                onChange={(event) => setFormState((current) => ({ ...current, aliasesText: event.target.value }))}
                rows={2}
                placeholder="هر نام با ویرگول یا خط جدید جدا شود"
              />
            </label>

            <label className="field">
              <span>توضیح جست‌وجو</span>
              <textarea
                value={formState.searchableDescription}
                onChange={(event) => setFormState((current) => ({ ...current, searchableDescription: event.target.value }))}
                rows={2}
                placeholder="اختیاری"
              />
            </label>

            <label className="field">
              <span>یادداشت</span>
              <textarea
                value={formState.notes}
                onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))}
                rows={3}
                placeholder="اختیاری"
              />
            </label>

            <fieldset className="field">
              <legend>نقش‌ها</legend>
              <div className="role-grid">
                {partyRoleValues.map((role) => (
                  <label key={role} className="role-option">
                    <input
                      type="checkbox"
                      checked={formState.roles.includes(role)}
                      onChange={() =>
                        setFormState((current) => {
                          const hasRole = current.roles.includes(role);
                          const nextRoles = hasRole ? current.roles.filter((entry) => entry !== role) : [...current.roles, role];
                          return {
                            ...current,
                            roles: nextRoles.length > 0 ? nextRoles : current.roles
                          };
                        })
                      }
                    />
                    <span>{partyRoleLabels[role]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {selectedWarnings.length > 0 && (
              <div className="warning-card" role="note" aria-label="هشدارهای مشابهت">
                <strong>هشدارهای مشابهت احتمالی</strong>
                <ul>
                  {selectedWarnings.map((warning, index) => (
                    <li key={`${warning.kind}-${warning.matchedValue}-${index}`}>
                      {warning.kind === "duplicate_phone_number"
                        ? `شماره «${warning.matchedValue}» با ${warning.partyNames.join("، ")} هم‌پوشانی دارد.`
                        : warning.kind === "duplicate_alias"
                          ? `نام مستعار «${warning.matchedValue}» با ${warning.partyNames.join("، ")} هم‌پوشانی دارد.`
                          : `نام «${warning.matchedValue}» با ${warning.partyNames.join("، ")} هم‌پوشانی دارد.`}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={saving || (!selectedParty && !formIsDirty)}>
                {selectedParty ? "ذخیره تغییرات" : "ثبت طرف"}
              </button>
              {selectedParty ? (
                selectedParty.active ? (
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

        <section className="party-panel" aria-label="فهرست طرف‌ها">
          <div className="toolbar">
            <label className="field">
              <span>جست‌وجو</span>
              <input
                value={filter.query}
                onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
                placeholder="نام، مستعار، تلفن، یادداشت"
              />
            </label>

            <div className="toolbar-grid">
              <label className="field">
                <span>وضعیت</span>
                <select
                  value={filter.status}
                  onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value as PartyStatusFilter }))}
                >
                  <option value="all">همه</option>
                  <option value="active">فعال</option>
                  <option value="archived">بایگانی</option>
                </select>
              </label>

              <label className="field">
                <span>نقش</span>
                <select
                  value={filter.role}
                  onChange={(event) => setFilter((current) => ({ ...current, role: event.target.value as PartyRoleFilter }))}
                >
                  <option value="all">همه نقش‌ها</option>
                  {partyRoleValues.map((role) => (
                    <option key={role} value={role}>
                      {partyRoleLabels[role]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {duplicateWarnings.length > 0 && (
            <div className="warning-card" role="note" aria-label="هشدارهای مشابهت ثبت‌شده">
              <strong>مشابهت‌های احتمالی در فهرست</strong>
              <ul>
                {duplicateWarnings.map((warning, index) => (
                  <li key={`${warning.kind}-${warning.matchedValue}-${index}`}>
                    {warning.kind === "duplicate_phone_number"
                      ? `شماره «${warning.matchedValue}» بین ${warning.partyNames.join("، ")} مشترک است.`
                      : warning.kind === "duplicate_alias"
                        ? `نام مستعار «${warning.matchedValue}» بین ${warning.partyNames.join("، ")} مشترک است.`
                        : `نام «${warning.matchedValue}» بین ${warning.partyNames.join("، ")} مشترک است.`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="party-list" aria-live="polite">
            {loading ? (
              <p className="muted-copy">در حال بارگذاری اشخاص...</p>
            ) : visibleParties.length === 0 ? (
              <div className="empty-state">
                <strong>موردی پیدا نشد.</strong>
                <p>با جست‌وجو یا فیلترهای بالاتر، فهرست را محدود کنید یا یک طرف جدید ثبت کنید.</p>
              </div>
            ) : (
              visibleParties.map((party) => (
                <button
                  key={party.id}
                  type="button"
                  className={party.id === selectedPartyId ? "party-row party-row-selected" : "party-row"}
                  onClick={() => selectParty(party)}
                >
                  <div className="party-row-top">
                    <strong>{party.displayName}</strong>
                    <span className={party.active ? "status-pill status-active" : "status-pill status-archived"}>
                      {party.active ? "فعال" : "بایگانی"}
                    </span>
                  </div>
                  <div className="party-row-meta">{formatPartyRoles(party.roles)}</div>
                  <div className="party-row-meta">{party.phoneNumber ?? "شماره ثبت نشده"}</div>
                  {party.aliases.length > 0 && <div className="party-row-meta">نام دیگر: {formatAliases(party.aliases)}</div>}
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      {selectedParty && (
        <section className="detail-card" aria-label="جزئیات طرف">
          <div className="detail-heading">
            <div>
              <p className="eyebrow">نمایش انتخاب‌شده</p>
              <h3>{selectedParty.displayName}</h3>
            </div>
            <button type="button" className="tertiary-button" onClick={clearSelection}>
              بستن
            </button>
          </div>

          <dl className="detail-grid">
            <div>
              <dt>نقش‌ها</dt>
              <dd>{formatPartyRoles(selectedParty.roles)}</dd>
            </div>
            <div>
              <dt>شماره تماس</dt>
              <dd>{selectedParty.phoneNumber ?? "ثبت نشده"}</dd>
            </div>
            <div>
              <dt>نام‌های دیگر</dt>
              <dd>{selectedParty.aliases.length > 0 ? formatAliases(selectedParty.aliases) : "ثبت نشده"}</dd>
            </div>
            <div>
              <dt>وضعیت</dt>
              <dd>{selectedParty.active ? "فعال" : "بایگانی"}</dd>
            </div>
          </dl>

          {selectedParty.searchableDescription && <p className="detail-copy">{selectedParty.searchableDescription}</p>}

          {selectedParty.notes && <p className="detail-copy">{selectedParty.notes}</p>}
        </section>
      )}
    </section>
  );
}
