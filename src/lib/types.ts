// Types are shared with `scripts/prebuild.mts`. The aggregator writes:
//
//   public/data/<source>/index.json       <- IndexFile
//   public/data/<source>/<id>/<plat>.json <- Sizes (verbatim copy of size_report.py output)
//
// Vite copies `public/` into `dist/`, so the runtime fetches these by relative
// URLs (./data/...) — same-origin, no CORS. The shape of `Sizes` mirrors the
// schema docstring in OpenIPC/firmware:general/scripts/size_report.py.

export const SOURCES = ["firmware", "builder"] as const;
export type Source = (typeof SOURCES)[number];

export type Build = {
  id: string;
  sha: string;
  short: string;
  built_at: string;
  platforms: string[];
};

export type IndexFile = {
  schema: 1;
  source: Source;
  generated_at: string;
  retention: number;
  builds: Build[];
};

export type SizesPackage = {
  name: string;
  uncompressed_bytes: number;
  compressed_bytes_approx: number | null;
  file_count: number;
  top_files: Array<{ path: string; bytes: number }>;
};

export type SizesModule = {
  name: string;
  path: string;
  bytes: number;
  package: string;
  autoloaded: boolean;
};

export type SizesRemoved = {
  path: string;
  package: string;
  source_bytes: number;
};

export type Sizes = {
  schema: number;
  board: string;
  variant: string;
  flash_mb: number | null;
  kernel_version: string | null;
  rootfs: {
    uncompressed_bytes: number;
    compressed_bytes: number | null;
    compression: string | null;
    compression_ratio: number | null;
  };
  kernel: {
    image_path: string | null;
    uimage_bytes: number | null;
    vmlinux_bytes: number | null;
  };
  headroom: {
    kernel: { used_kb: number; cap_kb: number; headroom_kb: number | null };
    rootfs: { used_kb: number; cap_kb: number; headroom_kb: number | null };
  };
  packages: SizesPackage[];
  linux_components: {
    kernel_image: {
      image_path: string | null;
      uimage_bytes: number | null;
      vmlinux_bytes: number | null;
    };
    modules: SizesModule[];
    built_in: string[];
    autoload_list: string[];
  };
  removed_by_finalize: SizesRemoved[];
};
