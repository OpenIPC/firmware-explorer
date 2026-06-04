// Matches the JSON schemas emitted by:
//   firmware: .github/scripts/enrich_manifest.py + general/scripts/size_report.py (PR #2166)
//   builder:  .github/scripts/enrich_manifest.py + downstream firmware (PR #102)

export type ManifestSource = "firmware" | "builder";

export type AssetRef = {
  url: string;
  size: number;
};

export type Build = {
  id: string;
  sha: string;
  short: string;
  built_at: string;
  release_url: string;
  platforms: Record<string, PlatformAssets>;
};

export type PlatformAssets = {
  nor?: AssetRef;
  nand?: AssetRef;
  sizes?: AssetRef;
};

export type Manifest = {
  schema: number;
  generated_at: string;
  channels: { nightly?: string; latest?: string };
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
