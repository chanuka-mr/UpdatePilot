using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace UpdatePilot.Agent;

internal static class AgentConnection
{
    public static async Task<int> RunAsync(string mode)
    {
        var endpoint = new Uri(Environment.GetEnvironmentVariable("UPDATEPILOT_API_URL") ?? "http://127.0.0.1:4010");
        if (endpoint.Scheme != "http" || !new[] { "127.0.0.1", "localhost" }.Contains(endpoint.Host))
        { Console.Error.WriteLine("Only a local loopback backend is supported."); return 1; }
        var state = Path.GetFullPath(Environment.GetEnvironmentVariable("UPDATEPILOT_STATE_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UpdatePilot"));
        Directory.CreateDirectory(state);
        var credentialPath = Path.Combine(state, "credential.bin");
        using var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { BaseAddress = endpoint, Timeout = TimeSpan.FromSeconds(45) };
        using var cancel = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; cancel.Cancel(); };
        try
        {
            if (mode == "--pair")
            {
                Console.Write("Enter the temporary pairing code from Settings: ");
                var code = Console.ReadLine()?.Trim();
                var result = await Post(client, "pair", new { code }, cancel.Token);
                var token = result.GetProperty("token").GetString()!;
                var encrypted = UserProtection.Transform(Encoding.UTF8.GetBytes(token), false);
                var temporary = credentialPath + ".tmp";
                await File.WriteAllBytesAsync(temporary, encrypted, cancel.Token);
                File.Move(temporary, credentialPath, overwrite: true);
                Console.WriteLine("Paired. The device credential is protected for this Windows user. Run --listen next.");
                return 0;
            }
            if (!File.Exists(credentialPath)) { Console.Error.WriteLine("Pair this Windows user first using --pair."); return 1; }
            using var instanceLock = new FileStream(Path.Combine(state, "listener.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            var credential = Encoding.UTF8.GetString(UserProtection.Transform(await File.ReadAllBytesAsync(credentialPath, cancel.Token), true));
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", credential);
            Console.WriteLine("Agent listening for scan and read-only metadata-preview jobs. Keep this terminal open. Ctrl+C stops it.");
            while (!cancel.IsCancellationRequested)
            {
                try
                {
                    await Post(client, "heartbeat", new { }, cancel.Token);
                    await UploadPending(client, state, cancel.Token);
                    var claim = await Post(client, "claim", new { }, cancel.Token);
                    if (claim.TryGetProperty("job", out var job) && job.ValueKind != JsonValueKind.Null)
                    {
                        var operation = job.GetProperty("operation").GetString();
                        if (operation is not ("scan" or "preview")) throw new InvalidOperationException("Unsupported job operation.");
                        var id = job.GetProperty("id").GetString()!;
                        if (!Guid.TryParse(id, out _)) throw new InvalidOperationException("Invalid job ID.");
                        var lease = job.GetProperty("lease").GetString()!;
                        if(operation=="preview")await PreviewAndUpload(client,state,id,lease,job.GetProperty("request"),cancel.Token);
                        else await ScanAndUpload(client, state, id, lease, cancel.Token);
                    }
                }
                catch (UnauthorizedAccessException) { Console.Error.WriteLine("Agent credential revoked or unknown. Pair again in Settings."); return 1; }
                catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
                { if (!cancel.IsCancellationRequested) Console.Error.WriteLine("Backend unavailable. Reconnecting in 10 seconds; no job is automatically rerun."); }
                await Task.Delay(TimeSpan.FromSeconds(10), cancel.Token);
            }
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested) { return 0; }
        catch (Exception ex) when (ex is IOException or HttpRequestException or InvalidOperationException or System.ComponentModel.Win32Exception or UnauthorizedAccessException or JsonException)
        { Console.Error.WriteLine("Agent operation failed. Check the backend, migration, and pairing state. Credentials were not printed."); return 1; }
        return 0;
    }

    private static async Task ScanAndUpload(HttpClient client, string state, string id, string lease, CancellationToken cancellationToken)
    {
        Console.WriteLine($"Starting scan job {id}.");
        var jobDirectory = Path.Combine(state, "jobs", id);
        Directory.CreateDirectory(jobDirectory);
        var start = new ProcessStartInfo(Environment.ProcessPath!) { WorkingDirectory = jobDirectory, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        if (string.Equals(Path.GetFileNameWithoutExtension(Environment.ProcessPath), "dotnet", StringComparison.OrdinalIgnoreCase))
            start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        start.ArgumentList.Add("--with-winget");
        using var process = Process.Start(start)!;
        var output = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var errors = process.StandardError.ReadToEndAsync(cancellationToken);
        using var scanTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        scanTimeout.CancelAfter(TimeSpan.FromMinutes(3));
        string? failure = null;
        try
        {
            while (!process.HasExited)
            {
                await Task.Delay(1000, scanTimeout.Token);
                if (DateTime.UtcNow.Second % 10 == 0) await Post(client, "heartbeat", new { }, cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(CancellationToken.None);
            cancellationToken.ThrowIfCancellationRequested(); failure = "scan_timeout";
        }
        catch
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(CancellationToken.None); throw;
        }
        await output; await errors;
        var file = Path.Combine(jobDirectory, "data", "inventory.json");
        if (failure is null && (process.ExitCode is not (0 or 2) || !File.Exists(file))) failure = "scan_failed";
        JsonElement? snapshot = null;
        if (failure is null)
        {
            using var json = JsonDocument.Parse(await File.ReadAllTextAsync(file, cancellationToken));
            snapshot = json.RootElement.Clone();
        }
        // Persist an upload envelope before sending. A reconnect resends the result,
        // never reruns the scan. Backend completion is idempotent for this lease.
        var envelope = failure is null ? JsonSerializer.Serialize(new { jobId = id, lease, snapshot }) : JsonSerializer.Serialize(new { jobId = id, lease, error = failure });
        var pending = Path.Combine(state, "pending.bin");
        await File.WriteAllBytesAsync(pending + ".tmp", UserProtection.Transform(Encoding.UTF8.GetBytes(envelope), false), cancellationToken);
        File.Move(pending + ".tmp", pending, overwrite: true);
        var accepted = await UploadPending(client, state, cancellationToken);
        if (File.Exists(file)) File.Delete(file);
        Console.WriteLine(accepted ? "Scan result accepted by the backend. Refresh the dashboard to see it." : "Scan result was rejected. Check the job state; no scan will be automatically repeated.");
    }
    private static async Task PreviewAndUpload(HttpClient client,string state,string id,string lease,JsonElement request,CancellationToken cancellationToken)
    {
        var directory=Path.Combine(state,"jobs",id);Directory.CreateDirectory(directory);
        string envelope;
        try{var preview=await PreviewRunner.ResolveAsync(request,directory,async()=>{await Post(client,"heartbeat",new{},cancellationToken);},cancellationToken);envelope=JsonSerializer.Serialize(new{jobId=id,lease,preview});}
        catch(Exception ex) when(ex is InvalidOperationException or JsonException or TaskCanceledException or IOException)
        {cancellationToken.ThrowIfCancellationRequested();envelope=JsonSerializer.Serialize(new{jobId=id,lease,error="preview_failed"});}
        var pending=Path.Combine(state,"pending.bin");
        await File.WriteAllBytesAsync(pending+".tmp",UserProtection.Transform(Encoding.UTF8.GetBytes(envelope),false),cancellationToken);File.Move(pending+".tmp",pending,overwrite:true);
        Console.WriteLine(await UploadPending(client,state,cancellationToken)?"Read-only preview result uploaded. Installation remains disabled.":"Preview result rejected. No installation was attempted.");
    }
    private static async Task<bool> UploadPending(HttpClient client, string state, CancellationToken cancellationToken)
    {
        var pending = Path.Combine(state, "pending.bin");
        if (!File.Exists(pending)) return true;
        var bytes = UserProtection.Transform(await File.ReadAllBytesAsync(pending, cancellationToken), true);
        using var response = await client.PostAsync("/api/v1/agent/result", new ByteArrayContent(bytes) { Headers = { ContentType = new MediaTypeHeaderValue("application/json") } }, cancellationToken);
        if (response.StatusCode == HttpStatusCode.Unauthorized) throw new UnauthorizedAccessException();
        if (response.StatusCode is HttpStatusCode.Conflict or HttpStatusCode.Forbidden or HttpStatusCode.BadRequest or HttpStatusCode.RequestEntityTooLarge)
        { File.Delete(pending); Console.Error.WriteLine("Stored result rejected because the job or snapshot is no longer valid. No scan was repeated."); return false; }
        response.EnsureSuccessStatusCode(); File.Delete(pending); return true;
    }
    private static async Task<JsonElement> Post(HttpClient client, string action, object value, CancellationToken cancellationToken)
    {
        using var response = await client.PostAsJsonAsync($"/api/v1/agent/{action}", value, cancellationToken);
        if (response.StatusCode == HttpStatusCode.Unauthorized) throw new UnauthorizedAccessException();
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        return json.RootElement.Clone();
    }
}

// Windows DPAPI, current-user scope. UI is forbidden; no password or key is embedded.
internal static class UserProtection
{
    [StructLayout(LayoutKind.Sequential)] private struct Blob { public int Length; public IntPtr Data; }
    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CryptProtectData(ref Blob input, string? description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);
    [DllImport("crypt32.dll", SetLastError = true)] private static extern bool CryptUnprotectData(ref Blob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr pointer);
    public static byte[] Transform(byte[] bytes, bool decrypt)
    {
        var input = new Blob { Length = bytes.Length, Data = Marshal.AllocHGlobal(bytes.Length) };
        Blob output = default;
        try
        {
            Marshal.Copy(bytes, 0, input.Data, bytes.Length);
            var ok = decrypt ? CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output) : CryptProtectData(ref input, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output);
            if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            var result = new byte[output.Length]; Marshal.Copy(output.Data, result, 0, output.Length); return result;
        }
        finally { Marshal.FreeHGlobal(input.Data); if (output.Data != IntPtr.Zero) LocalFree(output.Data); }
    }
}
