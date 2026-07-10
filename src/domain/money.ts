import { z } from "zod";

export type Money = number;

export const moneySchema = z
  .number()
  .finite()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, "Money must be a safe integer.");

export function sumMoney(values: readonly Money[]): Money {
  return values.reduce((total, value) => total + value, 0);
}

export function assertMoney(value: number, label = "money"): Money {
  const parsed = moneySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${label} must be a non-negative integer toman value.`);
  }

  return parsed.data;
}
