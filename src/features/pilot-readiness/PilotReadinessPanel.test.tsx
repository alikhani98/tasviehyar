import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackupHistorySummary, BackupPreview } from "../../domain/backup";
import { PilotReadinessPanel } from "./PilotReadinessPanel";

function makeCounts(): BackupPreview["recordCounts"] {
  return {
    parties: 3,
    destinationAccounts: 2,
    invoices: 1,
    paymentInstructions: 2,
    payments: 4,
    paymentAllocations: 4,
    paymentVerifications: 3,
    auditEvents: 12
  };
}

function createService(history: BackupHistorySummary = { entries: [], lastBackup: null, lastRestore: null }) {
  return {
    getCurrentRecordCounts: vi.fn(async () => makeCounts()),
    getHistorySummary: vi.fn(() => history)
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("pilot readiness panel", () => {
  it("shows local counts, version, and backup reminders", async () => {
    const service = createService({
      entries: [],
      lastBackup: null,
      lastRestore: null
    });

    render(<PilotReadinessPanel service={service} />);

    expect(await screen.findByText(/طرف‌ها: ۳/)).toBeInTheDocument();
    expect(screen.getByText("نسخه برنامه: 0.0.0")).toBeInTheDocument();
    expect(screen.getByText(/دفتر کاغذی/)).toBeInTheDocument();
    expect(screen.getByText("آنلاین")).toBeInTheDocument();
  });

  it("switches to an offline indicator when the browser goes offline", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const service = createService();

    render(<PilotReadinessPanel service={service} />);

    expect(await screen.findByText(/تخصیص‌ها:/)).toBeInTheDocument();
    expect(screen.getByText("آفلاین")).toBeInTheDocument();
  });
});
