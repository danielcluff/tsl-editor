import { describe, expect, it } from "vitest";
import { fmtValue } from "../src/app/editor/format";

const FS = " "; // figure space: digit-wide, stands in for the minus sign

describe("value readout formatting", () => {
  it("always shows 3 decimals", () => {
    expect(fmtValue(0.5)).toBe(`${FS}0.500`);
    expect(fmtValue(1)).toBe(`${FS}1.000`);
    expect(fmtValue(0.12345)).toBe(`${FS}0.123`);
    expect(fmtValue(0)).toBe(`${FS}0.000`);
  });

  it("keeps the same width when the sign flips", () => {
    expect(fmtValue(-0.5)).toBe("-0.500");
    expect(fmtValue(-0.5).length).toBe(fmtValue(0.5).length);
    expect(fmtValue(-0.0001)).toBe(`${FS}0.000`); // no "-0.000"
  });

  it("uses exponents for huge values and names non-finite ones", () => {
    expect(fmtValue(123456)).toBe(`${FS}1.23e+5`);
    expect(fmtValue(NaN)).toBe("NaN");
    expect(fmtValue(-Infinity)).toBe("-∞");
  });
});
