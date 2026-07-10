import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../App";
import { PartyManagement } from "./PartyManagement";
import { PartyRepository } from "../../services/party-repository";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";

function createRepository() {
  const database = new TasviehYarDatabase(`party-ui-tests-${crypto.randomUUID()}`);
  const repository = new PartyRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });

  return { database, repository };
}

describe("party management UI", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps only the party entry point enabled in the shell", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "حساب اشخاص فعال" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ثبت فاکتور فعلا آماده نیست" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ثبت پرداخت فعلا آماده نیست" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "مغایرت‌ها فعلا آماده نیست" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "حساب اشخاص" })).toBeInTheDocument();
  });

  it("creates and archives a party from the accessible RTL form", async () => {
    const user = userEvent.setup();
    const { database, repository } = createRepository();

    try {
      render(<PartyManagement repository={repository} />);

      await user.type(screen.getByLabelText("نام نمایشی"), "احمدی");
      await user.type(screen.getByLabelText("شماره تماس"), "09120000000");
      await user.type(screen.getByLabelText("نام‌های دیگر"), "آقای احمدی");
      await user.type(screen.getByLabelText("توضیح جست‌وجو"), "کشاورز");
      await user.type(screen.getByLabelText("یادداشت"), "طرف نمونه");
      await user.click(screen.getByRole("button", { name: "ثبت طرف" }));

      const createdCard = await screen.findByRole("button", { name: /احمدی/ });
      expect(createdCard).toBeInTheDocument();
      expect(within(createdCard).getByText("فعال")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /احمدی/ }));
      expect(screen.getByRole("heading", { name: "احمدی" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "بایگانی" }));
      expect(await screen.findByText("طرف بایگانی شد.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "بازیابی" })).toBeInTheDocument();
    } finally {
      await database.delete();
    }
  });
});
