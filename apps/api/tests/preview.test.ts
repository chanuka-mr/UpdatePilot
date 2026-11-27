import assert from 'node:assert/strict';
import {test} from 'node:test';
import {previewRequestSchema,previewResultSchema} from '../src/modules/agent/preview.js';
test('preview requests reject arbitrary shell commands and executable paths',()=>{
  for(const packageId of ['; whoami','C:\\setup.exe','--all','App Name','https://example.com'])assert.equal(previewRequestSchema.safeParse({packageId,installedVersion:'1',snapshotId:'00000000-0000-4000-8000-000000000001'}).success,false);
});
const preview={schemaVersion:1,packageId:'VideoLAN.VLC',source:'winget',checkedAt:'2026-11-02T10:00:00Z',installedVersion:'3.0.20',targetVersion:'3.0.23',publisher:'VideoLAN',scope:'machine',architecture:'unknown',installerType:'exe',installerSha256:'a'.repeat(64),selectionValidated:true,status:'incomplete',reason:'Installer applicability is not verified.',signatureVerified:false,installationEnabled:false};
test('real preview preserves unknown fields and catalog candidate without allowing installation',()=>{assert.equal(previewResultSchema.parse(preview).targetVersion,'3.0.23');});
test('preview cannot assert executable approval or unverified signature',()=>{
  for(const bad of [{...preview,installationEnabled:true},{...preview,signatureVerified:true},{...preview,architecture:'x64'},{...preview,source:'untrusted'},{...preview,status:'ready'}])assert.equal(previewResultSchema.safeParse(bad).success,false);
});
test('installer selection evidence must have an exact SHA-256 when supplied',()=>{
  assert.equal(previewResultSchema.safeParse({...preview,installerSha256:'not-a-hash'}).success,false);
  assert.equal(previewResultSchema.parse({...preview,installerType:null,installerSha256:null,selectionValidated:false}).selectionValidated,false);
});
