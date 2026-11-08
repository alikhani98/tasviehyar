import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";
import { summarizeInvoiceSettlement } from "../../domain/calculations";
import { formatInvoiceAmount } from "../../domain/invoices";
import { summarizeInvoiceBalance } from "../../domain/settlement";
import { createDestinationAccountRepository } from "../../services/destination-account-repository";
import { createInvoiceRepository } from "../../services/invoice-repository";
import { createPartyRepository } from "../../services/party-repository";
import { createPaymentInstructionRepository } from "../../services/payment-instruction-repository";
import { createPaymentRepository } from "../../services/payment-repository";
import * as reportExport from "../../services/report-export";
import { Reports } from "../reports/Reports";
import { SettlementReview } from "../settlement-review/SettlementReview";
import { InvoiceManagement } from "./InvoiceManagement";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["invoice-only", "mixed", "cancelled instruction"] as const)(
  "characterizes settlement across screens and exports for %s allocations",
  async (scenario) => {
    const database = new TasviehYarDatabase(`allocation-baseline-${crypto.randomUUID()}`);
    const partyRepository = createPartyRepository(database);
    const invoiceRepository = createInvoiceRepository(database);
    const paymentRepository = createPaymentRepository(database);
    const paymentInstructionRepository = createPaymentInstructionRepository(database);
    const destinationAccountRepository = createDestinationAccountRepository(database);
    const repositories = { partyRepository, invoiceRepository, paymentRepository, paymentInstructionRepository, destinationAccountRepository };
    const user = userEvent.setup();

    try {
      const payer = await partyRepository.createParty({ displayName: "مشتری نمونه", aliases: [], roles: ["customer"] });
      const recipient = await partyRepository.createParty({ displayName: "گیرنده نمونه", aliases: [], roles: ["farmer"] });
      const invoice = await invoiceRepository.createInvoice({
        customerPartyId: payer.id, invoiceDate: "2026-07-10", totalAmount: 100_000, referenceNumber: "BASE-01"
      });
      const instruction = scenario !== "invoice-only"
        ? await paymentInstructionRepository.createInstruction({ invoiceId: invoice.id, recipientPartyId: recipient.id, instructedAmount: 100_000 })
        : undefined;
      const confirmed = await paymentRepository.createPayment({
        payerPartyId: payer.id, recipientPartyId: recipient.id, amount: 70_000,
        paymentDate: "2026-07-10", paymentMethod: "bank_transfer", verificationStatus: "reported"
      });
      const reported = await paymentRepository.createPayment({
        payerPartyId: payer.id, recipientPartyId: recipient.id, amount: 40_000,
        paymentDate: "2026-07-10", paymentMethod: "bank_transfer", verificationStatus: "reported"
      });
      for (const [index, payment] of [confirmed, reported].entries()) {
        await paymentRepository.createAllocation(payment.id, {
          invoiceId: invoice.id,
          paymentInstructionId: scenario === "mixed" && index === 1 ? undefined : instruction?.id,
          allocatedAmount: payment.amount
        });
      }
      await paymentRepository.recordVerification(confirmed.id, {
        verificationResult: "confirmed", verificationMethod: "receipt_review", verifierDescriptionOrPartyRef: "اپراتور نمونه"
      });
      const payments = await paymentRepository.listPayments();
      const allocations = await paymentRepository.listAllocations();
      expect(allocations).toHaveLength(2);
      expect(allocations.map((allocation) => allocation.paymentInstructionId).sort()).toEqual(
        scenario === "mixed" ? [instruction?.id, undefined].sort() : [instruction?.id, instruction?.id]
      );

      if (scenario === "cancelled instruction" && instruction) {
        expect(summarizeInvoiceBalance(invoice, [instruction], payments, allocations)).toMatchObject({
          confirmedOutstandingAmount: 30_000, provisionalOutstandingAmount: 0, overpaymentAmount: 10_000
        });
        await paymentInstructionRepository.cancelInstruction(instruction.id);
        expect(await paymentRepository.listAllocations()).toEqual(allocations);
        expect(await database.auditEvents.where("entityId").equals(instruction.id).toArray()).toHaveLength(2);
      }

      const instructions = await paymentInstructionRepository.listInstructions();
      expect(summarizeInvoiceSettlement(invoice, instructions, payments, allocations)).toMatchObject({
        confirmedOutstandingAmount: 30_000, provisionalOutstandingAmount: 0
      });
      expect(summarizeInvoiceBalance(invoice, instructions, payments, allocations)).toMatchObject({
        confirmedOutstandingAmount: 30_000, provisionalOutstandingAmount: 0, overpaymentAmount: 10_000
      });

      vi.stubGlobal("URL", class extends URL {
        static override createObjectURL() { return "blob:allocation-baseline"; }
        static override revokeObjectURL() { /* Downloads stay inside the test. */ }
      });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      const excel = vi.spyOn(reportExport, "buildOperationalReportWorkbook");
      const csv = vi.spyOn(reportExport, "serializeRowsToCsv");
      render(<>
        <InvoiceManagement repository={invoiceRepository} {...repositories} />
        <SettlementReview {...repositories} />
        <Reports {...repositories} />
      </>);

      await user.click(await screen.findByRole("button", { name: /BASE-01/ }));
      const summary = within(screen.getByLabelText("خلاصه تسویه فاکتور"));
      for (const label of ["مانده قطعی", "مانده احتمالی"]) {
        expect(summary.getByText(label).nextElementSibling).toHaveTextContent(formatInvoiceAmount(label === "مانده قطعی" ? 30_000 : 0));
      }
      const review = within(screen.getByRole("region", { name: "مغایرت‌ها" }));
      expect(await review.findByText("پرداخت اعلام‌شده در انتظار تأیید")).toBeInTheDocument();
      if (scenario === "cancelled instruction") {
        expect(await review.findByText("تخصیص به دستور لغوشده")).toBeInTheDocument();
      } else {
        expect(review.queryByText("تخصیص به دستور لغوشده")).not.toBeInTheDocument();
      }

      const reports = within(screen.getByRole("region", { name: "گزارش‌ها" }));
      await user.click(reports.getByRole("tab", { name: "فاکتورها وضعیت تسویه" }));
      const row = await reports.findByRole("row", { name: /BASE-01/ });
      expect(within(row).getAllByRole("cell")[6]).toHaveTextContent(formatInvoiceAmount(30_000));
      await user.click(reports.getByRole("button", { name: "CSV" }));
      expect(csv.mock.results.at(-1)?.value).toContain("BASE-01");
      expect(csv.mock.calls.at(-1)?.[0]).toMatchObject([{ confirmedOutstanding: 30_000, provisionalOutstanding: 0 }]);
      await user.click(reports.getByRole("button", { name: "Excel" }));
      await waitFor(() => expect(reports.getByText("فایل اکسل گزارش آماده شد.")).toBeInTheDocument());
      const workbook = await excel.mock.results[0]?.value;
      const exported = workbook?.getWorksheet("فاکتورها");
      expect(exported?.getCell("H2").value).toBe(30_000);
      expect(exported?.getCell("I2").value).toBe(0);
    } finally {
      cleanup();
      await database.delete();
    }
  }
);
