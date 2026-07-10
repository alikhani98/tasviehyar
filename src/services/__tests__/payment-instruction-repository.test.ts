import { afterEach, describe, expect, it } from "vitest";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";
import { buildPartyRecord, type PartyDraft } from "../../domain/parties";
import { buildInvoiceRecord } from "../../domain/invoices";
import { buildDestinationAccountRecord } from "../../domain/destination-accounts";
import { createPaymentInstructionRepository } from "../payment-instruction-repository";

const databases: TasviehYarDatabase[] = [];

function createRepository() {
  const database = new TasviehYarDatabase(`payment-instruction-tests-${crypto.randomUUID()}`);
  const repository = createPaymentInstructionRepository(database, {
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

describe("payment instruction repository", () => {
  it("creates, updates, cancels, restores, and audits instructions atomically", async () => {
    const { database, repository } = createRepository();
    const customer = buildPartyRecord("party_customer", makePartyDraft("زارع"), { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" }, true);
    const recipient = buildPartyRecord("party_recipient", makePartyDraft("احمدی"), { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" }, true);
    const invoice = buildInvoiceRecord(
      "inv_1",
      {
        customerPartyId: customer.id,
        invoiceDate: "2026-07-10",
        totalAmount: 300_000_000,
        referenceNumber: "ف-۱",
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

    await database.parties.bulkPut([customer, recipient]);
    await database.invoices.put(invoice);
    await database.destinationAccounts.put(account);

    const created = await repository.createInstruction({
      invoiceId: invoice.id,
      recipientPartyId: recipient.id,
      destinationAccountId: account.id,
      instructedAmount: 100_000_000,
      note: "دستور نمونه"
    });

    expect(created.lifecycleStatus).toBe("active");
    expect(await database.paymentInstructions.count()).toBe(1);
    expect(await database.auditEvents.count()).toBe(1);

    const updated = await repository.updateInstruction(created.id, {
      invoiceId: invoice.id,
      recipientPartyId: recipient.id,
      destinationAccountId: account.id,
      instructedAmount: 150_000_000,
      note: "ویرایش شده"
    });

    expect(updated.instructedAmount).toBe(150_000_000);
    expect(await database.auditEvents.count()).toBe(2);

    const cancelled = await repository.cancelInstruction(created.id);
    expect(cancelled.lifecycleStatus).toBe("cancelled");
    expect(await database.auditEvents.count()).toBe(3);

    const restored = await repository.restoreInstruction(created.id);
    expect(restored.lifecycleStatus).toBe("active");
    expect(await database.auditEvents.count()).toBe(4);
  });

  it("blocks invalid recipients, wrong account ownership, and totals above the invoice", async () => {
    const { database, repository } = createRepository();
    const customer = buildPartyRecord("party_customer", makePartyDraft("زارع"), { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" }, true);
    const recipient = buildPartyRecord("party_recipient", makePartyDraft("احمدی"), { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" }, false);
    const invoice = buildInvoiceRecord(
      "inv_1",
      {
        customerPartyId: customer.id,
        invoiceDate: "2026-07-10",
        totalAmount: 100_000_000,
        referenceNumber: "ف-۱",
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

    await database.parties.bulkPut([customer, recipient]);
    await database.invoices.put(invoice);
    await database.destinationAccounts.put(account);

    await expect(
      repository.createInstruction({
        invoiceId: invoice.id,
        recipientPartyId: recipient.id,
        destinationAccountId: account.id,
        instructedAmount: 10_000_000,
        note: "دستور نمونه"
      })
    ).rejects.toThrow("طرف باید فعال باشد");

    await database.parties.update(recipient.id, { active: true });

    await expect(
      repository.createInstruction({
        invoiceId: invoice.id,
        recipientPartyId: recipient.id,
        destinationAccountId: "missing",
        instructedAmount: 10_000_000,
        note: "دستور نمونه"
      })
    ).rejects.toThrow("حساب مقصد یافت نشد");

    await expect(
      repository.createInstruction({
        invoiceId: invoice.id,
        recipientPartyId: recipient.id,
        destinationAccountId: account.id,
        instructedAmount: 120_000_000,
        note: "دستور نمونه"
      })
    ).rejects.toThrow("مجموع دستورهای فعال");
  });

  it("keeps archived recipients visible but blocks new instructions for cancelled invoices", async () => {
    const { database, repository } = createRepository();
    const customer = buildPartyRecord("party_customer", makePartyDraft("زارع"), { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" }, true);
    const recipient = buildPartyRecord("party_recipient", makePartyDraft("احمدی"), { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" }, true);
    const invoice = buildInvoiceRecord(
      "inv_1",
      {
        customerPartyId: customer.id,
        invoiceDate: "2026-07-10",
        totalAmount: 100_000_000,
        referenceNumber: "ف-۱",
        note: undefined
      },
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      "cancelled"
    );

    await database.parties.bulkPut([customer, recipient]);
    await database.invoices.put(invoice);

    await expect(
      repository.createInstruction({
        invoiceId: invoice.id,
        recipientPartyId: recipient.id,
        instructedAmount: 10_000_000,
        note: "دستور نمونه"
      })
    ).rejects.toThrow("فاکتور لغوشده فقط خواندنی است");
  });
});
