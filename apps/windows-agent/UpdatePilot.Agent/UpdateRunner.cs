using System.Text.Json;
using System.Text.RegularExpressions;
namespace UpdatePilot.Agent;
internal static class UpdateRunner
{
    private static readonly string[] Fields =
        ["packageId", "installedVersion", "targetVersion", "installerType", "installerSha256", "scope", "snapshotId", "previewJobId"];

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
        if (!Guid.TryParse(Text(request, "snapshotId"), out _) || !Guid.TryParse(Text(request, "previewJobId"), out _))
            throw new InvalidOperationException("Invalid update request binding.");
    }

    // Execution is intentionally unreachable until architecture and signature
    // verification plus pre-install checks are implemented. A queued update job
    // is acknowledged with a safe blocked result and never runs winget.
    public static string BlockedEnvelope(string jobId, string lease, JsonElement request)
    {
        Validate(request);
        return JsonSerializer.Serialize(new { jobId, lease, error = "update_blocked" });
    }

    private static string? Text(JsonElement request, string name) =>
        request.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
