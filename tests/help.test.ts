import { describe, expect, it } from "vitest";
import { HelpPanel } from "../src/components/HelpPanel";

// Smoke tests — assert the HelpPanel module loads, exports the component,
// and the body content covers the headline topics every help system should
// mention. We're not trying to render the JSX into jsdom here; the goal is
// only that future refactors don't accidentally strip a section out, and
// that the export surface stays stable.

describe("HelpPanel module", () => {
  it("exports HelpPanel as a function component", () => {
    expect(typeof HelpPanel).toBe("function");
  });

  // The component itself can't be string-introspected for content. Instead,
  // we verify the topical coverage by reading the source file once at test
  // time. A bit hacky but cheaper than booting jsdom for this one assert,
  // and it cleanly fails when someone deletes a section heading.
  it("covers all required topical headings", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/components/HelpPanel.tsx"),
      "utf8",
    );
    const requiredHeadings = [
      "What this tool is",
      "First-time orientation",
      "Tab-by-tab tour",
      "Concepts",
      "URL state and sharing",
      "Data freshness and retention",
      "Troubleshooting",
      "Glossary",
      "Architecture",
      "Roadmap and limitations",
    ];
    for (const h of requiredHeadings) {
      expect(src, `missing section: ${h}`).toContain(h);
    }
  });

  it("references every visible tab so users can find docs for what they're looking at", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/components/HelpPanel.tsx"),
      "utf8",
    );
    const tabHeadings = [
      "Treemap",
      "Packages",
      "Modules",
      "Removed-by-finalize",
      "Drift vs another build",
      "Configure (what-if)",
      "Trends",
    ];
    for (const tab of tabHeadings) {
      expect(src, `missing tab docs: ${tab}`).toContain(tab);
    }
  });
});
