import sharp from "sharp";

export const AVATAR_BUCKET = "SafesightUserIcons";
export const AVATAR_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const AVATAR_OUTPUT_SIZE = 512;
export const AVATAR_JPEG_QUALITY = 78;

export async function optimizeAvatarBuffer(input) {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, {
      fit: "cover",
      position: "attention",
    })
    .jpeg({
      quality: AVATAR_JPEG_QUALITY,
      mozjpeg: true,
      progressive: true,
      chromaSubsampling: "4:2:0",
    })
    .toBuffer();
}

export function avatarObjectPath(userId) {
  return `${userId}/avatar.jpg`;
}

export function publicAvatarUrl(supabaseUrl, userId, version) {
  const base = String(supabaseUrl || "").replace(/\/$/, "");
  const url = `${base}/storage/v1/object/public/${AVATAR_BUCKET}/${avatarObjectPath(userId)}`;
  if (version) return `${url}?v=${version}`;
  return url;
}
