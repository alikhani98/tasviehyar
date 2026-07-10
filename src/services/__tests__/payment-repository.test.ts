import { afterEach, describe, expect, it } from "vitest";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";
import { buildDestinationAccountRecord } from "../../domain/destination-accounts";
import { buildInvoiceRecord } from "../../domain/invoices";
import { buildPaymentInstructionRecord } from "../../domain/payment-instructions";
import { buildPartyRecord, type PartyDraft } from "../../domain/parties";
import { createPaymentRepository } from "../payment-repository";

const databases: TasviehYarDatabase[] = [];

function createRepository() {
  const database = new TasviehYarDatabase(`payment-tests-${crypto.randomUUID()}`);
  const repository = createPaymentRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });

  databases.push(database);
  return { database, repository };
}

function makePartyDraft(displayName: string): PartyDraft {
  return {
    displayName,
    aliases: [],
    searchableDescription: undefined,
    roles: ["customer"],
    phoneNumber: undefined,
    notes: undefined
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("payment repository", () => {
  it("creates payments, verifications, allocations, and audit events atomically", async () => {
    const { database, repository } = createRepository();
    const payer = buildPartyRecord("party_payer", makePartyDraft("زارع"), { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" }, true);
    const recipient = buildPartyRecord("party_recipient", makePartyDraft("احمدی"), { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" }, true);
    const invoiceA = buildInvoiceRecord(
      "inv_a",
      {
        customerPartyId: payer.id,
        invoiceDate: "2026-07-10",
        totalAmount: 100_000_000,
        referenceNumber: "ف-۱",
        note: undefined
      },
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      "active"
    );
    const invoiceB = buildInvoiceRecord(
      "inv_b",
      {
        customerPartyId: payer.id,
        invoiceDate: "2026-07-11",
        totalAmount: 100_000_000,
        referenceNumber: "ف-۲",
        note: undefined
      },
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      "active"
    );
    const account = buildDestinationAccountRecord(
      "acct_1",
      {
        ownerPartyId: recipient.id,
        accountLabel: "حساب اصلی",
        bankName: undefined,
        cardNumber: "1234567890123456",
        iban: undefined,
        bankAccountNumber: undefined
      },
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      true
    );
    const instruction = buildPaymentInstructionRecord(
      "inst_1",
      {
        invoiceId: invoiceA.id,
        recipientPartyId: recipient.id,
        destinationAccountId: account.id,
        instructedAmount: 100_000_000,
        note: "دستور نمونه"
      },
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      "active"
    );

    await database.parties.bulkPut([payer, recipient]);
    await database.invoices.bulkPut([invoiceA, invoiceB]);
    await database.destinationAccounts.put(account);
    await database.paymentInstructions.put(instruction);

    const created = await repository.createPayment(
      {
        payerPartyId: payer.id,
        recipientPartyId: recipient.id,
        destinationAccountId: account.id,
        amount: 100_000_000,
        paymentDate: "2026-07-10",
        paymentMethod: "bank_transfer",
        verificationStatus: "reported",
        trackingReference: "trk-1",
        note: "پرداخت نمونه"
      },
      {
        invoiceId: invoiceA.id,
        paymentInstructionId: instruction.id,
        allocatedAmount: 50_000_000
      }
    );

    expect(created.verificationStatus).toBe("reported");
    expect(await database.payments.count()).toBe(1);
    expect(await database.paymentAllocations.count()).toBe(1);
    expect(await database.paymentVerifications.count()).toBe(0);
    expect(await database.auditEvents.count()).toBe(2);

    const verification = await repository.recordVerification(created.id, {
      verificationResult: "confirmed",
      verifierDescriptionOrPartyRef: "Ahmadi",
      verificationMethod: "receipt_review",
      note: "رسید بررسی شد"
    });
    expect(verification.verificationResult).toBe("confirmed");
    expect(await database.paymentVerifications.count()).toBe(1);
    expect((await repository.getPayment(created.id))?.verificationStatus).toBe("confirmed");

    await repository.createAllocation(created.id, {
      invoiceId: invoiceB.id,
      allocatedAmount: 50_000_000
    });

    expect(await database.paymentAllocations.count()).toBe(2);
    expect(await database.auditEvents.count()).toBe(5);

    const cancelled = await repository.cancelPayment(created.id);
    expect(cancelled.lifecycleStatus).toBe("cancelled");
    const reversed = await repository.reversePayment(created.id);
    expect(reversed.lifecycleStatus).toBe("reversed");
    expect(await database.auditEvents.count()).toBe(7);
  });

  it("blocks invalid allocations and editing confirmed history", async () => {
    const { database, repository } = createRepository();
    const payer = buildPartyRecord("party_payer", makePartyDraft("زارع"), { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" }, true);
    const recipient = buildPartyRecord("party_recipient", makePartyDraft("احمدی"), { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" }, true);
    const otherRecipient = buildPartyRecord("party_other", makePartyDraft("کرباسیان"), { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" }, true);
    const invoice = buildInvoiceRecord(
      "inv_a",
      {
        customerPartyId: payer.id,
        invoiceDate: "2026-07-10",
        totalAmount: 100_000_000,
        referenceNumber: "ف-۱",
        note: undefined
      },
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      "active"
    );
    const otherInvoice = buildInvoiceRecord(
      "inv_other",
      {
        customerPartyId: otherRecipient.id,
        invoiceDate: "2026-07-11",
        totalAmount: 100_000_000,
        referenceNumber: "ف-۲",
        note: undefined
      },
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      "active"
    );
    const account = buildDestinationAccountRecord(
      "acct_1",
      {
        ownerPartyId: recipient.id,
        accountLabel: "حساب اصلی",
        bankName: undefined,
        cardNumber: "1234567890123456",
        iban: undefined,
        bankAccountNumber: undefined
      },
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      true
    );
    const wrongAccount = buildDestinationAccountRecord(
      "acct_2",
      {
        ownerPartyId: otherRecipient.id,
        accountLabel: "حساب دیگر",
        bankName: undefined,
        cardNumber: "1234567890123457",
        iban: undefined,
        bankAccountNumber: undefined
      },
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      true
    );
    const instruction = buildPaymentInstructionRecord(
      "inst_1",
      {
        invoiceId: invoice.id,
        recipientPartyId: recipient.id,
        destinationAccountId: account.id,
        instructedAmount: 100_000_000,
        note: "دستور نمونه"
      },
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      "active"
    );
    const wrongInstruction = buildPaymentInstructionRecord(
      "inst_other",
      {
        invoiceId: otherInvoice.id,
        recipientPartyId: otherRecipient.id,
        destinationAccountId: wrongAccount.id,
        instructedAmount: 100_000_000,
        note: "دستور دیگر"
      },
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      "active"
    );
    const mismatchedInstruction = buildPaymentInstructionRecord(
      "inst_mismatch",
      {
        invoiceId: invoice.id,
        recipientPartyId: otherRecipient.id,
        destinationAccountId: wrongAccount.id,
        instructedAmount: 100_000_000,
        note: "دستور نامنطبق"
      },
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      "active"
    );

    await database.parties.bulkPut([payer, recipient, otherRecipient]);
    await database.invoices.bulkPut([invoice, otherInvoice]);
    await database.destinationAccounts.bulkPut([account, wrongAccount]);
    await database.paymentInstructions.bulkPut([instruction, wrongInstruction, mismatchedInstruction]);

    const created = await repository.createPayment({
      payerPartyId: payer.id,
      recipientPartyId: recipient.id,
      destinationAccountId: account.id,
      amount: 100_000_000,
      paymentDate: "2026-07-10",
      paymentMethod: "bank_transfer",
      verificationStatus: "reported",
      trackingReference: "trk-1",
      note: "پرداخت نمونه"
    });

    await expect(
      repository.createAllocation(created.id, {
        invoiceId: invoice.id,
        paymentInstructionId: instruction.id,
        allocatedAmount: 120_000_000
      })
    ).rejects.toThrow("مجموع تخصیص‌ها");

    await expect(
      repository.createAllocation(created.id, {
        invoiceId: otherInvoice.id,
        paymentInstructionId: instruction.id,
        allocatedAmount: 10_000_000
      })
    ).rejects.toThrow("فاکتور مشتری درست");

    await expect(
      repository.createAllocation(created.id, {
        invoiceId: invoice.id,
        paymentInstructionId: wrongInstruction.id,
        allocatedAmount: 10_000_000
      })
    ).rejects.toThrow("همان فاکتور");

    await expect(
      repository.createAllocation(created.id, {
        invoiceId: invoice.id,
        paymentInstructionId: mismatchedInstruction.id,
        allocatedAmount: 10_000_000
      })
    ).rejects.toThrow("گیرنده پرداخت");

    await expect(
      repository.createPayment({
        payerPartyId: payer.id,
        recipientPartyId: recipient.id,
        destinationAccountId: wrongAccount.id,
        amount: 10_000_000,
        paymentDate: "2026-07-10",
        paymentMethod: "bank_transfer",
        verificationStatus: "reported",
        trackingReference: "trk-2",
        note: "پرداخت با حساب نامنطبق"
      })
    ).rejects.toThrow("حساب مقصد باید متعلق به گیرنده پرداخت باشد.");

    const unallocated = await repository.createPayment({
      payerPartyId: payer.id,
      recipientPartyId: recipient.id,
      destinationAccountId: account.id,
      amount: 10_000_000,
      paymentDate: "2026-07-10",
      paymentMethod: "cash",
      verificationStatus: "reported",
      trackingReference: "trk-3",
      note: "بدون تخصیص"
    });
    expect(unallocated.lifecycleStatus).toBe("active");
    expect(await database.paymentAllocations.count()).toBe(0);

    await expect(
      repository.updatePayment(created.id, {
        payerPartyId: payer.id,
        recipientPartyId: recipient.id,
        destinationAccountId: account.id,
        amount: 100_000_000,
        paymentDate: "2026-07-10",
        paymentMethod: "bank_transfer",
        verificationStatus: "confirmed",
        trackingReference: "trk-1",
        note: "پرداخت نمونه"
      })
    ).rejects.toThrow("تغییر وضعیت تأیید");

    const cancelled = await repository.cancelPayment(created.id);
    await expect(
      repository.createAllocation(cancelled.id, {
        invoiceId: invoice.id,
        paymentInstructionId: instruction.id,
        allocatedAmount: 1_000_000
      })
    ).rejects.toThrow("تخصیص جدید نمی‌پذیرد");
  });
});
