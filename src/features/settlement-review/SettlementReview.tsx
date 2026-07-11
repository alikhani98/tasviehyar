import { useEffect, useMemo, useRef, useState } from "react";
import type { DestinationAccount, Invoice, Payment, PaymentAllocation, PaymentInstruction, Party } from "../../domain";
import { db } from "../../db/tasviehyar-db";
import { createDestinationAccountRepository, type DestinationAccountRepository } from "../../services/destination-account-repository";
import { createInvoiceRepository, type InvoiceRepository } from "../../services/invoice-repository";
import { createPartyRepository, type PartyRepository } from "../../services/party-repository";
import { createPaymentInstructionRepository, type PaymentInstructionRepository } from "../../services/payment-instruction-repository";
import { createPaymentRepository, type PaymentRepository } from "../../services/payment-repository";
import { buildSettlementHomeCards, deriveSettlementReviewItems, type SettlementMismatchType, type SettlementReviewItem } from "../../domain/settlement";

type SeverityFilter = "all" | "high" | "medium" | "low";
type TypeFilter = "all" | SettlementMismatchType;

const severityValues: SeverityFilter[] = ["all", "high", "medium", "low"];
const typeValues: TypeFilter[] = [
  "all",
  "unallocated_payment",
  "disputed_payment",
  "duplicate_tracking_reference",
  "probable_duplicate_payment",
  "instruction_overpayment",
  "invoice_overpayment",
  "recipient_mismatch",
  "destination_account_owner_mismatch",
  "active_instruction_without_destination_account",
  "reported_payment_awaiting_confirmation"
];

const defaultPartyRepository = createPartyRepository(db);
const defaultInvoiceRepository = createInvoiceRepository(db);
const defaultPaymentRepository = createPaymentRepository(db);
const defaultPaymentInstructionRepository = createPaymentInstructionRepository(db);
const defaultDestinationAccountRepository = createDestinationAccountRepository(db);

function dispatchOpenRecord(target: SettlementReviewItem["navigation"]): void {
  window.dispatchEvent(
    new CustomEvent("tasviehyar-open-record", {
      detail: target
    })
  );
}

function matchesSearch(item: SettlementReviewItem, query: string): boolean {
  if (!query) {
    return true;
  }

  return item.searchText.toLowerCase().includes(query);
}

export interface SettlementReviewProps {
  partyRepository?: PartyRepository;
  invoiceRepository?: InvoiceRepository;
  paymentRepository?: PaymentRepository;
  paymentInstructionRepository?: PaymentInstructionRepository;
  destinationAccountRepository?: DestinationAccountRepository;
}

export function SettlementReview({
  partyRepository = defaultPartyRepository,
  invoiceRepository = defaultInvoiceRepository,
  paymentRepository = defaultPaymentRepository,
  paymentInstructionRepository = defaultPaymentInstructionRepository,
  destinationAccountRepository = defaultDestinationAccountRepository
}: SettlementReviewProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);
  const [instructions, setInstructions] = useState<PaymentInstruction[]>([]);
  const [destinationAccounts, setDestinationAccounts] = useState<DestinationAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [partyRecords, invoiceRecords, paymentRecords, allocationRecords, instructionRecords, destinationAccountRecords] = await Promise.all([
        partyRepository.listParties(),
        invoiceRepository.listInvoices(),
        paymentRepository.listPayments(),
        paymentRepository.listAllocations(),
        paymentInstructionRepository.listInstructions(),
        destinationAccountRepository.listAccounts()
      ]);

      if (cancelled || !isMountedRef.current) {
        return;
      }

      setParties(partyRecords);
      setInvoices(invoiceRecords);
      setPayments(paymentRecords);
      setAllocations(allocationRecords);
      setInstructions(instructionRecords);
      setDestinationAccounts(destinationAccountRecords);
      setLoading(false);
    }

    void load();

    const handleChange = () => {
      void load();
    };
    window.addEventListener("tasviehyar-data-updated", handleChange);
    return () => {
      cancelled = true;
      window.removeEventListener("tasviehyar-data-updated", handleChange);
    };
  }, [destinationAccountRepository, invoiceRepository, partyRepository, paymentInstructionRepository, paymentRepository]);

  const cards = useMemo(
    () =>
      buildSettlementHomeCards({
        parties,
        invoices,
        instructions,
        payments,
        allocations,
        destinationAccounts
      }),
    [allocations, destinationAccounts, invoices, instructions, parties, payments]
  );

  const items = useMemo(
    () =>
      deriveSettlementReviewItems({
        parties,
        invoices,
        instructions,
        payments,
        allocations,
        destinationAccounts
      }),
    [allocations, destinationAccounts, invoices, instructions, parties, payments]
  );

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (severityFilter !== "all" && item.severity !== severityFilter) {
          return false;
        }
        if (typeFilter !== "all" && item.mismatchType !== typeFilter) {
          return false;
        }
        return matchesSearch(item, query.trim().toLowerCase());
      }),
    [items, query, severityFilter, typeFilter]
  );

  return (
    <section id="settlement-review" className="settlement-review" aria-labelledby="settlement-review-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">مرحله ۶</p>
          <h2 id="settlement-review-title">مغایرت‌ها</h2>
        </div>
      </div>

      <div className="summary-strip" aria-label="خلاصه تسویه">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className="summary-card summary-card-clickable"
            onClick={() => {
              if (card.navigation.section === "reconciliation") {
                document.getElementById("settlement-review")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
                return;
              }

              if (card.navigation.recordId) {
                dispatchOpenRecord(card.navigation);
              }
            }}
          >
            <strong>{card.label}</strong>
            <div className="summary-value">{card.value}</div>
            <p className="detail-copy">{card.detail}</p>
          </button>
        ))}
      </div>

      <div className="reconciliation-toolbar">
        <label className="field">
          <span>جست‌وجو</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="نام، فاکتور، پیگیری" />
        </label>

        <div className="toolbar-grid">
          <label className="field">
            <span>شدت</span>
            <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}>
              {severityValues.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? "همه" : value === "high" ? "بالا" : value === "medium" ? "متوسط" : "کم"}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>نوع مغایرت</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}>
              {typeValues.map((value) => (
                <option key={value} value={value}>
                  {value === "all"
                    ? "همه"
                    : value === "unallocated_payment"
                      ? "پرداخت بدون تخصیص"
                      : value === "disputed_payment"
                        ? "پرداخت مورد اختلاف"
                        : value === "duplicate_tracking_reference"
                          ? "شماره پیگیری تکراری"
                          : value === "probable_duplicate_payment"
                            ? "پرداخت مشابه"
                            : value === "instruction_overpayment"
                              ? "بیش‌پرداخت دستور"
                              : value === "invoice_overpayment"
                                ? "بیش‌پرداخت فاکتور"
                                : value === "recipient_mismatch"
                                  ? "ناهمخوانی گیرنده"
                                  : value === "destination_account_owner_mismatch"
                                    ? "مالک حساب مقصد"
                                    : value === "active_instruction_without_destination_account"
                                      ? "دستور بدون حساب مقصد"
                                      : "پرداخت در انتظار تأیید"}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">
          <strong>در حال بارگذاری موارد بررسی...</strong>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="empty-state">
          <strong>{items.length === 0 ? "موردی برای بررسی وجود ندارد." : "موردی با این فیلترها پیدا نشد."}</strong>
          <p>{items.length === 0 ? "همه چیز در وضعیت قابل‌قبول است." : "شدت، نوع یا جست‌وجو را تغییر دهید."}</p>
        </div>
      ) : (
        <div className="review-list" aria-live="polite">
          {filteredItems.map((item) => (
            <article key={item.id} className={`review-card review-card-${item.severity}`}>
              <div className="review-card-top">
                <strong>{item.title}</strong>
                <span className="status-pill status-active">{item.severity === "high" ? "بالا" : item.severity === "medium" ? "متوسط" : "کم"}</span>
              </div>
              <p className="detail-copy">{item.explanation}</p>
              <div className="party-row-meta">
                {item.relatedPartyName ?? item.relatedPartyId ?? "—"}
                {item.invoiceReference ? ` · فاکتور ${item.invoiceReference}` : ""}
                {item.paymentTrackingReference ? ` · پیگیری ${item.paymentTrackingReference}` : ""}
              </div>
              <div className="form-actions">
                <button type="button" className="secondary-button" onClick={() => dispatchOpenRecord(item.navigation)}>
                  رفتن به مورد
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="detail-copy">مبالغ و مانده‌ها به‌صورت مشتق‌شده محاسبه می‌شوند و به‌صورت دستی قابل ویرایش نیستند.</p>
    </section>
  );
}
