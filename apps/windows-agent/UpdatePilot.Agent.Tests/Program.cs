using System.Diagnostics;
using System.Text.Json;
using UpdatePilot.Agent;

// Dependency-free contract checks plus a local PowerShell parser check; no registry access, network calls, or updates.
const string sample = """
{"schemaVersion":1,"scannedAt":"2026-10-29T10:00:00Z","moduleVersion":"1.0.0","packages":[
  {"name":"Docker Desktop","id":"Docker.DockerDesktop","installedVersion":"4.69.0","source":"winget","isUpdateAvailable":true,"availableVersions":["4.97.0","4.96.3"]},
  {"name":"AnyDesk","id":"AnyDesk.AnyDesk","installedVersion":"ad 9.7.13","source":"winget","isUpdateAvailable":true,"availableVersions":["9.8.3"]}
]}
""";
const string updateSample = """
{"packageId":"VideoLAN.VLC","installedVersion":"3.0.20","targetVersion":"3.0.23","installerType":"inno","installerSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","scope":"machine","profile":"inno-machine","snapshotId":"00000000-0000-4000-8000-000000000001","previewJobId":"00000000-0000-4000-8000-000000000002"}
""";
const string verificationSample = """
{"schemaVersion":1,"packageId":"VideoLAN.VLC","targetVersion":"3.0.23","installerType":"inno","installerSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","architecture":"x64","architectureCompatible":true,"hashMatched":true,"signature":{"status":"Valid","signerSubject":"CN=VideoLAN, O=VideoLAN","signerThumbprint":"ABC123","timestamped":true},"publisherMatch":"unverified","verifiedAt":"2026-11-11T10:00:00Z","installationEnabled":false}
""";
const string updateResultSample = """
{"schemaVersion":1,"status":"succeeded","profile":"inno-machine","installerType":"inno","installerSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","hashMatched":true,"architecture":"x64","architectureCompatible":true,"signature":{"status":"Valid","signerSubject":"CN=VideoLAN, O=VideoLAN","signerThumbprint":"ABC123","timestamped":true},"exitCode":0,"rebootRequired":false,"reason":"Installer completed successfully.","startedAt":"2026-11-12T10:00:00Z","finishedAt":"2026-11-12T10:01:00Z"}
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
    ("Preserves unmatched entries with no catalog source", () =>
    {
        var unmatched = sample.Replace("\"source\":\"winget\"", "\"source\":\"\"")
            .Replace("\"isUpdateAvailable\":true", "\"isUpdateAvailable\":false");
        var inventory = WinGetScanner.Parse(unmatched);
        Require(inventory.Packages.Count == 2);
        Require(inventory.Packages.All(package => package.MatchStatus == "unmatched" && !package.IsUpdateAvailable));
        Require(WinGetScanner.Parse(unmatched.Replace("\"source\":\"\"", "\"source\":null"))
            .Packages.All(package => package.MatchStatus == "unmatched"));
    }),
    ("Rejects update claims without a catalog match", () => Reject(sample.Replace("\"source\":\"winget\"", "\"source\":\"\""))),
    ("Retains matched updates alongside unmatched ARP and MSIX entries", () =>
    {
        const string mixed = """
        {"schemaVersion":1,"scannedAt":"2026-10-30T10:00:00Z","moduleVersion":"1.0.0","packages":[
          {"name":"Docker Desktop","id":"Docker.DockerDesktop","installedVersion":"4.69.0","source":"winget","isUpdateAvailable":true,"availableVersions":["4.97.0"]},
          {"name":"Unmatched desktop app","id":"ARP\\Machine\\X64\\Example","installedVersion":"1.0","source":"","isUpdateAvailable":false,"availableVersions":[]},
          {"name":"Unmatched Store app","id":"MSIX\\Example","installedVersion":"1.0","source":"","isUpdateAvailable":false,"availableVersions":[]}
        ]}
        """;
        var inventory = WinGetScanner.Parse(mixed);
        Require(inventory.Packages.Count(package => package.MatchStatus == "matched") == 1);
        Require(inventory.Packages.Count(package => package.MatchStatus == "unmatched") == 2);
        Require(inventory.Packages.Single(package => package.IsUpdateAvailable).Id == "Docker.DockerDesktop");
    }),
    ("Rejects missing update status", () => Reject(sample.Replace("\"isUpdateAvailable\":true,", ""))),
    ("Rejects contaminated JSON output", () => Reject("Warning: failed\n" + sample)),
    ("Installer verification accepts structured evidence without self-authorizing installation", () =>
    {
        Require(ValidVerification(verificationSample, updateSample));
        Require(ValidVerification(verificationSample
            .Replace("\"x64\"", "\"unknown\"")
            .Replace("\"architectureCompatible\":true", "\"architectureCompatible\":false"), updateSample));
    }),
    ("Installer verification rejects identity drift, unmatched hashes, unknown signature status, and installation enablement", () =>
    {
        foreach (var invalid in new[]
        {
            verificationSample.Replace("\"targetVersion\":\"3.0.23\"", "\"targetVersion\":\"3.0.24\""),
            verificationSample.Replace("\"hashMatched\":true", "\"hashMatched\":false"),
            verificationSample.Replace("\"status\":\"Valid\"", "\"status\":\"Bypassed\""),
            verificationSample.Replace("\"installationEnabled\":false", "\"installationEnabled\":true"),
            verificationSample.Replace("\"architectureCompatible\":true", "\"architectureCompatible\":\"yes\""),
            verificationSample.Replace("\"timestamped\":true", "\"timestamped\":null")
        }) Require(!ValidVerification(invalid, updateSample));
    }),
    ("Update requests require exact identity, version, installer metadata, and binding", () =>
    {
        Require(ValidUpdate(updateSample));
        foreach (var invalid in new[]
        {
            updateSample.Replace("\"VideoLAN.VLC\"", "\"; whoami\""),
            updateSample.Replace("\"VideoLAN.VLC\"", "\"https://example.com\""),
            updateSample.Replace("\"machine\"", "\"unknown\""),
            updateSample.Replace("\"inno\"", "\"\""),
            updateSample.Replace("\"inno-machine\"", "\"msi-machine\""),
            updateSample.Replace("\"inno-machine\"", "\"exe-machine\""),
            updateSample.Replace("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "not-a-hash"),
            updateSample.Replace("00000000-0000-4000-8000-000000000002", "not-a-guid")
        }) Require(!ValidUpdate(invalid));
    }),
    ("Update requests reject browser-supplied command or installer URL properties", () =>
    {
        var trimmed = updateSample.TrimEnd();
        Require(!ValidUpdate(trimmed[..^1] + ",\"command\":\"winget upgrade\"}"));
        Require(!ValidUpdate(trimmed[..^1] + ",\"installerUrl\":\"https://example.com/file.exe\"}"));
    }),
    ("Executed update evidence requires matching identity, valid signature, compatible architecture, and exit code", () =>
    {
        Require(ValidUpdateResult(updateResultSample));
        Require(ValidUpdateResult(updateResultSample.Replace("\"status\":\"succeeded\"", "\"status\":\"blocked\"")
            .Replace("\"exitCode\":0", "\"exitCode\":null")
            .Replace("\"hashMatched\":true", "\"hashMatched\":false")
            .Replace("\"architectureCompatible\":true", "\"architectureCompatible\":false")
            .Replace("\"status\":\"Valid\"", "\"status\":\"Unknown\"")));
        foreach (var invalid in new[]
        {
            updateResultSample.Replace("\"profile\":\"inno-machine\"", "\"profile\":\"msi-machine\""),
            updateResultSample.Replace("\"installerSha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"", "\"installerSha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\""),
            updateResultSample.Replace("\"hashMatched\":true", "\"hashMatched\":false"),
            updateResultSample.Replace("\"architectureCompatible\":true", "\"architectureCompatible\":false"),
            updateResultSample.Replace("\"status\":\"Valid\"", "\"status\":\"NotTrusted\""),
            updateResultSample.Replace("\"exitCode\":0", "\"exitCode\":null"),
            updateResultSample.Replace("\"status\":\"succeeded\"", "\"status\":\"restart_required\"")
        }) Require(!ValidUpdateResult(invalid));
    }),
    ("Preview installer selection parser accepts indented winget show fields", RunPreviewSelectionTest)
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
static bool ValidUpdate(string json)
{
    try { using var document = JsonDocument.Parse(json); UpdateRunner.Validate(document.RootElement); return true; }
    catch (Exception) { return false; }
}
static bool ValidUpdateResult(string result)
{
    try
    {
        using var resultDocument = JsonDocument.Parse(result);
        using var requestDocument = JsonDocument.Parse(updateSample);
        UpdateRunner.ValidateResult(resultDocument.RootElement, requestDocument.RootElement);
        return true;
    }
    catch (Exception) { return false; }
}
static bool ValidVerification(string result, string request)
{
    try
    {
        using var resultDocument = JsonDocument.Parse(result);
        using var requestDocument = JsonDocument.Parse(request);
        InstallerVerifier.ValidateResult(resultDocument.RootElement, requestDocument.RootElement);
        return true;
    }
    catch (Exception) { return false; }
}
static void RunPreviewSelectionTest()
{
    var script=FindTestScript("PreviewSelection.Tests.ps1");
    var start=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe"))
    {UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
    foreach(var argument in new[]{"-NoLogo","-NoProfile","-NonInteractive","-File",script})start.ArgumentList.Add(argument);
    using var process=Process.Start(start)!;
    var output=process.StandardOutput.ReadToEnd();
    var error=process.StandardError.ReadToEnd();
    process.WaitForExit();
    if(process.ExitCode!=0)throw new Exception(error.Trim());
}
static string FindTestScript(string name)
{
    for(var directory=new DirectoryInfo(AppContext.BaseDirectory);directory!=null;directory=directory.Parent)
    {
        var candidate=Path.Combine(directory.FullName,"UpdatePilot.Agent.Tests",name);
        if(File.Exists(candidate))return candidate;
    }
    throw new Exception("Test script not found.");
}
static void Reject(string json)
{
    try { WinGetScanner.Parse(json); }
    catch (JsonException) { return; }
    throw new Exception("Invalid response was accepted.");
}
