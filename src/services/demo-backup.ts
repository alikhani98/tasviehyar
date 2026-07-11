import { TasviehYarDatabase } from "../db/tasviehyar-db";
import { createDestinationAccountRepository } from "./destination-account-repository";
import { createInvoiceRepository } from "./invoice-repository";
import { createPartyRepository } from "./party-repository";
import { createPaymentInstructionRepository } from "./payment-instruction-repository";
import { createPaymentRepository } from "./payment-repository";

export interface DemoBackupSeedResult {
  parties: {
    zare: string;
    ahmadi: string;
    rezaei: string;
    internalBusiness: string;
    bahrami: string;
    karimi: string;
  };
  destinationAccounts: {
    ahmadiPrimary: string;
    ahmadiArchived: string;
    rezaeiPrimary: string;
    internalPrimary: string;
    karimiPrimary: string;
    karimiSecondary: string;
  };
  invoices: {
    zareOutstanding: string;
    karimiSettled: string;
    zareRecipientStatement: string;
    zareOverpayment: string;
    bahramiCancelled: string;
  };
  instructions: {
    zareAhmadi: string;
    zareRezaei: string;
    karimiCustomer: string;
    karimiRecipientWithoutAccount: string;
    zareOverpayment: string;
  };
  payments: {
    zareAhmadiConfirmedFirst: string;
    zareAhmadiReported: string;
    zareAhmadiConfirmedSecond: string;
    zareAhmadiConfirmedThird: string;
    karimiSettledConfirmed: string;
    zareOverpaymentConfirmedFirst: string;
    zareOverpaymentConfirmedSecond: string;
    duplicateTrackingUnallocated: string;
    duplicateTrackingDisputed: string;
    cancelledPayment: string;
  };
}

function createDeterministicClock(startAt = "2026-07-10T08:00:00.000Z", stepMs = 60_000): () => string {
  const start = new Date(startAt).getTime();
  let index = 0;
  return () => new Date(start + index++ * stepMs).toISOString();
}

function createDeterministicIdFactory(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}_${String(++index).padStart(2, "0")}`;
}

function makeValidIranianIban(bban: string): string {
  const normalized = bban.replace(/[^\d]/g, "");
  if (normalized.length !== 22) {
    throw new Error("IBAN body must be 22 digits.");
  }

  let remainder = 0;
  for (const digit of `${normalized}182700`) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }

  return `IR${String(98 - remainder).padStart(2, "0")}${normalized}`;
}

export async function seedDemoBackupDatabase(database: TasviehYarDatabase): Promise<DemoBackupSeedResult> {
  const now = createDeterministicClock();
  const partyRepository = createPartyRepository(database, { now, createId: createDeterministicIdFactory("party") });
  const destinationAccountRepository = createDestinationAccountRepository(database, {
    now,
    createId: createDeterministicIdFactory("account")
  });
  const invoiceRepository = createInvoiceRepository(database, { now, createId: createDeterministicIdFactory("invoice") });
  const paymentInstructionRepository = createPaymentInstructionRepository(database, {
    now,
    createId: createDeterministicIdFactory("instruction")
  });
  const paymentRepository = createPaymentRepository(database, { now, createId: createDeterministicIdFactory("payment") });

  const zare = await partyRepository.createParty({
    displayName: "آقای زارع",
    aliases: ["زارع"],
    searchableDescription: "مشتری نمایشی",
    roles: ["customer"],
    phoneNumber: "09120000000",
    notes: "مشتری سناریوهای نمایشی"
  });
  const ahmadi = await partyRepository.createParty({
    displayName: "آقای احمدی",
    aliases: ["احمدی"],
    searchableDescription: "کشاورز و صاحب حساب مقصد",
    roles: ["farmer", "destination_account_owner"],
    phoneNumber: "09120000001",
    notes: "گیرنده چند حسابه"
  });
  const rezaei = await partyRepository.createParty({
    displayName: "آقای رضایی",
    aliases: ["رضایی"],
    searchableDescription: "واسطه و صاحب حساب مقصد",
    roles: ["broker", "destination_account_owner"],
    phoneNumber: "09120000002",
    notes: "واسطه پایلوت"
  });
  const internalBusiness = await partyRepository.createParty({
    displayName: "حساب مجموعه علیخانی",
    aliases: ["مجموعه علیخانی"],
    searchableDescription: "طرف داخلی کسب‌وکار",
    roles: ["internal_business_party", "destination_account_owner"],
    phoneNumber: "02100000000",
    notes: "حساب داخلی"
  });
  const bahrami = await partyRepository.createParty({
    displayName: "آقای بهرامی",
    aliases: ["بهرامی"],
    searchableDescription: "مشتری آرشیوی",
    roles: ["customer"],
    phoneNumber: "09120000003",
    notes: "برای نمونه بایگانی می‌شود"
  });
  const karimi = await partyRepository.createParty({
    displayName: "آقای کریمی",
    aliases: ["کریمی"],
    searchableDescription: "مشتری و کشاورز",
    roles: ["customer", "farmer", "destination_account_owner"],
    phoneNumber: "09120000004",
    notes: "طرف چندنقشی"
  });

  const ahmadiPrimary = await destinationAccountRepository.createAccount({
    ownerPartyId: ahmadi.id,
    accountLabel: "حساب اصلی",
    bankName: "بانک نمونه",
    cardNumber: "۱۲۳۴ ۵۶۷۸ ۹۰۱۲ ۳۴۵۶"
  });
  const ahmadiArchived = await destinationAccountRepository.createAccount({
    ownerPartyId: ahmadi.id,
    accountLabel: "حساب قدیمی",
    bankName: "بانک نمونه",
    iban: makeValidIranianIban("6279601012345678901234")
  });
  const rezaeiPrimary = await destinationAccountRepository.createAccount({
    ownerPartyId: rezaei.id,
    accountLabel: "کارت کشاورزی",
    bankName: "بانک نمونه",
    iban: makeValidIranianIban("5022291000000000000000")
  });
  const internalPrimary = await destinationAccountRepository.createAccount({
    ownerPartyId: internalBusiness.id,
    accountLabel: "حساب تسویه داخلی",
    bankName: "بانک نمونه",
    bankAccountNumber: "1234567890123"
  });
  const karimiPrimary = await destinationAccountRepository.createAccount({
    ownerPartyId: karimi.id,
    accountLabel: "حساب اصلی",
    bankName: "بانک نمونه",
    cardNumber: "۶۳۷۹ ۵۸۳۷ ۲۹۰۱ ۴۸۲۶"
  });
  const karimiSecondary = await destinationAccountRepository.createAccount({
    ownerPartyId: karimi.id,
    accountLabel: "حساب ذخیره",
    bankName: "بانک نمونه",
    bankAccountNumber: "9876543210"
  });

  await destinationAccountRepository.archiveAccount(ahmadiArchived.id);

  const zareOutstanding = await invoiceRepository.createInvoice({
    customerPartyId: zare.id,
    invoiceDate: "2026-07-01",
    totalAmount: 1_500_000_000,
    referenceNumber: "ف-زارع-01",
    note: "سناریوی اصلی"
  });
  const karimiSettled = await invoiceRepository.createInvoice({
    customerPartyId: karimi.id,
    invoiceDate: "2026-07-02",
    totalAmount: 240_000_000,
    referenceNumber: "ف-کریمی-01",
    note: "تسویه کامل"
  });
  const zareRecipientStatement = await invoiceRepository.createInvoice({
    customerPartyId: zare.id,
    invoiceDate: "2026-07-03",
    totalAmount: 130_000_000,
    referenceNumber: "ف-زارع-02",
    note: "دستور بدون حساب مقصد"
  });
  const zareOverpayment = await invoiceRepository.createInvoice({
    customerPartyId: zare.id,
    invoiceDate: "2026-07-04",
    totalAmount: 200_000_000,
    referenceNumber: "ف-زارع-03",
    note: "بیش‌پرداخت دستور"
  });
  const bahramiCancelled = await invoiceRepository.createInvoice({
    customerPartyId: bahrami.id,
    invoiceDate: "2026-07-05",
    totalAmount: 70_000_000,
    referenceNumber: "ف-بهرامی-01",
    note: "فاکتور آرشیوی"
  });

  await invoiceRepository.cancelInvoice(bahramiCancelled.id);
  await partyRepository.archiveParty(bahrami.id);

  const zareAhmadi = await paymentInstructionRepository.createInstruction({
    invoiceId: zareOutstanding.id,
    recipientPartyId: ahmadi.id,
    destinationAccountId: ahmadiPrimary.id,
    instructedAmount: 200_000_000,
    note: "دستور احمدی"
  });
  const zareRezaei = await paymentInstructionRepository.createInstruction({
    invoiceId: zareOutstanding.id,
    recipientPartyId: rezaei.id,
    destinationAccountId: rezaeiPrimary.id,
    instructedAmount: 300_000_000,
    note: "دستور رضایی"
  });
  const karimiCustomer = await paymentInstructionRepository.createInstruction({
    invoiceId: karimiSettled.id,
    recipientPartyId: ahmadi.id,
    destinationAccountId: ahmadiPrimary.id,
    instructedAmount: 240_000_000,
    note: "تکمیل شده"
  });
  const karimiRecipientWithoutAccount = await paymentInstructionRepository.createInstruction({
    invoiceId: zareRecipientStatement.id,
    recipientPartyId: karimi.id,
    instructedAmount: 40_000_000,
    note: "حساب مقصد بعدا تعیین می‌شود"
  });
  const zareOverpaymentInstruction = await paymentInstructionRepository.createInstruction({
    invoiceId: zareOverpayment.id,
    recipientPartyId: ahmadi.id,
    destinationAccountId: ahmadiPrimary.id,
    instructedAmount: 100_000_000,
    note: "دستور بیش‌پرداخت"
  });

  const zareAhmadiConfirmedFirst = await paymentRepository.createPayment(
    {
      payerPartyId: zare.id,
      recipientPartyId: ahmadi.id,
      destinationAccountId: ahmadiPrimary.id,
      amount: 50_000_000,
      paymentDate: "2026-07-06",
      paymentMethod: "bank_transfer",
      verificationStatus: "confirmed",
      trackingReference: "TRK-AHMADI-01",
      note: "پرداخت نخست"
    },
    {
      invoiceId: zareOutstanding.id,
      paymentInstructionId: zareAhmadi.id,
      allocatedAmount: 50_000_000
    }
  );
  const zareAhmadiReported = await paymentRepository.createPayment(
    {
      payerPartyId: zare.id,
      recipientPartyId: ahmadi.id,
      destinationAccountId: ahmadiPrimary.id,
      amount: 30_000_000,
      paymentDate: "2026-07-06",
      paymentMethod: "bank_transfer",
      verificationStatus: "reported",
      trackingReference: "TRK-AHMADI-02",
      note: "پرداخت اعلام‌شده"
    },
    {
      invoiceId: zareOutstanding.id,
      paymentInstructionId: zareAhmadi.id,
      allocatedAmount: 30_000_000
    }
  );
  const zareAhmadiConfirmedSecond = await paymentRepository.createPayment(
    {
      payerPartyId: zare.id,
      recipientPartyId: ahmadi.id,
      destinationAccountId: ahmadiPrimary.id,
      amount: 100_000_000,
      paymentDate: "2026-07-06",
      paymentMethod: "bank_transfer",
      verificationStatus: "confirmed",
      trackingReference: "TRK-AHMADI-03",
      note: "پرداخت دوم"
    },
    {
      invoiceId: zareOutstanding.id,
      paymentInstructionId: zareAhmadi.id,
      allocatedAmount: 100_000_000
    }
  );
  const zareAhmadiConfirmedThird = await paymentRepository.createPayment(
    {
      payerPartyId: zare.id,
      recipientPartyId: ahmadi.id,
      destinationAccountId: ahmadiPrimary.id,
      amount: 20_000_000,
      paymentDate: "2026-07-06",
      paymentMethod: "bank_transfer",
      verificationStatus: "confirmed",
      trackingReference: "TRK-AHMADI-04",
      note: "پرداخت سوم"
    },
    {
      invoiceId: zareOutstanding.id,
      paymentInstructionId: zareAhmadi.id,
      allocatedAmount: 20_000_000
    }
  );
  const karimiSettledConfirmed = await paymentRepository.createPayment(
    {
      payerPartyId: karimi.id,
      recipientPartyId: ahmadi.id,
      destinationAccountId: ahmadiPrimary.id,
      amount: 240_000_000,
      paymentDate: "2026-07-07",
      paymentMethod: "bank_transfer",
      verificationStatus: "reported",
      trackingReference: "TRK-KARIMI-01",
      note: "پرداخت تکمیل‌شونده"
    },
    {
      invoiceId: karimiSettled.id,
      paymentInstructionId: karimiCustomer.id,
      allocatedAmount: 240_000_000
    }
  );
  await paymentRepository.recordVerification(karimiSettledConfirmed.id, {
    verificationResult: "confirmed",
    verifierDescriptionOrPartyRef: "اپراتور نمایشی",
    verificationMethod: "receipt_review",
    note: "تأیید پس از ثبت اولیه"
  });

  const zareOverpaymentConfirmedFirst = await paymentRepository.createPayment(
    {
      payerPartyId: zare.id,
      recipientPartyId: ahmadi.id,
      destinationAccountId: ahmadiPrimary.id,
      amount: 80_000_000,
      paymentDate: "2026-07-08",
      paymentMethod: "bank_transfer",
      verificationStatus: "confirmed",
      trackingReference: "TRK-OVERPAY-01",
      note: "بخش اول بیش‌پرداخت"
    },
    {
      invoiceId: zareOverpayment.id,
      paymentInstructionId: zareOverpaymentInstruction.id,
      allocatedAmount: 80_000_000
    }
  );
  const zareOverpaymentConfirmedSecond = await paymentRepository.createPayment(
    {
      payerPartyId: zare.id,
      recipientPartyId: ahmadi.id,
      destinationAccountId: ahmadiPrimary.id,
      amount: 60_000_000,
      paymentDate: "2026-07-08",
      paymentMethod: "bank_transfer",
      verificationStatus: "confirmed",
      trackingReference: "TRK-OVERPAY-02",
      note: "بخش دوم بیش‌پرداخت"
    },
    {
      invoiceId: zareOverpayment.id,
      paymentInstructionId: zareOverpaymentInstruction.id,
      allocatedAmount: 60_000_000
    }
  );

  const duplicateTrackingUnallocated = await paymentRepository.createPayment({
    payerPartyId: zare.id,
    recipientPartyId: internalBusiness.id,
    destinationAccountId: internalPrimary.id,
    amount: 25_000_000,
    paymentDate: "2026-07-09",
    paymentMethod: "bank_transfer",
    verificationStatus: "reported",
    trackingReference: "TRK-REVIEW-01",
    note: "پرداخت بدون تخصیص"
  });
  const duplicateTrackingDisputed = await paymentRepository.createPayment({
    payerPartyId: zare.id,
    recipientPartyId: internalBusiness.id,
    destinationAccountId: internalPrimary.id,
    amount: 35_000_000,
    paymentDate: "2026-07-09",
    paymentMethod: "bank_transfer",
    verificationStatus: "disputed",
    trackingReference: "trk review 01",
    note: "پرداخت مورد اختلاف"
  });

  const cancelledPayment = await paymentRepository.createPayment({
    payerPartyId: zare.id,
    recipientPartyId: ahmadi.id,
    destinationAccountId: ahmadiPrimary.id,
    amount: 12_000_000,
    paymentDate: "2026-07-09",
    paymentMethod: "bank_transfer",
    verificationStatus: "reported",
    trackingReference: "TRK-CANCEL-01",
    note: "پرداخت لغوشده"
  });
  await paymentRepository.cancelPayment(cancelledPayment.id);

  return {
    parties: {
      zare: zare.id,
      ahmadi: ahmadi.id,
      rezaei: rezaei.id,
      internalBusiness: internalBusiness.id,
      bahrami: bahrami.id,
      karimi: karimi.id
    },
    destinationAccounts: {
      ahmadiPrimary: ahmadiPrimary.id,
      ahmadiArchived: ahmadiArchived.id,
      rezaeiPrimary: rezaeiPrimary.id,
      internalPrimary: internalPrimary.id,
      karimiPrimary: karimiPrimary.id,
      karimiSecondary: karimiSecondary.id
    },
    invoices: {
      zareOutstanding: zareOutstanding.id,
      karimiSettled: karimiSettled.id,
      zareRecipientStatement: zareRecipientStatement.id,
      zareOverpayment: zareOverpayment.id,
      bahramiCancelled: bahramiCancelled.id
    },
    instructions: {
      zareAhmadi: zareAhmadi.id,
      zareRezaei: zareRezaei.id,
      karimiCustomer: karimiCustomer.id,
      karimiRecipientWithoutAccount: karimiRecipientWithoutAccount.id,
      zareOverpayment: zareOverpaymentInstruction.id
    },
    payments: {
      zareAhmadiConfirmedFirst: zareAhmadiConfirmedFirst.id,
      zareAhmadiReported: zareAhmadiReported.id,
      zareAhmadiConfirmedSecond: zareAhmadiConfirmedSecond.id,
      zareAhmadiConfirmedThird: zareAhmadiConfirmedThird.id,
      karimiSettledConfirmed: karimiSettledConfirmed.id,
      zareOverpaymentConfirmedFirst: zareOverpaymentConfirmedFirst.id,
      zareOverpaymentConfirmedSecond: zareOverpaymentConfirmedSecond.id,
      duplicateTrackingUnallocated: duplicateTrackingUnallocated.id,
      duplicateTrackingDisputed: duplicateTrackingDisputed.id,
      cancelledPayment: cancelledPayment.id
    }
  };
}
