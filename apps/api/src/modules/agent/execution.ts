import { z } from 'zod';
import { executionProfiles } from './update.js';

export const updateStages = [
  'queued', 'preparing', 'downloading', 'verifying', 'installing',
  'confirming', 'awaiting_restart', 'completed', 'blocked', 'failed', 'cancelled', 'interrupted',
] as const;
export type UpdateStage = typeof updateStages[number];

export const updateExecutionStatuses = [
  'queued', 'running', 'confirming', 'awaiting_restart', 'succeeded',
  'verification_failed', 'failed', 'blocked', 'cancelled', 'interrupted',
] as const;
export type UpdateExecutionStatus = typeof updateExecutionStatuses[number];

export const updateProgressSchema = z.object({
  jobId: z.uuid(),
  lease: z.string().regex(/^[a-f0-9]{64}$/),
  stage: z.enum(updateStages),
  percent: z.number().int().min(0).max(100),
  message: z.string().max(4096).optional(),
}).strict();

export const updateExecutionResultSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(['succeeded', 'restart_required', 'failed', 'blocked']),
  profile: z.enum(executionProfiles),
  installerType: z.string().min(1).max(128),
  installerSha256: z.string().regex(/^[A-Fa-f0-9]{64}$/),
  hashMatched: z.boolean(),
  architecture: z.enum(['x86', 'x64', 'arm64', 'neutral', 'unknown']),
  architectureCompatible: z.boolean(),
  signature: z.object({
    status: z.enum(['Valid', 'NotSigned', 'HashMismatch', 'NotTrusted', 'Unknown']),
    signerSubject: z.string().max(4096).nullable(),
    signerThumbprint: z.string().max(4096).nullable(),
    timestamped: z.boolean(),
  }).strict(),
  exitCode: z.number().int().min(-2147483648).max(2147483647).nullable(),
  rebootRequired: z.boolean(),
  reason: z.string().min(1).max(4096),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((result, context) => {
  if (result.status === 'blocked') {
    if (result.exitCode !== null) context.addIssue({ code: 'custom', message: 'A blocked update cannot have an exit code.' });
    return;
  }
  if (!result.hashMatched) context.addIssue({ code: 'custom', message: 'Executed installers must match the preview hash.' });
  if (!result.architectureCompatible) context.addIssue({ code: 'custom', message: 'Executed installers must be architecture compatible.' });
  if (result.signature.status !== 'Valid') context.addIssue({ code: 'custom', message: 'Executed installers must have a valid signature.' });
  if (result.exitCode === null) context.addIssue({ code: 'custom', message: 'An executed installer must report an exit code.' });
  if (result.status === 'restart_required' && !result.rebootRequired) context.addIssue({ code: 'custom', message: 'Restart-required status must request a restart.' });
});

export function statusForResult(status: 'succeeded' | 'restart_required' | 'failed' | 'blocked'): UpdateExecutionStatus {
  return status === 'succeeded' ? 'confirming'
    : status === 'restart_required' ? 'awaiting_restart'
      : status === 'blocked' ? 'blocked' : 'failed';
}

export function versionMatches(installedVersion: string | null, targetVersion: string) {
  if (!installedVersion) return false;
  const installed = installedVersion.trim().toLocaleLowerCase();
  const target = targetVersion.trim().toLocaleLowerCase();
  return installed === target || installed.split(/\s+/).includes(target);
}
