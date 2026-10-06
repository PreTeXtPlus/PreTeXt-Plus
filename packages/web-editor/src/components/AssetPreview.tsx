import { useState } from "react";
import type { Asset } from "../types/editor";

export interface AssetPreviewProps {
  asset: Asset;
}

/**
 * The preview panel while an asset is open: its uploaded image, with the file's
 * content type and filename beneath. An authored asset has no file behind it,
 * and rendering its PreTeXt source on its own isn't built yet.
 */
const AssetPreview = ({ asset }: AssetPreviewProps) => {
  // Remembered per URL: this component stays mounted as the author moves from
  // asset to asset, so one broken image must not hide the ones after it.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!asset.url) {
    return (
      <div
        data-testid="asset-preview"
        className="flex flex-1 h-full items-center justify-center p-6 bg-[#fafafa] text-center text-[0.9rem] text-slate-500"
      >
        Preview coming soon for authored assets.
      </div>
    );
  }

  return (
    <div
      data-testid="asset-preview"
      className="flex flex-1 h-full min-h-0 flex-col items-center justify-center gap-3 p-6 bg-[#fafafa]"
    >
      {failedUrl === asset.url ? (
        <div className="text-[0.9rem] text-slate-500">The image couldn't be loaded.</div>
      ) : (
        <img
          src={asset.url}
          alt={asset.shortDescription || asset.title}
          className="max-w-full min-h-0 flex-shrink object-contain border border-slate-200 rounded bg-white"
          onError={() => setFailedUrl(asset.url ?? null)}
        />
      )}
      {(asset.contentType || asset.fileRef) && (
        <div
          data-testid="asset-preview-type"
          className="flex gap-3 text-[0.72rem] text-slate-400 font-mono"
        >
          {asset.fileRef && <span>{asset.fileRef}</span>}
          {asset.contentType && <span>{asset.contentType}</span>}
        </div>
      )}
    </div>
  );
};

export default AssetPreview;
