using System.Security;
using System.Text.Json;
using Microsoft.Win32;
using UpdatePilot.Agent;

// Read-only discovery. WinGet source queries are explicitly enabled by a CLI flag.
if (args.Any(argument => argument != "--with-winget"))
{
    Console.Error.WriteLine("Usage: dotnet run --project .\\UpdatePilot.Agent -- [--with-winget]");
    return 1;
}
const string uninstallPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
var applications = new List<InstalledApplication>();
var warnings = new List<string>();
RegistryView[] views = Environment.Is64BitOperatingSystem
    ? [RegistryView.Registry64, RegistryView.Registry32]
    : [RegistryView.Registry32];

foreach (var hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
{
    foreach (var view in views)
    {
        var scope = hive == RegistryHive.LocalMachine ? "machine" : "user";
        try
        {
            using var root = RegistryKey.OpenBaseKey(hive, view);
            using var uninstall = root.OpenSubKey(uninstallPath, writable: false);
            if (uninstall is null) continue;

            foreach (var keyName in uninstall.GetSubKeyNames())
            {
                try
                {
                    using var entry = uninstall.OpenSubKey(keyName, writable: false);
                    if (entry is null) continue;
                    var name = ReadText(entry, "DisplayName");
                    if (name is null || entry.GetValue("SystemComponent") is int component && component == 1)
                        continue;

                    // Current-user registry views can expose the same physical entry.
                    // Keep distinct registrations; never deduplicate by display name alone.
                    var identity = $"{hive}\\{uninstallPath}\\{keyName}";
                    var version = ReadText(entry, "DisplayVersion");
                    var publisher = ReadText(entry, "Publisher");
                    if (scope == "user" && applications.Any(app =>
                        app.RegistryPath == identity && app.InstalledVersion == version &&
                        app.Name == name && app.Publisher == publisher)) continue;

                    applications.Add(new InstalledApplication(
                        name, version, publisher, scope, view.ToString(), identity,
                        "uninstall-registry", "unmatched"));
                }
                catch (Exception exception) when (IsReadFailure(exception))
                {
                    warnings.Add($"Could not read {scope}/{view}/{keyName}: {exception.Message}");
                }
            }
        }
        catch (Exception exception) when (IsReadFailure(exception))
        {
            warnings.Add($"Could not scan {scope}/{view}: {exception.Message}");
        }
    }
}

var ordered = applications.OrderBy(app => app.Name, StringComparer.OrdinalIgnoreCase)
    .ThenBy(app => app.Scope).ThenBy(app => app.RegistryView).ToList();
WinGetScanResult winget = new("not-requested", null, null);
if (args.Contains("--with-winget"))
{
    Console.WriteLine("Querying WinGet packages (read-only; may take up to 2 minutes)...");
    try
    {
        winget = new("completed", await WinGetScanner.ScanAsync(CancellationToken.None), null);
    }
    catch (Exception exception) when (exception is IOException or InvalidOperationException or
        TimeoutException or JsonException or System.ComponentModel.Win32Exception)
    {
        winget = new("failed", null, exception.Message);
        warnings.Add($"WinGet inventory unavailable: {exception.Message}");
    }
}
var snapshot = new InventorySnapshot(2, DateTimeOffset.UtcNow, ordered, warnings, winget);
var outputPath = Path.GetFullPath(Path.Combine("data", "inventory.json"));
try
{
    Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
    await File.WriteAllTextAsync(outputPath, JsonSerializer.Serialize(snapshot,
        new JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
}
catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
{
    Console.Error.WriteLine($"Could not save inventory: {exception.Message}");
    return 1;
}

Console.WriteLine($"Found {ordered.Count} registered desktop application entries.");
Console.WriteLine($"Machine: {ordered.Count(app => app.Scope == "machine")} | Current user: {ordered.Count(app => app.Scope == "user")}");
Console.WriteLine();
foreach (var app in ordered.Take(20))
    Console.WriteLine($"{app.Name} | {app.InstalledVersion ?? "unknown version"} | {app.Scope}");
if (ordered.Count > 20) Console.WriteLine($"... and {ordered.Count - 20} more entries in the JSON snapshot.");
Console.WriteLine($"\nSaved to: {outputPath}");
Console.WriteLine("Registry view describes where an entry was found, not confirmed application architecture.");
Console.WriteLine("Coverage excludes unregistered portable apps, other users' private installs, and Store/MSIX discovery.");
if (winget.Inventory is { } packageInventory)
{
    var updates = packageInventory.Packages.Where(package => package.IsUpdateAvailable).ToList();
    Console.WriteLine($"\nWinGet: {packageInventory.Packages.Count} package entries; {updates.Count} have updates available.");
    Console.WriteLine($"Catalog matched: {packageInventory.Packages.Count(package => package.MatchStatus == "matched")} | Unmatched: {packageInventory.Packages.Count(package => package.MatchStatus == "unmatched")}");
    foreach (var package in updates)
        Console.WriteLine($"{package.Name} | {package.Id} | Installed: {package.InstalledVersion ?? "unknown"} | Update available");
    Console.WriteLine("Catalog versions are saved in winget.inventory.packages in the JSON snapshot.");
    Console.WriteLine("Registry entries remain unmatched; no name-based correlation or update execution was performed.");
}
foreach (var warning in warnings) Console.Error.WriteLine($"Warning: {warning}");
return warnings.Count > 0 ? 2 : 0;

static string? ReadText(RegistryKey key, string name) =>
    key.GetValue(name) is string text && !string.IsNullOrWhiteSpace(text) ? text.Trim() : null;

static bool IsReadFailure(Exception exception) =>
    exception is UnauthorizedAccessException or SecurityException or IOException;

record InstalledApplication(string Name, string? InstalledVersion, string? Publisher,
    string Scope, string RegistryView, string RegistryPath, string DiscoverySource, string MatchStatus);

record InventorySnapshot(int SchemaVersion, DateTimeOffset ScannedAt,
    List<InstalledApplication> Applications, List<string> Warnings, WinGetScanResult Winget);
