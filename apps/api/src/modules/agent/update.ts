import { z } from 'zod';

export const updateControlSchema = z.object({ recordId: z.uuid() }).strict();

export const executionProfiles = [
  'msi-user', 'msi-machine',
  'inno-user', 'inno-machine',
  'nsis-user', 'nsis-machine',
  'burn-user', 'burn-machine',
] as const;
export type ExecutionProfile = typeof executionProfiles[number];

export function deriveExecutionProfile(installerType: string, scope: 'user' | 'machine'): ExecutionProfile | null {
  const family = installerType.trim().toLowerCase();
  const profile = family === 'msi' || family === 'wix' ? 'msi'
    : family === 'inno' ? 'inno'
      : family === 'nullsoft' || family === 'nsis' ? 'nsis'
        : family === 'burn' ? 'burn'
          : null;
  return profile ? `${profile}-${scope}` as ExecutionProfile : null;
}

export const updateRequestSchema = z.object({
  packageId: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/),
  installedVersion: z.string().min(1).max(4096),
  targetVersion: z.string().min(1).max(4096),
  installerType: z.string().min(1).max(128),
  installerSha256: z.string().regex(/^[A-Fa-f0-9]{64}$/),
  scope: z.enum(['user', 'machine']),
  profile: z.enum(executionProfiles),
  snapshotId: z.uuid(),
  previewJobId: z.uuid(),
}).strict();

export type UpdateRequest = z.infer<typeof updateRequestSchema>;

export const updateBlockers = [
  'execution_disabled',
  'agent_offline',
  'stale_scan',
  'winget_unavailable',
  'candidate_missing',
  'preview_missing',
  'preview_stale',
  'identity_mismatch',
  'version_missing',
  'installer_identity_missing',
  'selection_unvalidated',
  'scope_unknown',
  'execution_profile_unavailable',
  'verification_missing',
  'verification_stale',
  'verification_mismatch',
  'hash_mismatch',
  'architecture_unknown',
  'architecture_incompatible',
  'signature_unverified',
  'job_active',
] as const;
export type UpdateBlocker = typeof updateBlockers[number];

type SnapshotInput = { id: string; scannedAt: Date; wingetStatus: string };
type CandidateInput = { id: string; packageId: string; installedVersion: string | null; source: string | null; isUpdateAvailable: boolean; matchStatus: string };
type PreviewJobInput = { id: string; state: string; createdAt: Date; request: unknown; preview: unknown };
type VerificationJobInput = { id: string; state: string; createdAt: Date; request: unknown; verification: unknown };

export type PreviewBindingInput = {
  snapshot: SnapshotInput | null;
  candidate: CandidateInput | null;
  previewJob: PreviewJobInput | null;
  now?: number;
};

export type UpdateGateInput = PreviewBindingInput & {
  executionEnabled: boolean;
  agentOnline: boolean;
  verificationJob?: VerificationJobInput | null;
  activeJob: boolean;
};

export type PreviewBindingResult =
  | { ok: true; request: UpdateRequest }
  | { ok: false; blockers: UpdateBlocker[] };

export type UpdateGateResult =
  | { ok: true; request: UpdateRequest }
  | { ok: false; blockers: UpdateBlocker[] };

export const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function derivePreviewRequest(input: PreviewBindingInput): PreviewBindingResult {
  const blockers = new Set<UpdateBlocker>();
  const now = input.now ?? Date.now();
  if (!input.snapshot) blockers.add('stale_scan');
  else {
    if (input.snapshot.wingetStatus !== 'completed') blockers.add('winget_unavailable');
    if (now - input.snapshot.scannedAt.getTime() > 86400000) blockers.add('stale_scan');
  }

  const candidate = input.candidate;
  if (!candidate) blockers.add('candidate_missing');
  else {
    if (candidate.matchStatus !== 'matched' || !candidate.isUpdateAvailable || (candidate.source ?? '').toLowerCase() !== 'winget')
      blockers.add('candidate_missing');
    if (!candidate.installedVersion) blockers.add('version_missing');
  }

  const job = input.previewJob;
  const request = record(job?.request);
  const preview = record(job?.preview);
  if (!job || job.state !== 'completed' || !preview || !input.snapshot || !candidate) {
    blockers.add('preview_missing');
  } else {
    if (job.createdAt.getTime() < input.snapshot.scannedAt.getTime()) blockers.add('preview_stale');
    if (request?.snapshotId !== input.snapshot.id || preview.packageId !== candidate.packageId || preview.installedVersion !== candidate.installedVersion)
      blockers.add('identity_mismatch');
    if (typeof preview.targetVersion !== 'string' || !preview.targetVersion) blockers.add('version_missing');
    if (typeof preview.installerType !== 'string' || !preview.installerType ||
      typeof preview.installerSha256 !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(preview.installerSha256))
      blockers.add('installer_identity_missing');
    if (preview.selectionValidated !== true) blockers.add('selection_unvalidated');
    if (preview.scope !== 'user' && preview.scope !== 'machine') blockers.add('scope_unknown');
    if ((preview.scope === 'user' || preview.scope === 'machine') &&
      (typeof preview.installerType !== 'string' || !deriveExecutionProfile(preview.installerType, preview.scope)))
      blockers.add('execution_profile_unavailable');
  }

  if (blockers.size > 0) return { ok: false, blockers: [...blockers] };
  if (!input.snapshot || !candidate?.installedVersion || !job || !preview ||
    typeof preview.targetVersion !== 'string' || typeof preview.installerType !== 'string' ||
    typeof preview.installerSha256 !== 'string' || (preview.scope !== 'user' && preview.scope !== 'machine'))
    return { ok: false, blockers: ['preview_missing'] };

  const profile = deriveExecutionProfile(preview.installerType, preview.scope);
  if (!profile) return { ok: false, blockers: ['execution_profile_unavailable'] };

  return {
    ok: true,
    request: updateRequestSchema.parse({
      packageId: candidate.packageId,
      installedVersion: candidate.installedVersion,
      targetVersion: preview.targetVersion,
      installerType: preview.installerType,
      installerSha256: preview.installerSha256.toLowerCase(),
      scope: preview.scope,
      profile,
      snapshotId: input.snapshot.id,
      previewJobId: job.id,
    }),
  };
}

export function evaluateUpdateGate(input: UpdateGateInput): UpdateGateResult {
  const blockers = new Set<UpdateBlocker>();
  if (!input.executionEnabled) blockers.add('execution_disabled');
  if (!input.agentOnline) blockers.add('agent_offline');
  if (input.activeJob) blockers.add('job_active');

  const binding = derivePreviewRequest(input);
  if (!binding.ok) binding.blockers.forEach(blocker => blockers.add(blocker));
  else validateVerification(input, binding.request, blockers);

  if (blockers.size > 0) return { ok: false, blockers: [...blockers] };
  if (!binding.ok) return { ok: false, blockers: [...blockers] };
  return { ok: true, request: binding.request };
}

function validateVerification(input: UpdateGateInput, expected: UpdateRequest, blockers: Set<UpdateBlocker>) {
  const job = input.verificationJob;
  const request = record(job?.request);
  const evidence = record(job?.verification);
  if (!job || job.state !== 'completed' || !evidence || !input.snapshot || !input.previewJob) {
    blockers.add('verification_missing');
    return;
  }

  if (job.createdAt.getTime() < input.previewJob.createdAt.getTime() || job.createdAt.getTime() < input.snapshot.scannedAt.getTime())
    blockers.add('verification_stale');
  if (request?.snapshotId !== input.snapshot.id || request?.previewJobId !== input.previewJob.id)
    blockers.add('verification_mismatch');
  if (evidence.packageId !== expected.packageId || evidence.targetVersion !== expected.targetVersion ||
    evidence.installerType !== expected.installerType ||
    typeof evidence.installerSha256 !== 'string' || evidence.installerSha256.toLowerCase() !== expected.installerSha256)
    blockers.add('verification_mismatch');
  if (evidence.hashMatched !== true) blockers.add('hash_mismatch');
  if (typeof evidence.architecture !== 'string' || evidence.architecture === 'unknown') blockers.add('architecture_unknown');
  else if (evidence.architectureCompatible !== true) blockers.add('architecture_incompatible');
  const signature = record(evidence.signature);
  if (!signature || signature.status !== 'Valid') blockers.add('signature_unverified');
}
