import { describe, expect, it } from "vitest";
import { convertAnyValue, literalType } from "../src/core/graph";
import { literal } from "../src/core/codegen";

describe("any-input type picker", () => {
  it("spreads a scalar into every vector component", () => {
    expect(convertAnyValue(0.5, "vec3")).toEqual([0.5, 0.5, 0.5]);
    expect(convertAnyValue(2, "vec2")).toEqual([2, 2]);
  });

  it("pads or truncates vectors", () => {
    expect(convertAnyValue([1, 2], "vec4")).toEqual([1, 2, 0, 0]);
    expect(convertAnyValue([1, 2, 3, 4], "vec2")).toEqual([1, 2]);
    expect(convertAnyValue([3, 4], "float")).toBe(3);
  });

  it("round-trips colors through vectors", () => {
    expect(convertAnyValue("#ff8000", "vec3")).toEqual([1, 0.502, 0]);
    expect(convertAnyValue([1, 0.5, 0], "color")).toBe("#ff8000");
    expect(convertAnyValue(1, "color")).toBe("#ffffff");
    expect(convertAnyValue(3, "color")).toBe("#ffffff"); // clamped
  });

  it("converts to and from bool", () => {
    expect(convertAnyValue(0, "bool")).toBe(false);
    expect(convertAnyValue([0, 0.1], "bool")).toBe(true);
    expect(convertAnyValue(true, "vec2")).toEqual([1, 1]);
  });

  it("every picked type compiles to the matching TSL literal", () => {
    for (const [to, expected] of [
      ["float", "float(1)"],
      ["vec2", "vec2(1, 1)"],
      ["vec3", "vec3(1, 1, 1)"],
      ["vec4", "vec4(1, 1, 1, 1)"],
      ["color", `color("#ffffff")`],
      ["bool", "bool(true)"],
    ] as const) {
      const v = convertAnyValue(1, to);
      expect(literalType(v)).toBe(to);
      expect(literal(v, "any", { node: true })).toBe(expected);
    }
  });
});
