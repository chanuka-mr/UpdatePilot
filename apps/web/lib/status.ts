export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

type StatusInfo = { label: string; tone: StatusTone; description: string; action: string | null };

const executionStatuses: Record<string, StatusInfo> = {
  queued: { label: 'Waiting to start', tone: 'info', description: 'The execution request is queued for the paired agent.', action: 'Keep the agent running.' },
  running: { label: 'Installing', tone: 'info', description: 'The verified installer is running. Do not close the agent.', action: null },
  confirming: { label: 'Confirming update', tone: 'info', description: 'A follow-up scan is checking the installed version.', action: null },
  awaiting_restart: { label: 'Restart needed', tone: 'warning', description: 'The installer finished and requested a restart.', action: 'Restart this PC, then run the confirming scan.' },
  succeeded: { label: 'Update confirmed', tone: 'success', description: 'The installed version matches the approved target.', action: null },
  verification_failed: { label: 'Version mismatch', tone: 'danger', description: 'The installed version did not match the approved target.', action: 'Run a fresh preview and verification before trying again.' },
  failed: { label: 'Update failed', tone: 'danger', description: 'The installer exited with an error.', action: 'Review the execution details and start a fresh update.' },
  blocked: { label: 'Blocked by safety check', tone: 'danger', description: 'The execution gate did not allow this update.', action: 'Review the blockers and resolve them before retrying.' },
  cancelled: { label: 'Cancelled', tone: 'neutral', description: 'The execution was cancelled before launch.', action: null },
  interrupted: { label: 'Interrupted', tone: 'warning', description: 'The agent stopped reporting before the update completed.', action: 'Verify the installed version manually before retrying.' },
  expired: { label: 'Expired', tone: 'warning', description: 'The execution request expired before the agent claimed it.', action: 'Start a fresh update.' },
};

const blockers: Record<string, StatusInfo> = {
  execution_disabled: { label: 'Execution is turned off', tone: 'warning', description: 'UPDATE_EXECUTION_ENABLED is not set to true in apps/api/.env.', action: 'Enable it and restart the API.' },
  agent_offline: { label: 'Agent is offline', tone: 'warning', description: 'No paired agent has checked in recently.', action: 'Start the agent with --listen.' },
  stale_scan: { label: 'Scan is too old', tone: 'warning', description: 'The inventory snapshot is older than 24 hours.', action: 'Run a fresh scan.' },
  winget_unavailable: { label: 'WinGet results unavailable', tone: 'warning', description: 'The latest scan did not return usable WinGet results.', action: 'Run a fresh scan and check the agent log.' },
  candidate_missing: { label: 'Update candidate missing', tone: 'danger', description: 'This record is no longer an update candidate in the latest scan.', action: 'Refresh the update list.' },
  preview_missing: { label: 'Preview is missing', tone: 'warning', description: 'No completed preview is available for this installer.', action: 'Run a fresh preview.' },
  preview_stale: { label: 'Preview is stale', tone: 'warning', description: 'The inventory changed after the last preview.', action: 'Run a fresh preview.' },
  identity_mismatch: { label: 'Installer identity mismatch', tone: 'danger', description: 'The preview no longer matches this update record.', action: 'Run a fresh preview.' },
  version_missing: { label: 'Target version missing', tone: 'danger', description: 'The preview did not return a target version.', action: 'Run a fresh preview.' },
  installer_identity_missing: { label: 'Installer identity missing', tone: 'danger', description: 'The preview did not return a usable installer hash.', action: 'Run a fresh preview.' },
  selection_unvalidated: { label: 'Installer selection unvalidated', tone: 'danger', description: 'WinGet did not mark this installer selection as validated.', action: 'Run a fresh preview.' },
  scope_unknown: { label: 'Install scope unknown', tone: 'danger', description: 'The preview did not report user or machine scope.', action: 'Run a fresh preview.' },
  execution_profile_unavailable: { label: 'Installer profile unavailable', tone: 'danger', description: 'This installer type is not in the allowlist of controlled execution profiles.', action: 'Use a supported installer or add a reviewed profile.' },
  verification_missing: { label: 'Verification is missing', tone: 'warning', description: 'The exact installer has not been verified yet.', action: 'Run installer verification.' },
  verification_stale: { label: 'Verification is stale', tone: 'warning', description: 'Verification no longer matches the current preview.', action: 'Run installer verification again.' },
  verification_mismatch: { label: 'Verification mismatch', tone: 'danger', description: 'Verification evidence does not match the preview.', action: 'Run a fresh preview and verification.' },
  hash_mismatch: { label: 'Hash mismatch', tone: 'danger', description: 'The downloaded installer hash did not match the preview.', action: 'Do not retry until the installer source is reviewed.' },
  architecture_unknown: { label: 'Architecture unknown', tone: 'danger', description: 'The installer architecture could not be confirmed.', action: 'Run a fresh preview.' },
  architecture_incompatible: { label: 'Architecture incompatible', tone: 'danger', description: 'The installer architecture does not match this device.', action: 'Run a fresh preview.' },
  signature_unverified: { label: 'Signature unverified', tone: 'danger', description: 'The installer signature is not valid.', action: 'Do not retry until the installer source is reviewed.' },
  job_active: { label: 'Another job is active', tone: 'info', description: 'A scan, preview, or verification job is still running.', action: 'Wait for the current job to finish.' },
};

const fallback: StatusInfo = { label: 'Needs attention', tone: 'warning', description: 'This state needs review.', action: null };

export function executionStatus(value?: string | null): StatusInfo {
  return (value && executionStatuses[value]) || { ...fallback, label: value || 'Unknown status', description: `Status code: ${value || 'unknown'}` };
}

export function blockerInfo(value?: string | null): StatusInfo {
  return (value && blockers[value]) || { ...fallback, label: value || 'Unknown blocker', description: `Blocker code: ${value || 'unknown'}` };
}

export function inferTone(value: string): StatusTone {
  const normalized = value.toLowerCase();
  if (executionStatuses[normalized]?.tone) return executionStatuses[normalized].tone;
  if (normalized.includes('available') || normalized.includes('outdated') || normalized.includes('warning')) return 'warning';
  if (normalized.includes('error') || normalized.includes('failed') || normalized.includes('blocked') || normalized.includes('mismatch')) return 'danger';
  if (normalized.includes('success') || normalized.includes('confirmed') || normalized.includes('completed')) return 'success';
  if (normalized.includes('running') || normalized.includes('queued') || normalized.includes('pending')) return 'info';
  return 'neutral';
}
