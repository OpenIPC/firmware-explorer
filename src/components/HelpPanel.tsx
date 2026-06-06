import { useEffect, useMemo } from "react";

/**
 * Full-screen help overlay. Closes on ESC, backdrop click, or the X button.
 * Content is structured as section components so we can wire deep-anchor
 * navigation from outside (e.g. clicking a `?` chip next to a control could
 * scroll to a specific section in a follow-up).
 */
type Props = {
  onClose: () => void;
};

export function HelpPanel({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("help-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("help-open");
    };
  }, [onClose]);

  const sections = useMemo(
    () => [
      ["orientation", "First-time orientation (90 seconds)"],
      ["tabs", "Tab-by-tab tour"],
      ["concepts", "Concepts"],
      ["url-state", "URL state and sharing"],
      ["freshness", "Data freshness and retention"],
      ["troubleshooting", "Troubleshooting"],
      ["glossary", "Glossary"],
      ["architecture", "Architecture (for the curious)"],
      ["roadmap", "Roadmap and limitations"],
    ] as const,
    [],
  );

  return (
    <div className="help-overlay" role="dialog" aria-modal="true" aria-label="Help">
      <div className="help-backdrop" onClick={onClose} />
      <div className="help-window">
        <header className="help-header">
          <h2>OpenIPC firmware explorer — help</h2>
          <button
            className="help-close"
            onClick={onClose}
            aria-label="Close help (Esc)"
            title="Close (Esc)"
          >
            ×
          </button>
        </header>

        <div className="help-body">
          <aside className="help-toc" aria-label="Help table of contents">
            <ol>
              {sections.map(([id, label]) => (
                <li key={id}>
                  <a href={`#help-${id}`}>{label}</a>
                </li>
              ))}
            </ol>
            <p className="muted help-meta">
              Press <kbd>Esc</kbd> to close · close also clears <code>?help=1</code> from the URL.
            </p>
          </aside>

          <article className="help-content">
            <Intro />
            <Orientation />
            <Tabs />
            <Concepts />
            <UrlState />
            <Freshness />
            <Troubleshooting />
            <Glossary />
            <Architecture />
            <Roadmap />
          </article>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content sections
// ---------------------------------------------------------------------------

function Intro() {
  return (
    <section className="help-section">
      <h3>What this tool is</h3>
      <p>
        firmware-explorer is a read-only viewer for OpenIPC firmware build
        composition. Pick a board and you can see exactly which packages and
        kernel modules ship in the rootfs, how much space each takes, how
        the totals have moved over the retention window, and — for boards
        where the data is available — interactively model what would happen
        if you disabled some packages. From there you can either download a
        Buildroot defconfig fragment to apply locally or open a pre-filled
        build-request issue on <code>OpenIPC/builder</code> for a
        maintainer to dispatch.
      </p>
      <p className="muted">
        The data comes from <code>sizes.<i>plat</i>.json</code> and{" "}
        <code>kconfig-graph.<i>plat</i>.json</code> assets published with
        each nightly release of OpenIPC/firmware and OpenIPC/builder.
        Everything in this tool is computed from those files — no live
        access to a camera or a build server.
      </p>
    </section>
  );
}

function Orientation() {
  return (
    <section id="help-orientation" className="help-section">
      <h3>First-time orientation (90 seconds)</h3>
      <ol className="help-steps">
        <li>
          <strong>Pick a source.</strong> The <em>firmware</em> tab in the
          header lists nightlies of <code>OpenIPC/firmware</code> (per board
          × variant — e.g. <code>hi3518ev300-lite</code>). <em>builder</em>{" "}
          lists nightlies of <code>OpenIPC/builder</code> (per device —
          often compound names like{" "}
          <code>gk7205v200_lite_tiandy-tc-c321n</code>).
        </li>
        <li>
          <strong>Pick a build.</strong> Newest is pre-selected. Build IDs
          look like <code>nightly-YYYYMMDD-shortsha</code>.
        </li>
        <li>
          <strong>Pick a platform.</strong> Only platforms that produced a
          sizes shard on this build are listed.
        </li>
        <li>
          <strong>Flip through the tabs.</strong>{" "}
          <em>Treemap</em> for a glance at what dominates the rootfs;{" "}
          <em>Packages</em> / <em>Modules</em> for sortable detail;{" "}
          <em>Drift</em> to compare against another build;{" "}
          <em>Trends</em> for the long view;{" "}
          <em>Configure</em> to model removals.
        </li>
      </ol>
    </section>
  );
}

function Tabs() {
  return (
    <section id="help-tabs" className="help-section">
      <h3>Tab-by-tab tour</h3>

      <h4>Treemap</h4>
      <p>
        Each rectangle is a package; area is proportional to the package's{" "}
        <em>uncompressed</em> bytes on the rootfs. Colour groups by category
        (vendor SDK / kernel / userspace / toolchain / overlay) using the
        rules in <code>src/lib/categorise.ts</code>. Hover a rectangle for
        the exact byte total. Used to identify the dominant packages at a
        glance — vendor SDKs and the kernel usually claim the most area.
      </p>

      <h4>Packages</h4>
      <p>
        Sortable table of every package in the build. Columns: name,
        uncompressed bytes, an approximation of the compressed contribution
        (<code>compressed_bytes_approx</code> — based on the rootfs's global
        squashfs ratio), and the file count. Click any row to expand its
        top files — useful when you need to know{" "}
        <em>which files inside a package</em> are taking the space.
      </p>

      <h4>Modules</h4>
      <p>
        Every <code>.ko</code> that ships in the rootfs, with its owning
        package and an <em>autoloaded</em> flag. <em>Autoloaded</em> means
        the module appears in <code>/etc/modules</code> and loads on boot.{" "}
        <em>On-demand</em> modules only load when triggered — typically by
        device hotplug. Big on-demand modules (Wi-Fi drivers, USB storage)
        are the prime compaction candidates.
      </p>

      <h4>Removed-by-finalize</h4>
      <p>
        Files the build explicitly drops via OpenIPC-specific Buildroot
        finalize hooks. Examples:{" "}
        <code>HISILICON_OPENSDK_TRIM_SP2308</code>,{" "}
        <code>SKIP_UNUSED_EV200</code>, the libstdc++ strip from{" "}
        <code>rootfs_script.sh</code>, and per-board excludes lists. This
        view answers "is the build already trimming X to fit?" without you
        needing to read the package Makefiles.
      </p>

      <h4>Drift vs another build</h4>
      <p>
        Pair-wise comparison. Pick a comparison build (the dropdown is
        constrained to other builds that have data for this same platform)
        and the table lists every package or module whose byte count
        changed between the two — sorted by absolute delta, biggest first.
        The comparison build is encoded in the URL as{" "}
        <code>?compare=&lt;build&gt;</code> so the view is shareable.
      </p>

      <h4>Configure (what-if)</h4>
      <p>
        Available on platforms that publish a kconfig graph (the tab is
        greyed out where the data isn't there yet — see{" "}
        <a href="#help-troubleshooting">Troubleshooting</a>). Tick a symbol
        to mark it for removal. The cascade column shows what would also
        come off; the <em>Pinned by</em> column shows what's hard-pinning a
        symbol on (a still-enabled <code>select</code>). Estimated savings
        are real bytes — looked up against this build's{" "}
        <code>sizes.json</code> for the affected packages, not a naive sum.
        Two actions:
      </p>
      <ul>
        <li>
          <strong>Download defconfig fragment</strong> — saves a{" "}
          <code>&lt;board&gt;-&lt;variant&gt;-custom.config.fragment</code>{" "}
          file of <code># BR2_PACKAGE_FOO is not set</code> lines. Append
          to your board defconfig and re-run defconfig.
        </li>
        <li>
          <strong>Open build request</strong> — pre-fills a GitHub issue on{" "}
          <code>OpenIPC/builder</code> with the fragment and a link back to
          this exact selection. A maintainer can pick it up and dispatch a
          custom build.
        </li>
      </ul>

      <h4>Trends</h4>
      <p>
        Time series across the retention window. Top of the panel shows
        rootfs and kernel headroom over time, with a projected-overflow
        badge if the recent slope points the headroom below zero in the
        next 60 days. Below that, a leaderboard of the biggest growers
        with inline sparklines. Use the window selector (7 / 14 / 30 / 90
        days) and the min-weekly-delta filter to scope to the kind of
        creep you care about.
      </p>
    </section>
  );
}

function Concepts() {
  return (
    <section id="help-concepts" className="help-section">
      <h3>Concepts</h3>

      <h4>Source, build, platform</h4>
      <p>
        A <strong>source</strong> is a publishing repository —{" "}
        <code>OpenIPC/firmware</code> or <code>OpenIPC/builder</code>. A{" "}
        <strong>build</strong> is a single nightly release on that source.
        A <strong>platform</strong> is a board × variant (firmware) or a
        device-specific compound key (builder). One build typically has
        many platforms; one platform usually has many builds.
      </p>

      <h4>Cascade semantics in the configurator</h4>
      <p>
        Buildroot's Kconfig has two kinds of dependency:{" "}
        <code>depends on</code> (must be true to be selectable) and{" "}
        <code>select</code> (forcing another symbol on). When you mark{" "}
        <code>X</code> for removal, the configurator walks{" "}
        <code>X</code>'s <code>selects</code> chain — anything it forces
        on becomes a candidate to remove too, <em>unless</em> some other
        still-enabled symbol also forces it. In that case the disable is
        blocked: telling Buildroot to drop the symbol would be a silent
        no-op because the surviving selector wins.
      </p>

      <h4>Sizes: compressed vs uncompressed</h4>
      <p>
        <code>sizes.json</code> reports each package's <em>uncompressed</em>{" "}
        bytes (the sum of file sizes attributed to it on the assembled
        rootfs) and a <em>compressed approximation</em>. Squashfs compresses
        across packages so there is no honest per-package compressed
        number; the approximation multiplies by the rootfs's global
        compression ratio. Headroom numbers, by contrast, come from the
        actual squashfs image and are accurate.
      </p>

      <h4>Defconfig fragment</h4>
      <p>
        A Buildroot defconfig is a Kconfig save file. A <em>fragment</em> is
        the set of lines you append. <code># BR2_PACKAGE_FOO is not set</code>{" "}
        is Kconfig's way of recording that a symbol is explicitly off.
        After appending, run <code>make BOARD=&lt;board&gt; defconfig</code>{" "}
        to re-merge.
      </p>
    </section>
  );
}

function UrlState() {
  return (
    <section id="help-url-state" className="help-section">
      <h3>URL state and sharing</h3>
      <p>
        Most of the view is encoded in the URL query, so any link is
        deep-linkable and shareable. Keys:
      </p>
      <table className="data-table help-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Values</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>source</code></td>
            <td><code>firmware</code> | <code>builder</code></td>
            <td>Which manifest to read. Defaults to <code>firmware</code>.</td>
          </tr>
          <tr>
            <td><code>build</code></td>
            <td><code>nightly-YYYYMMDD-shortsha</code></td>
            <td>The selected build. Empty defaults to the newest in the index.</td>
          </tr>
          <tr>
            <td><code>plat</code></td>
            <td>Platform key</td>
            <td>The selected platform. Empty defaults to the first available for the chosen build.</td>
          </tr>
          <tr>
            <td><code>compare</code></td>
            <td>Build ID</td>
            <td>Pre-selects the comparison build on the Drift tab. Absent on a clean URL; Drift falls back to the newest other build.</td>
          </tr>
          <tr>
            <td><code>help</code></td>
            <td><code>1</code></td>
            <td>Opens this panel.</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Freshness() {
  return (
    <section id="help-freshness" className="help-section">
      <h3>Data freshness and retention</h3>
      <p>
        The explorer's CI runs once a day at 04:30 UTC, after the upstream
        firmware (~00:11 UTC) and builder (~07:20 UTC) nightlies have
        published their releases. The CI uses the <code>gh</code> CLI to
        download every <code>sizes.*.json</code> /{" "}
        <code>kconfig-*.json</code> asset server-side, transforms them
        into per-platform shards under <code>data/&lt;source&gt;/</code>,
        and redeploys to GitHub Pages. So data is at most a day stale.
      </p>
      <p>
        <strong>Retention</strong> is 90 nightlies per source. Older
        releases still exist on GitHub but aren't pre-aggregated. Boards
        that fail to build on a given night are silently absent from that
        build's shard set; the per-platform Trends time series will have
        gaps.
      </p>
      <p>
        The size-report pipeline was merged into OpenIPC/firmware on{" "}
        <strong>2026-06-03</strong>. Nightlies before that date carry no
        sizes data and aren't visible in this tool. The full 90-day
        retention window will populate around <strong>2026-09-01</strong>;
        until then sparklines may be short.
      </p>
    </section>
  );
}

function Troubleshooting() {
  return (
    <section id="help-troubleshooting" className="help-section">
      <h3>Troubleshooting</h3>

      <h4>"Trends shows 'only 2 points'."</h4>
      <p>
        Only two nightlies have published data for this platform within the
        selected window. Either the retention window hasn't filled up yet
        (see <a href="#help-freshness">Data freshness</a>) or the board
        skipped some recent nightlies. Try a longer window selector or
        check the build picker for gaps.
      </p>

      <h4>"The Configure tab is greyed out."</h4>
      <p>
        The platform isn't listed in the source's{" "}
        <code>kconfig_available_for</code> array. The configurator needs a{" "}
        <code>kconfig-graph.json</code> asset on at least one of the
        retained nightlies for this platform. Boards that failed to build
        the kconfig-graph step on the latest nightly fall back to the
        previous one; if none of the retained nightlies have it, the tab
        stays disabled.
      </p>

      <h4>"I see a 404 on a sizes file."</h4>
      <p>
        The board skipped this nightly (toolchain failure, unresolved
        dependency, sensor-config bug). The shard genuinely doesn't exist.
        Pick a different build or platform.
      </p>

      <h4>"Drift says no other builds have data."</h4>
      <p>
        Only this single build has a sizes shard for this platform in the
        retained nightlies. Wait for more nightlies to publish or check the
        Trends tab to confirm the platform's coverage.
      </p>

      <h4>"Build-request URL is too long."</h4>
      <p>
        GitHub's new-issue URL accepts ~8000 characters. If your selection
        produces a defconfig fragment larger than the body budget, the
        explorer truncates with a marker and asks you to confirm. After the
        issue is open you can paste the rest of the fragment as a follow-up
        comment manually.
      </p>
    </section>
  );
}

function Glossary() {
  const entries: Array<[string, React.ReactNode]> = [
    [
      "BR2_PACKAGE_*",
      <>The Buildroot Kconfig symbol that controls whether a package is built. The configurator only surfaces user-prompted ones.</>,
    ],
    [
      "build",
      <>A single nightly release on a source. Tag format: <code>nightly-YYYYMMDD-shortsha</code>.</>,
    ],
    [
      "cap",
      <>The flash partition size for that artefact (kernel/rootfs). When used + headroom = cap.</>,
    ],
    [
      "defconfig",
      <>A Buildroot board configuration file (e.g. <code>br-ext-chip-hisilicon/configs/hi3518ev300_lite_defconfig</code>).</>,
    ],
    [
      "defconfig fragment",
      <>A snippet of defconfig lines to append. The configurator emits these for symbols you want off.</>,
    ],
    [
      "headroom",
      <>How many kilobytes of the artefact's flash partition are still free. Negative = over cap (build won't fit).</>,
    ],
    [
      "Kconfig",
      <>Buildroot's configuration grammar, inherited from the Linux kernel.</>,
    ],
    [
      "MPP",
      <>Media Processing Platform — the SoC vendor's video and audio pipeline API library.</>,
    ],
    [
      "nightly",
      <>A scheduled build with tag <code>nightly-YYYYMMDD-shortsha</code>.</>,
    ],
    [
      "OSDRV",
      <>Vendor SDK package shipping kernel modules and userspace blobs (e.g. <code>hisilicon-osdrv-hi3516ev200</code>).</>,
    ],
    [
      "platform",
      <>A board × variant identifier (firmware) or device-specific compound key (builder).</>,
    ],
    [
      "rootfs",
      <>The root filesystem on the camera, typically a squashfs image.</>,
    ],
    [
      "select",
      <>Kconfig directive that forces another symbol on. Hard to override; the configurator surfaces what's selecting what.</>,
    ],
    [
      "shard",
      <>A per-platform JSON file under <code>data/&lt;source&gt;/&lt;build&gt;/</code>. The explorer fetches one shard per platform pick.</>,
    ],
    [
      "sizes.json",
      <>Per-(build × platform) JSON describing what's in the rootfs. Produced by <code>general/scripts/size_report.py</code> in OpenIPC/firmware.</>,
    ],
    [
      "source",
      <>A publishing repository — <code>OpenIPC/firmware</code> or <code>OpenIPC/builder</code>.</>,
    ],
    [
      "variant",
      <>A flavour of a board's build: <code>lite</code>, <code>ultimate</code>, <code>fpv</code>, <code>neo</code>, etc.</>,
    ],
  ];
  return (
    <section id="help-glossary" className="help-section">
      <h3>Glossary</h3>
      <dl className="help-glossary">
        {entries.map(([term, def]) => (
          <div key={term} className="help-glossary-entry">
            <dt>{term}</dt>
            <dd>{def}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Architecture() {
  return (
    <section id="help-architecture" className="help-section">
      <h3>Architecture (for the curious)</h3>
      <p>
        The explorer is a build-time aggregator, not a runtime fetcher. The
        browser never crosses an origin boundary. The CI walks each repo's
        nightly releases via the <code>gh</code> CLI, downloads every{" "}
        <code>sizes.*.json</code> / <code>kconfig-*.json</code> asset
        server-side, writes per-platform shards plus a small{" "}
        <code>index.json</code> catalogue under <code>public/data/</code>,
        and Vite copies that into <code>dist/</code> on every deploy.
      </p>
      <p>
        That design exists because an earlier version of this tool tried
        to read GitHub release assets from the browser at runtime and got
        blocked by CORS. The build-time pattern removes the cross-origin
        fetch entirely. There's a regression guard in{" "}
        <code>tests/bundle.test.ts</code> that fails the build if any
        forbidden URL pattern reappears in the JS bundle.
      </p>
      <p className="muted">
        Source on GitHub:{" "}
        <a
          href="https://github.com/OpenIPC/firmware-explorer"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenIPC/firmware-explorer
        </a>
        . The size-report emitter:{" "}
        <a
          href="https://github.com/OpenIPC/firmware/blob/master/general/scripts/size_report.py"
          target="_blank"
          rel="noopener noreferrer"
        >
          size_report.py
        </a>
        . The kconfig-graph emitter:{" "}
        <a
          href="https://github.com/OpenIPC/firmware/blob/master/general/scripts/kconfig_graph.py"
          target="_blank"
          rel="noopener noreferrer"
        >
          kconfig_graph.py
        </a>
        .
      </p>
    </section>
  );
}

function Roadmap() {
  return (
    <section id="help-roadmap" className="help-section">
      <h3>Roadmap and limitations</h3>
      <ul>
        <li>
          <strong>v0.2 → v0.5 shipped.</strong> Build-time aggregator,
          Kconfig configurator, historical trends, build-request flow.
        </li>
        <li>
          <strong>Maintenance backlog:</strong> substring search on the
          platform picker, a header indicator for "data window: N days
          available", prebuild cache eviction, better 404 UX on missing
          shards, lifting <code>flash_mb</code> / <code>kernel_version</code>{" "}
          into <code>index.json</code> so the picker can preview metadata,
          sticky tab in URL.
        </li>
        <li>
          <strong>Optional follow-up:</strong> a GitHub bot on{" "}
          <code>OpenIPC/builder</code> that watches for{" "}
          <code>build-request</code>-labelled issues, parses the
          defconfig fragment, dispatches <code>build-one.yml</code>, and
          replies with the resulting release URL.
        </li>
        <li>
          <strong>Hard limitations:</strong> data lags one day behind the
          upstream nightly. Only the last 90 nightlies are pre-aggregated;
          older nightlies still exist on GitHub but aren't shown here.
          Per-package compressed numbers are approximations (squashfs
          compresses across packages).
        </li>
      </ul>
    </section>
  );
}
