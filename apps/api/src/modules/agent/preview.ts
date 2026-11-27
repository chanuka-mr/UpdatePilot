import { z } from 'zod';
export const previewRequestSchema=z.object({packageId:z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/),installedVersion:z.string().min(1).max(4096),snapshotId:z.uuid()}).strict();
export const previewResultSchema=z.object({
  schemaVersion:z.literal(1),packageId:z.string().min(1).max(200),source:z.literal('winget'),
  checkedAt:z.iso.datetime({offset:true}),installedVersion:z.string().max(4096),
  targetVersion:z.string().min(1).max(4096).nullable(),publisher:z.string().max(4096).nullable(),
  scope:z.enum(['user','machine','unknown']),architecture:z.literal('unknown'),
  installerType:z.string().min(1).max(128).nullable(),installerSha256:z.string().regex(/^[A-Fa-f0-9]{64}$/).nullable(),
  selectionValidated:z.boolean(),
  status:z.enum(['incomplete','blocked','no-update']),reason:z.string().min(1).max(4096),
  signatureVerified:z.literal(false),installationEnabled:z.literal(false),
}).strict();
