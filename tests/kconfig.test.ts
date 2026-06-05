import { describe, expect, it } from "vitest";
import { closeDisable, defconfigFragment } from "../src/lib/kconfig";
import type { KconfigGraph, KconfigSymbol } from "../src/lib/types";

const sym = (over: Partial<KconfigSymbol> = {}): KconfigSymbol => ({
  package: null,
  type: "bool",
  prompt: null,
  depends_on: [],
  selects: [],
  selected_by: [],
  direct_dep_expr: "y",
  ...over,
});

function graph(symbols: Record<string, KconfigSymbol>): KconfigGraph {
  return {
    schema: 1,
    board: "test",
    variant: "t",
    br_ver: "x",
    symbol_prefix: "BR2_",
    symbol_count: Object.keys(symbols).length,
    skipped_no_node: 0,
    symbols,
  };
}

describe("closeDisable", () => {
  it("returns nothing for an empty user-disable set", () => {
    const g = graph({
      BR2_PACKAGE_FOO: sym({ package: "foo", prompt: "foo" }),
    });
    const r = closeDisable(g, new Set());
    expect(r.disabled.size).toBe(0);
    expect(r.blocked.size).toBe(0);
  });

  it("disables a leaf symbol with no cascade", () => {
    const g = graph({
      BR2_PACKAGE_FOO: sym({ package: "foo", prompt: "foo" }),
    });
    const r = closeDisable(g, new Set(["BR2_PACKAGE_FOO"]));
    expect([...r.disabled]).toEqual(["BR2_PACKAGE_FOO"]);
    expect(r.blocked.size).toBe(0);
  });

  it("cascades selects: disabling FOO drops BAR if FOO was BAR's only selector", () => {
    const g = graph({
      BR2_PACKAGE_FOO: sym({
        package: "foo",
        selects: ["BR2_PACKAGE_BAR"],
      }),
      BR2_PACKAGE_BAR: sym({
        package: "bar",
        selected_by: ["BR2_PACKAGE_FOO"],
      }),
    });
    const r = closeDisable(g, new Set(["BR2_PACKAGE_FOO"]));
    expect([...r.disabled].sort()).toEqual([
      "BR2_PACKAGE_BAR",
      "BR2_PACKAGE_FOO",
    ]);
    expect(r.blocked.size).toBe(0);
  });

  it("refuses cascade if BAR is also selected by something still enabled", () => {
    const g = graph({
      BR2_PACKAGE_FOO: sym({ selects: ["BR2_PACKAGE_BAR"] }),
      BR2_PACKAGE_BAZ: sym({ selects: ["BR2_PACKAGE_BAR"] }),
      BR2_PACKAGE_BAR: sym({
        selected_by: ["BR2_PACKAGE_FOO", "BR2_PACKAGE_BAZ"],
      }),
    });
    const r = closeDisable(g, new Set(["BR2_PACKAGE_FOO"]));
    expect(r.disabled.has("BR2_PACKAGE_FOO")).toBe(true);
    expect(r.disabled.has("BR2_PACKAGE_BAR")).toBe(false);
    expect(r.blocked.get("BR2_PACKAGE_BAR")).toEqual(["BR2_PACKAGE_BAZ"]);
  });

  it("unblocks BAR once both selectors get disabled", () => {
    const g = graph({
      BR2_PACKAGE_FOO: sym({ selects: ["BR2_PACKAGE_BAR"] }),
      BR2_PACKAGE_BAZ: sym({ selects: ["BR2_PACKAGE_BAR"] }),
      BR2_PACKAGE_BAR: sym({
        selected_by: ["BR2_PACKAGE_FOO", "BR2_PACKAGE_BAZ"],
      }),
    });
    const r = closeDisable(
      g,
      new Set(["BR2_PACKAGE_FOO", "BR2_PACKAGE_BAZ"]),
    );
    expect([...r.disabled].sort()).toEqual([
      "BR2_PACKAGE_BAR",
      "BR2_PACKAGE_BAZ",
      "BR2_PACKAGE_FOO",
    ]);
    expect(r.blocked.size).toBe(0);
  });

  it("cascades through chained selects", () => {
    const g = graph({
      BR2_PACKAGE_A: sym({ selects: ["BR2_PACKAGE_B"] }),
      BR2_PACKAGE_B: sym({
        selects: ["BR2_PACKAGE_C"],
        selected_by: ["BR2_PACKAGE_A"],
      }),
      BR2_PACKAGE_C: sym({ selected_by: ["BR2_PACKAGE_B"] }),
    });
    const r = closeDisable(g, new Set(["BR2_PACKAGE_A"]));
    expect([...r.disabled].sort()).toEqual([
      "BR2_PACKAGE_A",
      "BR2_PACKAGE_B",
      "BR2_PACKAGE_C",
    ]);
  });

  it("ignores unknown symbols silently", () => {
    const g = graph({
      BR2_PACKAGE_KNOWN: sym(),
    });
    const r = closeDisable(g, new Set(["BR2_PACKAGE_GHOST"]));
    expect(r.disabled.size).toBe(0);
    expect(r.blocked.size).toBe(0);
  });
});

describe("defconfigFragment", () => {
  it("emits sorted `# X is not set` lines for known symbols only", () => {
    const g = graph({
      BR2_PACKAGE_A: sym(),
      BR2_PACKAGE_B: sym(),
      BR2_PACKAGE_C: sym(),
    });
    const text = defconfigFragment(
      g,
      new Set(["BR2_PACKAGE_C", "BR2_PACKAGE_A", "BR2_PACKAGE_GHOST"]),
    );
    const lines = text.split("\n").filter((l) => l.startsWith("# BR2_"));
    expect(lines).toEqual([
      "# BR2_PACKAGE_A is not set",
      "# BR2_PACKAGE_C is not set",
    ]);
  });

  it("output is deterministic across two calls with the same input", () => {
    const g = graph({
      BR2_PACKAGE_A: sym(),
      BR2_PACKAGE_B: sym(),
    });
    const a = defconfigFragment(g, new Set(["BR2_PACKAGE_A", "BR2_PACKAGE_B"]));
    const b = defconfigFragment(g, new Set(["BR2_PACKAGE_B", "BR2_PACKAGE_A"]));
    expect(a).toBe(b);
  });

  it("includes a generator stamp + board / variant header", () => {
    const g = graph({ BR2_PACKAGE_X: sym() });
    const text = defconfigFragment(g, new Set(["BR2_PACKAGE_X"]));
    expect(text).toContain("openipc.github.io/firmware-explorer");
    expect(text).toContain("test-t");
  });
});
