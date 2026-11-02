using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
namespace UpdatePilot.Agent;
internal static class PreviewRunner
{
    public static async Task<JsonElement> ResolveAsync(JsonElement request, string directory, Func<Task> heartbeat, CancellationToken cancellationToken)
    {
        var id=request.GetProperty("packageId").GetString();
        var installed=request.GetProperty("installedVersion").GetString();
        if(id is null || !Regex.IsMatch(id,@"^[A-Za-z0-9][A-Za-z0-9.+_-]{0,199}$") || string.IsNullOrWhiteSpace(installed) || installed.Length>4096 || !Guid.TryParse(request.GetProperty("snapshotId").GetString(),out _))
            throw new InvalidOperationException("Invalid preview request.");
        var file=Path.Combine(directory,"preview-request.json");
        await File.WriteAllTextAsync(file,request.GetRawText(),cancellationToken);
        var start=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe"))
        {UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8};
        foreach(var argument in new[]{"-NoLogo","-NoProfile","-NonInteractive","-File",Path.Combine(AppContext.BaseDirectory,"Scripts","Get-UpdatePreview.ps1"),"-RequestPath",file})start.ArgumentList.Add(argument);
        using var process=Process.Start(start)!;
        var output=process.StandardOutput.ReadToEndAsync(cancellationToken);var errors=process.StandardError.ReadToEndAsync(cancellationToken);
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);timeout.CancelAfter(TimeSpan.FromMinutes(2));
        try{var last=DateTime.UtcNow;while(!process.HasExited){await Task.Delay(1000,timeout.Token);if(DateTime.UtcNow-last>TimeSpan.FromSeconds(10)){await heartbeat();last=DateTime.UtcNow;}}}catch{if(!process.HasExited)process.Kill(entireProcessTree:true);await process.WaitForExitAsync(CancellationToken.None);throw;}
        var text=await output;await errors;
        if(process.ExitCode!=0)throw new InvalidOperationException("Preview resolver failed.");
        using var json=JsonDocument.Parse(text);
        if(json.RootElement.GetProperty("packageId").GetString()!=id)throw new InvalidOperationException("Preview identity mismatch.");
        return json.RootElement.Clone();
    }
}
