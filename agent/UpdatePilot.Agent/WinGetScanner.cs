using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace UpdatePilot.Agent;

internal static class WinGetScanner
{
    public static async Task<WinGetInventory> ScanAsync(CancellationToken cancellationToken)
    {
        // Use the Windows PowerShell host where the user installed the module.
        // Neither executable paths nor command text come from a browser request.
        var executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
            "WindowsPowerShell", "v1.0", "powershell.exe");
        var script = Path.Combine(AppContext.BaseDirectory, "Scripts", "Get-WinGetInventory.ps1");
        if (!File.Exists(script)) throw new IOException("The bundled WinGet inventory script is missing.");

        var start = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8
        };
        foreach (var argument in new[] { "-NoLogo", "-NoProfile", "-NonInteractive", "-File", script })
            start.ArgumentList.Add(argument);

        using var process = new Process { StartInfo = start };
        process.Start();
        var stdout = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderr = process.StandardError.ReadToEndAsync(cancellationToken);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(2));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(CancellationToken.None);
            if (cancellationToken.IsCancellationRequested) throw;
            throw new TimeoutException("WinGet inventory timed out after 2 minutes.");
        }

        var output = await stdout;
        var error = await stderr;
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"WinGet scan failed (exit {process.ExitCode}): {error.Trim()}");
        return Parse(output);
    }

    internal static WinGetInventory Parse(string json)
    {
        var inventory = JsonSerializer.Deserialize<WinGetInventory>(json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new JsonException("WinGet returned no inventory.");
        if (inventory.SchemaVersion != 1 || inventory.ScannedAt == default ||
            string.IsNullOrWhiteSpace(inventory.ModuleVersion) || inventory.Packages is null)
            throw new JsonException("WinGet returned an incomplete or unsupported inventory.");
        foreach (var package in inventory.Packages)
        {
            if (package is null || string.IsNullOrWhiteSpace(package.Id) ||
                string.IsNullOrWhiteSpace(package.Name) ||
                !string.Equals(package.Source, "winget", StringComparison.OrdinalIgnoreCase) ||
                package.AvailableVersions is null || package.AvailableVersions.Any(string.IsNullOrWhiteSpace))
                throw new JsonException("WinGet returned an invalid package record.");
        }
        // Preserve WinGet's version strings and update judgment. AvailableVersions
        // includes historical releases; it is not a list of approved update targets.
        return inventory;
    }
}

internal record WinGetPackage(
    string Name, string Id, string? InstalledVersion, string Source,
    [property: JsonRequired] bool IsUpdateAvailable, List<string> AvailableVersions);

internal record WinGetInventory(
    int SchemaVersion, DateTimeOffset ScannedAt, string ModuleVersion, List<WinGetPackage> Packages);

internal record WinGetScanResult(string Status, WinGetInventory? Inventory, string? Error);
