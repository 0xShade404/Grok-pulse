import { describe, expect, it } from "vitest";
import { toDbNumeric, fromDbNumeric, fromDbNumericNullable } from "./numeric.js";

describe("toDbNumeric", () => {
  it("stringifies a plain number", () => {
    expect(toDbNumeric(0.63)).toBe("0.63");
    expect(toDbNumeric(100)).toBe("100");
    expect(toDbNumeric(-12.5)).toBe("-12.5");
  });

  it("throws for non-finite input", () => {
    expect(() => toDbNumeric(Number.NaN)).toThrow();
    expect(() => toDbNumeric(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("fromDbNumeric", () => {
  it("parses a numeric-column string back to a number", () => {
    expect(fromDbNumeric("0.6300")).toBeCloseTo(0.63);
    expect(fromDbNumeric("-12.50")).toBeCloseTo(-12.5);
    expect(fromDbNumeric("0")).toBe(0);
  });

  it("throws for an unparseable string", () => {
    expect(() => fromDbNumeric("not-a-number")).toThrow();
  });
});

describe("fromDbNumericNullable", () => {
  it("passes through null and undefined", () => {
    expect(fromDbNumericNullable(null)).toBeNull();
    expect(fromDbNumericNullable(undefined)).toBeNull();
  });

  it("parses a present value", () => {
    expect(fromDbNumericNullable("42.5")).toBe(42.5);
  });
});
