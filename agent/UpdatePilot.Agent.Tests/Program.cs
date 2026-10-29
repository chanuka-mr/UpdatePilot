using System.Text.Json;
using UpdatePilot.Agent;

// Dependency-free contract checks; no registry access, processes, or updates.
const string sample = """
{"schemaVersion":1,"scannedAt":"2026-10-29T10:00:00Z","moduleVersion":"1.0.0","packages":[
  {"name":"Docker Desktop","id":"Docker.DockerDesktop","installedVersion":"4.69.0","source":"winget","isUpdateAvailable":true,"availableVersions":["4.97.0","4.96.3"]},
  {"name":"AnyDesk","id":"AnyDesk.AnyDesk","installedVersion":"ad 9.7.13","source":"winget","isUpdateAvailable":true,"availableVersions":["9.8.3"]}
]}
""";
var tests = new (string Name, Action Run)[]
{
    ("Preserves package identities, nonstandard installed versions, and historical versions", () =>
    {
        var inventory = WinGetScanner.Parse(sample);
        Require(inventory.Packages.Count == 2);
        Require(inventory.Packages[0].Id == "Docker.DockerDesktop");
        Require(inventory.Packages[0].AvailableVersions.SequenceEqual(new[] { "4.97.0", "4.96.3" }));
        Require(inventory.Packages[1].InstalledVersion == "ad 9.7.13");
        Require(inventory.Packages.All(package => package.IsUpdateAvailable));
    }),
    ("Accepts an explicitly empty package list", () =>
        Require(WinGetScanner.Parse("""
            {"schemaVersion":1,"scannedAt":"2026-10-29T10:00:00Z","moduleVersion":"1.0.0","packages":[]}
            """).Packages.Count == 0)),
    ("Rejects incomplete scans instead of reporting zero updates", () => Reject("{}")),
    ("Rejects unexpected package sources", () => Reject(sample.Replace("\"source\":\"winget\"", "\"source\":\"untrusted\""))),
    ("Rejects missing update status", () => Reject(sample.Replace("\"isUpdateAvailable\":true,", ""))),
    ("Rejects contaminated JSON output", () => Reject("Warning: failed\n" + sample))
};
var failures = 0;
foreach (var test in tests)
{
    try { test.Run(); Console.WriteLine($"PASS {test.Name}"); }
    catch (Exception exception) { failures++; Console.Error.WriteLine($"FAIL {test.Name}: {exception.Message}"); }
}
Console.WriteLine($"{tests.Length - failures}/{tests.Length} checks passed.");
return failures == 0 ? 0 : 1;

static void Require(bool condition) { if (!condition) throw new Exception("Contract assertion failed."); }
static void Reject(string json)
{
    try { WinGetScanner.Parse(json); }
    catch (JsonException) { return; }
    throw new Exception("Invalid response was accepted.");
}
