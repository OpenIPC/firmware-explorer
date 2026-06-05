import type { KconfigGraph, KconfigHelp, Source } from "./types";

// ---------------------------------------------------------------------------
// Same-origin fetchers
// ---------------------------------------------------------------------------

export function kconfigGraphUrl(source: Source, platform: string): string {
  return `./data/${source}/kconfig/kconfig-graph.${platform}.json`;
}

export function kconfigHelpUrl(source: Source, platform: string): string {
  return `./data/${source}/kconfig/kconfig-help.${platform}.json`;
}

const graphCache = new Map<string, Promise<KconfigGraph>>();
const helpCache = new Map<string, Promise<KconfigHelp>>();

export function fetchKconfigGraph(
  source: Source,
  platform: string,
): Promise<KconfigGraph> {
  const url = kconfigGraphUrl(source, platform);
  let p = graphCache.get(url);
  if (!p) {
    p = (async () => {
      const r = await fetch(url, { cache: "force-cache" });
      if (!r.ok) throw new Error(`kconfig: HTTP ${r.status} from ${url}`);
      return (await r.json()) as KconfigGraph;
    })().catch((e) => {
      graphCache.delete(url);
      throw e;
    });
    graphCache.set(url, p);
  }
  return p;
}

export function fetchKconfigHelp(
  source: Source,
  platform: string,
): Promise<KconfigHelp> {
  const url = kconfigHelpUrl(source, platform);
  let p = helpCache.get(url);
  if (!p) {
    p = (async () => {
      const r = await fetch(url, { cache: "force-cache" });
      if (!r.ok) throw new Error(`kconfig-help: HTTP ${r.status} from ${url}`);
      return (await r.json()) as KconfigHelp;
    })().catch((e) => {
      helpCache.delete(url);
      throw e;
    });
    helpCache.set(url, p);
  }
  return p;
}

export function clearKconfigCache(): void {
  graphCache.clear();
  helpCache.clear();
}

// ---------------------------------------------------------------------------
// Dependency closure
// ---------------------------------------------------------------------------


export type CloseDisableResult = {
  /** All symbols that end up disabled, including user picks + cascade. */
  disabled: Set<string>;
  /**
   * Symbols the user *wanted* disabled but can't be — because some
   * currently-set symbol *outside* the disable closure still hard-`select`s
   * them. Value = the still-enabled selectors blocking the disable.
   */
  blocked: Map<string, string[]>;
};

/**
 * Given the graph and the symbols the user wants to disable, compute the full
 * disable closure under select-cascade semantics.
 *
 * The rule, matching Kconfig's actual behaviour:
 *   • If you disable symbol X, every symbol that X `select`s becomes a candidate
 *     for disable too — but only IF nothing *else* still-enabled also selects it.
 *   • If something does, X's disable is *blocked*: telling Kconfig to drop X
 *     would silently leave it on, because Kconfig honours the surviving select.
 *
 * The function is pure (no mutation of inputs) and order-independent.
 */
export function closeDisable(
  graph: KconfigGraph,
  userWantsDisabled: ReadonlySet<string>,
): CloseDisableResult {
  const disabled = new Set<string>();
  const blocked = new Map<string, string[]>();

  // Iterate to fixed point: every pass adds anything newly disable-able given
  // the current `disabled` set. Bounded by symbol count, so worst-case O(n²).
  let changed = true;
  let pending = new Set(userWantsDisabled);

  while (changed) {
    changed = false;
    const nextPending = new Set<string>();

    for (const name of pending) {
      const sym = graph.symbols[name];
      if (!sym) {
        // Unknown symbol → silently drop. Could be a stale URL query
        // pointing at a symbol that no longer exists in this build.
        continue;
      }

      // Surviving (currently-set ∧ not-yet-disabled-by-us ∧ not-the-target)
      // hard-selectors of `name`. If any exist, we can't disable `name`.
      const survivors = sym.selected_by.filter(
        (s) => !disabled.has(s) && s !== name,
      );

      if (survivors.length > 0) {
        blocked.set(name, survivors);
        continue;
      }

      if (!disabled.has(name)) {
        disabled.add(name);
        changed = true;
        // Cascade: this symbol's `selects` become candidates next pass.
        for (const target of sym.selects) {
          if (!disabled.has(target)) nextPending.add(target);
        }
      }
    }

    pending = nextPending;
    if (pending.size > 0) changed = true;
  }

  // Re-check blocked: a symbol previously blocked may now be unblocked because
  // all its survivors ended up disabled later in the cascade.
  let reUnblocked = true;
  while (reUnblocked) {
    reUnblocked = false;
    for (const [name, survivors] of blocked) {
      const stillSurviving = survivors.filter(
        (s) => !disabled.has(s) && s !== name,
      );
      if (stillSurviving.length === 0) {
        blocked.delete(name);
        disabled.add(name);
        reUnblocked = true;
        const sym = graph.symbols[name];
        if (sym) {
          for (const target of sym.selects) {
            if (!disabled.has(target)) {
              // Re-evaluate this target next sweep.
              blocked.delete(target);
            }
          }
        }
      } else if (stillSurviving.length !== survivors.length) {
        blocked.set(name, stillSurviving);
      }
    }
  }

  return { disabled, blocked };
}

/**
 * Render the disabled set as a Buildroot defconfig fragment that the user can
 * append to their board defconfig. Each line `# BR2_PACKAGE_FOO is not set`
 * follows Kconfig's serialisation convention. Output is deterministic
 * (sorted by symbol name) so two browsers with the same selection produce
 * byte-identical files.
 */
export function defconfigFragment(
  graph: KconfigGraph,
  disabled: ReadonlySet<string>,
): string {
  const lines: string[] = [];
  lines.push("# Generated by https://openipc.github.io/firmware-explorer/");
  lines.push(`# Board: ${graph.board}-${graph.variant}`);
  lines.push("# Append these lines to your board defconfig, then re-run defconfig.");
  lines.push("");

  const sorted = [...disabled].sort();
  for (const name of sorted) {
    // Only emit symbols we know about — protects against URL-injected garbage.
    if (graph.symbols[name]) {
      lines.push(`# ${name} is not set`);
    }
  }
  return lines.join("\n") + "\n";
}
