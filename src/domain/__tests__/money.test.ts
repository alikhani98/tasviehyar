import { describe, expect, it } from "vitest";
import { assertMoney, moneySchema } from "../money";

describe("money validation", () => {
  it("accepts safe integer toman values", () => {
    expect(moneySchema.parse(0)).toBe(0);
    expect(moneySchema.parse(1_500_000_000)).toBe(1_500_000_000);
    expect(assertMoney(42)).toBe(42);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, -1, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid money value %s",
    (value) => {
      expect(() => moneySchema.parse(value)).toThrow();
      expect(() => assertMoney(value)).toThrow();
    }
  );
});
