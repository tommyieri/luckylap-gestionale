type PreviewEnvironment = { LUCKYLAP_LOCAL_PREVIEW?: string; VERCEL?: string; NODE_ENV?: string };

export function isLocalPreviewEnabled(
  environment: PreviewEnvironment = {
    LUCKYLAP_LOCAL_PREVIEW: process.env.LUCKYLAP_LOCAL_PREVIEW,
    VERCEL: process.env.VERCEL,
    NODE_ENV: process.env.NODE_ENV,
  },
): boolean {
  return (
    environment.LUCKYLAP_LOCAL_PREVIEW === "true" &&
    !environment.VERCEL &&
    environment.NODE_ENV !== "production"
  );
}
