export type SecurityMapping = { packageId: string; vendor: string; product: string };

// Curated identities only. A WinGet package is never guessed into an NVD product.
// Unmapped packages intentionally remain "No verified finding available."
export const securityMappings: SecurityMapping[] = [
  { packageId: 'AnyDesk.AnyDesk', vendor: 'anydesk', product: 'anydesk' },
  { packageId: 'VideoLAN.VLC', vendor: 'videolan', product: 'vlc_media_player' },
  { packageId: '7zip.7zip', vendor: '7-zip', product: '7-zip' },
  { packageId: 'Docker.DockerDesktop', vendor: 'docker', product: 'docker_desktop' },
  { packageId: 'Microsoft.VisualStudioCode', vendor: 'microsoft', product: 'visual_studio_code' },
  { packageId: 'Git.Git', vendor: 'git', product: 'git' },
  { packageId: 'Python.Python.3.10', vendor: 'python', product: 'python' },
  { packageId: 'Python.Python.3.11', vendor: 'python', product: 'python' },
  { packageId: 'Python.Python.3.12', vendor: 'python', product: 'python' },
  { packageId: 'Python.Python.3.13', vendor: 'python', product: 'python' },
  { packageId: 'Python.Python.3.14', vendor: 'python', product: 'python' },
  { packageId: 'PuTTY.PuTTY', vendor: 'putty', product: 'putty' },
  { packageId: 'WinSCP.WinSCP', vendor: 'winscp', product: 'winscp' },
  { packageId: 'Mozilla.Firefox', vendor: 'mozilla', product: 'firefox' },
  { packageId: 'Google.Chrome', vendor: 'google', product: 'chrome' },
];
const byPackage = new Map(securityMappings.map(mapping => [mapping.packageId.toLowerCase(), mapping]));

export function securityMappingFor(packageId: string) {
  return byPackage.get(packageId.toLowerCase()) ?? null;
}

export function normalizeInstalledVersion(raw: string | null): string | null {
  if (!raw) return null;
  const dotted = raw.match(/\d+(?:\.\d+)+(?:[-+._][0-9A-Za-z]+)*/);
  if (dotted) return dotted[0];
  const single = raw.match(/\d+/);
  return single ? single[0] : null;
}
