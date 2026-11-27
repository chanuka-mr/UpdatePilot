using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
namespace UpdatePilot.Agent;

internal static class UpdateRunner
{
    private static readonly string[] Fields =
        ["packageId", "installedVersion", "targetVersion", "installerType", "installerSha256", "scope", "profile", "snapshotId", "previewJobId"];
    private static readonly string[] Profiles =
        ["msi-user", "msi-machine", "inno-user", "inno-machine", "nsis-user", "nsis-machine", "burn-user", "burn-machine"];
    private static readonly string[] ResultStatuses = ["succeeded", "restart_required", "failed", "blocked"];
    private static readonly string[] Architectures = ["x86", "x64", "arm64", "neutral", "unknown"];
    private static readonly string[] SignatureStatuses = ["Valid", "NotSigned", "HashMismatch", "NotTrusted", "Unknown"];

    public static void Validate(JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("Invalid update request.");
        // Reject unknown properties so browser-supplied commands, installer URLs, or paths can never pass through.
        foreach (var property in request.EnumerateObject())
            if (!Fields.Contains(property.Name, StringComparer.Ordinal))
                throw new InvalidOperationException("Unexpected update request property.");
        var packageId = Text(request, "packageId");
        if (packageId is null || !Regex.IsMatch(packageId, @"^[A-Za-z0-9][A-Za-z0-9.+_-]{0,199}$"))
            throw new InvalidOperationException("Invalid update package identity.");
        var installed = Text(request, "installedVersion");
        if (string.IsNullOrWhiteSpace(installed) || installed.Length > 4096)
            throw new InvalidOperationException("Invalid installed version.");
        var target = Text(request, "targetVersion");
        if (string.IsNullOrWhiteSpace(target) || target.Length > 4096)
            throw new InvalidOperationException("Invalid target version.");
        var installerType = Text(request, "installerType");
        if (string.IsNullOrWhiteSpace(installerType) || installerType.Length > 128)
            throw new InvalidOperationException("Invalid installer type.");
        var hash = Text(request, "installerSha256");
        if (hash is null || !Regex.IsMatch(hash, @"^[A-Fa-f0-9]{64}$"))
            throw new InvalidOperationException("Invalid installer hash.");
        var scope = Text(request, "scope");
        if (scope is not ("user" or "machine"))
            throw new InvalidOperationException("Invalid installation scope.");
        var profile = Text(request, "profile");
        if (profile is null || !Profiles.Contains(profile, StringComparer.Ordinal))
            throw new InvalidOperationException("Invalid execution profile.");
        if (profile != ProfileFor(installerType, scope))
            throw new InvalidOperationException("Execution profile does not match the installer identity.");
        if (!Guid.TryParse(Text(request, "snapshotId"), out _) || !Guid.TryParse(Text(request, "previewJobId"), out _))
            throw new InvalidOperationException("Invalid update request binding.");
    }

    public static string? ProfileFor(string installerType, string scope)
    {
        var family = installerType.Trim().ToLowerInvariant() switch
        {
            "msi" or "wix" => "msi",
            "inno" => "inno",
            "nullsoft" or "nsis" => "nsis",
            "burn" => "burn",
            _ => null,
        };
        return family is null || scope is not ("user" or "machine") ? null : $"{family}-{scope}";
    }

    public static async Task<JsonElement> ExecuteAsync(JsonElement request, string directory,
        Func<string, int, string?, Task> report, Func<Task> heartbeat, CancellationToken cancellationToken)
    {
        Validate(request);
        Directory.CreateDirectory(directory);
        var requestPath = Path.Combine(directory, "update-request.json");
        var progressPath = Path.Combine(directory, "progress.json");
        await File.WriteAllTextAsync(requestPath, request.GetRawText(), cancellationToken);
        var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"))
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8 };
        foreach (var argument in new[] { "-NoLogo", "-NoProfile", "-NonInteractive", "-File",
            Path.Combine(AppContext.BaseDirectory, "Scripts", "Invoke-InstallerUpdate.ps1"), "-RequestPath", requestPath, "-ProgressPath", progressPath })
            start.ArgumentList.Add(argument);
        using var process = Process.Start(start)!;
        var output = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var errors = process.StandardError.ReadToEndAsync(cancellationToken);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(30));
        var lastHeartbeat = DateTime.UtcNow;
        var lastStage = string.Empty;
        try
        {
            while (!process.HasExited)
            {
                await Task.Delay(1000, timeout.Token);
                if (File.Exists(progressPath))
                {
                    try
                    {
                        using var progress = JsonDocument.Parse(await File.ReadAllTextAsync(progressPath, timeout.Token));
                        var stage = Text(progress.RootElement, "stage");
                        var percent = Int(progress.RootElement, "percent");
                        var message = Text(progress.RootElement, "message");
                        if (stage is not null && percent is not null)
                        {
                            var fingerprint = $"{stage}:{percent}:{message}";
                            if (fingerprint != lastStage)
                            {
                                lastStage = fingerprint;
                                await report(stage, percent.Value, message);
                            }
                        }
                    }
                    catch (IOException) { }
                    catch (JsonException) { }
                }
                if (DateTime.UtcNow - lastHeartbeat > TimeSpan.FromSeconds(10))
                {
                    await heartbeat();
                    lastHeartbeat = DateTime.UtcNow;
                }
            }
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(CancellationToken.None);
            cancellationToken.ThrowIfCancellationRequested();
            throw new TimeoutException("Update execution timed out.");
        }
        var text = await output;
        await errors;
        if (process.ExitCode != 0) throw new InvalidOperationException("Update execution failed before producing a result.");
        using var json = JsonDocument.Parse(text);
        ValidateResult(json.RootElement, request);
        return json.RootElement.Clone();
    }

    public static void ValidateResult(JsonElement result, JsonElement request)
    {
        if (result.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("Invalid update result.");
        if (Int(result, "schemaVersion") != 1) throw new InvalidOperationException("Invalid update result schema.");
        var status = Text(result, "status");
        if (status is null || !ResultStatuses.Contains(status, StringComparer.Ordinal)) throw new InvalidOperationException("Invalid update result status.");
        if (Text(result, "profile") != Text(request, "profile")) throw new InvalidOperationException("Update result profile mismatch.");
        foreach (var name in new[] { "installerType", "installerSha256" })
            if (Text(result, name) != Text(request, name)) throw new InvalidOperationException("Update result identity mismatch.");
        if (!TryBool(result, "hashMatched", out var hashMatched)) throw new InvalidOperationException("Invalid hash match.");
        var architecture = Text(result, "architecture");
        if (architecture is null || !Architectures.Contains(architecture, StringComparer.Ordinal)) throw new InvalidOperationException("Invalid update architecture.");
        if (!TryBool(result, "architectureCompatible", out var architectureCompatible)) throw new InvalidOperationException("Invalid architecture compatibility.");
        if (!result.TryGetProperty("signature", out var signature) || signature.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("Invalid update signature.");
        var signatureStatus = Text(signature, "status");
        if (signatureStatus is null || !SignatureStatuses.Contains(signatureStatus, StringComparer.Ordinal)) throw new InvalidOperationException("Invalid update signature status.");
        if (!TryBool(result, "rebootRequired", out _)) throw new InvalidOperationException("Invalid reboot requirement.");
        var reason = Text(result, "reason");
        if (string.IsNullOrWhiteSpace(reason) || reason.Length > 4096) throw new InvalidOperationException("Invalid update result reason.");
        if (!DateTimeOffset.TryParse(Text(result, "startedAt"), out _) || !DateTimeOffset.TryParse(Text(result, "finishedAt"), out _))
            throw new InvalidOperationException("Invalid update timestamps.");
        var hasExitCode = result.TryGetProperty("exitCode", out var exitCode);
        if (!hasExitCode || exitCode.ValueKind is not (JsonValueKind.Null or JsonValueKind.Number) || (exitCode.ValueKind == JsonValueKind.Number && !exitCode.TryGetInt32(out _)))
            throw new InvalidOperationException("Invalid update exit code.");
        if (status == "blocked")
        {
            if (exitCode.ValueKind != JsonValueKind.Null) throw new InvalidOperationException("A blocked update cannot report an exit code.");
            return;
        }
        if (!hashMatched || !architectureCompatible || signatureStatus != "Valid" || exitCode.ValueKind != JsonValueKind.Number)
            throw new InvalidOperationException("Executed update evidence is incomplete.");
        if (status == "restart_required" && !result.GetProperty("rebootRequired").GetBoolean())
            throw new InvalidOperationException("Restart requirement is inconsistent.");
    }

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static int? Int(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) ? number : null;
    private static bool TryBool(JsonElement element, string name, out bool value)
    {
        value = false;
        if (!element.TryGetProperty(name, out var property) || property.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
        value = property.GetBoolean(); return true;
    }
}
