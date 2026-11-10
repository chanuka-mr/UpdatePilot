export type UpdatePreviewData = {
  packageId: string;
  installedVersion: string;
  targetVersion: string | null;
  publisher: string | null;
  scope: string;
  architecture: string;
  installerType: string | null;
  installerSha256: string | null;
  selectionValidated: boolean;
  status: string;
  reason: string;
  checkedAt: string;
};

const storageKey = (recordId: string) => `updatepilot:preview:${recordId}`;

export function storePreview(recordId: string, name: string, preview: UpdatePreviewData) {
  try {
    sessionStorage.setItem(storageKey(recordId), JSON.stringify({ name, preview }));
  } catch {
    // Session storage may be unavailable; the confirmation page can request a fresh preview.
  }
}

export function readStoredPreview(recordId: string): { name: string; preview: UpdatePreviewData } | null {
  try {
    const raw = sessionStorage.getItem(storageKey(recordId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { name?: unknown; preview?: unknown };
    if (typeof parsed.name !== 'string' || !parsed.preview || typeof parsed.preview !== 'object') return null;
    const preview = parsed.preview as UpdatePreviewData;
    if (typeof preview.packageId !== 'string' || typeof preview.checkedAt !== 'string') return null;
    return { name: parsed.name, preview };
  } catch {
    return null;
  }
}
