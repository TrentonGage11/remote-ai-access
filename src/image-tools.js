import path from "node:path";

export function normalizeImageRequest(input = {}) {
  const provider = String(input.provider || "openai").trim().toLowerCase();
  if (!["openai", "xai", "google"].includes(provider)) throw new Error("image provider must be openai, xai, or google");
  const prompt = String(input.prompt || "").trim().slice(0, 4000);
  if (!prompt) throw new Error("image prompt is required");
  const outputPath = String(input.outputPath || `generated/image-${Date.now()}.png`).trim().replace(/\\/g, "/");
  if (!outputPath || path.posix.isAbsolute(outputPath) || outputPath.split("/").includes("..")) throw new Error("outputPath must be workspace-relative");
  const extension = path.posix.extname(outputPath).toLowerCase();
  if (!new Set([".png", ".jpg", ".jpeg", ".webp"]).has(extension)) throw new Error("outputPath must end in png, jpg, jpeg, or webp");
  return {
    provider,
    prompt,
    outputPath,
    model: String(input.model || "").trim().slice(0, 160),
    size: String(input.size || "1024x1024").trim().slice(0, 40),
    quality: String(input.quality || "auto").trim().slice(0, 40)
  };
}

export function parseWikimediaImageResults(data, limit = 8) {
  return Object.values(data?.query?.pages || {})
    .map((page) => {
      const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
      return {
        title: String(page?.title || "").replace(/^File:/, ""),
        descriptionUrl: String(info?.descriptionurl || ""),
        imageUrl: String(info?.thumburl || info?.url || ""),
        sourceUrl: String(info?.url || ""),
        mime: String(info?.mime || ""),
        width: Number(info?.thumbwidth || info?.width || 0),
        height: Number(info?.thumbheight || info?.height || 0),
        artist: String(info?.extmetadata?.Artist?.value || "").replace(/<[^>]+>/g, "").slice(0, 300),
        license: String(info?.extmetadata?.LicenseShortName?.value || "").slice(0, 120)
      };
    })
    .filter((item) => item.imageUrl)
    .slice(0, Math.max(1, Math.min(20, Number(limit || 8))));
}

export function extractGeneratedImage(data) {
  const candidate = data?.data?.[0] || data?.candidates?.[0]?.content?.parts?.find((part) => part?.inlineData || part?.inline_data);
  const base64 = candidate?.b64_json || candidate?.inlineData?.data || candidate?.inline_data?.data || "";
  const url = candidate?.url || "";
  if (!base64 && !url) throw new Error("image provider returned no image data");
  return { base64: String(base64), url: String(url) };
}