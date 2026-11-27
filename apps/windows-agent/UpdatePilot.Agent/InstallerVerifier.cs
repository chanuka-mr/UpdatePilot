using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
namespace UpdatePilot.Agent;
internal static class InstallerVerifier
{
    private static readonly string[] Architectures=["x86","x64","arm64","neutral","unknown"];
    private static readonly string[] SignatureStatuses=["Valid","NotSigned","HashMismatch","NotTrusted","Unknown"];
    private static readonly string[] PublisherMatches=["matched","unverified","mismatch"];

    public static async Task<JsonElement> VerifyAsync(JsonElement request,string directory,Func<Task> heartbeat,CancellationToken cancellationToken)
    {
        UpdateRunner.Validate(request);
        Directory.CreateDirectory(directory);
        var file=Path.Combine(directory,"verify-request.json");
        await File.WriteAllTextAsync(file,request.GetRawText(),cancellationToken);
        var start=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe"))
        {UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8};
        foreach(var argument in new[]{"-NoLogo","-NoProfile","-NonInteractive","-File",Path.Combine(AppContext.BaseDirectory,"Scripts","Get-InstallerVerification.ps1"),"-RequestPath",file})start.ArgumentList.Add(argument);
        using var process=Process.Start(start)!;
        var output=process.StandardOutput.ReadToEndAsync(cancellationToken);var errors=process.StandardError.ReadToEndAsync(cancellationToken);
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);timeout.CancelAfter(TimeSpan.FromMinutes(15));
        try{var last=DateTime.UtcNow;while(!process.HasExited){await Task.Delay(1000,timeout.Token);if(DateTime.UtcNow-last>TimeSpan.FromSeconds(10)){await heartbeat();last=DateTime.UtcNow;}}}catch{if(!process.HasExited)process.Kill(entireProcessTree:true);await process.WaitForExitAsync(CancellationToken.None);throw;}
        var text=await output;await errors;
        if(process.ExitCode!=0)throw new InvalidOperationException("Installer verification failed.");
        using var json=JsonDocument.Parse(text);
        ValidateResult(json.RootElement,request);
        return json.RootElement.Clone();
    }

    public static void ValidateResult(JsonElement result,JsonElement request)
    {
        if(result.ValueKind!=JsonValueKind.Object)throw new InvalidOperationException("Invalid verification result.");
        if(Int(result,"schemaVersion")!=1)throw new InvalidOperationException("Invalid verification schema.");
        foreach(var name in new[]{"packageId","targetVersion","installerType","installerSha256"})
            if(Text(result,name)!=Text(request,name))throw new InvalidOperationException("Verification identity mismatch.");
        var hash=Text(result,"installerSha256");
        if(hash is null||!Regex.IsMatch(hash,@"^[A-Fa-f0-9]{64}$"))throw new InvalidOperationException("Invalid verification hash.");
        if(!TryBool(result,"hashMatched",out var hashMatched)||!hashMatched)throw new InvalidOperationException("Verification hash was not matched.");
        var architecture=Text(result,"architecture");
        if(architecture is null||!Architectures.Contains(architecture,StringComparer.Ordinal))throw new InvalidOperationException("Invalid verification architecture.");
        if(!TryBool(result,"architectureCompatible",out _))throw new InvalidOperationException("Invalid architecture compatibility.");
        if(!result.TryGetProperty("signature",out var signature)||signature.ValueKind!=JsonValueKind.Object)throw new InvalidOperationException("Invalid verification signature.");
        var status=Text(signature,"status");
        if(status is null||!SignatureStatuses.Contains(status,StringComparer.Ordinal))throw new InvalidOperationException("Invalid verification signature status.");
        foreach(var name in new[]{"signerSubject","signerThumbprint"})
            if(!signature.TryGetProperty(name,out var value)||value.ValueKind is not (JsonValueKind.Null or JsonValueKind.String))throw new InvalidOperationException("Invalid verification signer.");
        if(!TryBool(signature,"timestamped",out _))throw new InvalidOperationException("Invalid signature timestamp.");
        var publisherMatch=Text(result,"publisherMatch");
        if(publisherMatch is null||!PublisherMatches.Contains(publisherMatch,StringComparer.Ordinal))throw new InvalidOperationException("Invalid publisher match.");
        if(!DateTimeOffset.TryParse(Text(result,"verifiedAt"),out _))throw new InvalidOperationException("Invalid verification timestamp.");
        if(!TryBool(result,"installationEnabled",out var installationEnabled)||installationEnabled)throw new InvalidOperationException("Installation must remain disabled.");
    }

    private static string? Text(JsonElement element,string name)=>element.TryGetProperty(name,out var value)&&value.ValueKind==JsonValueKind.String?value.GetString():null;
    private static int? Int(JsonElement element,string name)=>element.TryGetProperty(name,out var value)&&value.ValueKind==JsonValueKind.Number&&value.TryGetInt32(out var number)?number:null;
    private static bool TryBool(JsonElement element,string name,out bool value)
    {
        value=false;
        if(!element.TryGetProperty(name,out var property)||property.ValueKind is not (JsonValueKind.True or JsonValueKind.False))return false;
        value=property.GetBoolean();return true;
    }
}
