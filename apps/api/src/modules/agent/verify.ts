import { z } from 'zod';

export const verifyControlSchema = z.object({ recordId: z.uuid() }).strict();

export const verificationResultSchema = z.object({
  schemaVersion: z.literal(1),
  packageId: z.string().min(1).max(200),
  targetVersion: z.string().min(1).max(4096),
  installerType: z.string().min(1).max(128),
  installerSha256: z.string().regex(/^[A-Fa-f0-9]{64}$/),
  architecture: z.enum(['x86', 'x64', 'arm64', 'neutral', 'unknown']),
  architectureCompatible: z.boolean(),
  hashMatched: z.literal(true),
  signature: z.object({
    status: z.enum(['Valid', 'NotSigned', 'HashMismatch', 'NotTrusted', 'Unknown']),
    signerSubject: z.string().max(4096).nullable(),
    signerThumbprint: z.string().max(128).nullable(),
    timestamped: z.boolean(),
  }).strict(),
  publisherMatch: z.enum(['matched', 'unverified', 'mismatch']),
  verifiedAt: z.iso.datetime({ offset: true }),
  installationEnabled: z.literal(false),
}).strict();

export type VerificationResult = z.infer<typeof verificationResultSchema>;
