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
  signatureVerified: boolean;
  installationEnabled: boolean;
};

export type InstallerVerification = {
  schemaVersion: number;
  packageId: string;
  targetVersion: string;
  installerType: string;
  installerSha256: string;
  architecture: string;
  architectureCompatible: boolean;
  hashMatched: boolean;
  signature: {
    status: string;
    signerSubject: string | null;
    signerThumbprint: string | null;
    timestamped: boolean;
  };
  publisherMatch: string;
  verifiedAt: string;
  installationEnabled: boolean;
};

const storageKey = (recordId: string) => `updatepilot:preview:${recordId}`;
const verificationKey = (recordId: string) => `updatepilot:verification:${recordId}`;

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

export function storeVerification(recordId: string, previewCheckedAt: string, verification: InstallerVerification) {
  try {
    sessionStorage.setItem(verificationKey(recordId), JSON.stringify({ previewCheckedAt, verification }));
  } catch {
    // Session storage may be unavailable; the user can verify again.
  }
}

export function readStoredVerification(recordId: string): { previewCheckedAt: string; verification: InstallerVerification } | null {
  try {
    const raw = sessionStorage.getItem(verificationKey(recordId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { previewCheckedAt?: unknown; verification?: unknown };
    if (typeof parsed.previewCheckedAt !== 'string' || !parsed.verification || typeof parsed.verification !== 'object') return null;
    const verification = parsed.verification as InstallerVerification;
    if (typeof verification.packageId !== 'string' || typeof verification.verifiedAt !== 'string') return null;
    return { previewCheckedAt: parsed.previewCheckedAt, verification };
  } catch {
    return null;
  }
}
