using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace AiCanvas.WebViewHost;

internal sealed class DocumentDispatchBroker : IDisposable
{
    private const int MaximumRequestBytes = 65536;
    private readonly Mutex _primary;
    private readonly CancellationTokenSource _stop = new();
    private Task? _listener;
    internal string RunRoot { get; } = System.IO.Path.GetFullPath(AppContext.BaseDirectory).TrimEnd('\\');
    internal bool IsPrimary { get; }
    internal DocumentDispatchBroker()
    {
        _primary = new Mutex(false, DocumentRunScope.Channel + ".Owner");
        try { IsPrimary = _primary.WaitOne(0); }
        catch (AbandonedMutexException) { IsPrimary = true; }
    }
    internal void Start(Func<DocumentDispatchRequest, Task<DocumentDispatchResult>> dispatch)
    {
        if (!IsPrimary || _listener is not null) throw new InvalidOperationException("派发器状态不匹配。");
        _listener = Task.Run(async () =>
        {
            while (!_stop.IsCancellationRequested)
            {
                try
                {
                    using var pipe = new NamedPipeServerStream(DocumentRunScope.Channel, PipeDirection.InOut, 1,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    await pipe.WaitForConnectionAsync(_stop.Token);
                    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(_stop.Token);
                    timeout.CancelAfter(TimeSpan.FromSeconds(45));
                    var json = await ReadAsync(pipe, timeout.Token);
                    var request = DocumentDispatchProtocol.Parse(json, RunRoot);
                    var result = await dispatch(request).WaitAsync(timeout.Token);
                    await WriteAsync(pipe, DocumentDispatchProtocol.Reply(result), timeout.Token);
                }
                catch (OperationCanceledException) { }
                catch (Exception error) when (error is IOException or InvalidOperationException or JsonException or DecoderFallbackException) { }
            }
        });
    }
    internal async Task<DocumentDispatchResult> ForwardAsync(string? path)
    {
        if (IsPrimary) throw new InvalidOperationException("主实例不能转发自身。");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(45));
        using var pipe = new NamedPipeClientStream(".", DocumentRunScope.Channel, PipeDirection.InOut,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        await pipe.ConnectAsync(timeout.Token);
        await WriteAsync(pipe, JsonSerializer.Serialize(new DocumentDispatchRequest(1, RunRoot, path is null ? "activate" : "open", path)), timeout.Token);
        var result = DocumentDispatchProtocol.ParseReply(await ReadAsync(pipe, timeout.Token));
        if (result == DocumentDispatchResult.Rejected) throw new IOException("当前窗口未接受请求，可能正在加载、拖动或关闭文档。请稍后重试。");
        return result;
    }
    private static async Task<string> ReadAsync(Stream stream, CancellationToken token)
    {
        var header = new byte[4]; await stream.ReadExactlyAsync(header, token);
        var length = System.Buffers.Binary.BinaryPrimitives.ReadInt32LittleEndian(header);
        if (length is < 1 or > MaximumRequestBytes) throw new IOException("派发请求长度无效。");
        var bytes = new byte[length]; await stream.ReadExactlyAsync(bytes, token);
        return new UTF8Encoding(false, true).GetString(bytes);
    }
    private static async Task WriteAsync(Stream stream, string value, CancellationToken token)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        if (bytes.Length > MaximumRequestBytes) throw new IOException("派发请求过长。");
        var header = new byte[4]; System.Buffers.Binary.BinaryPrimitives.WriteInt32LittleEndian(header, bytes.Length);
        await stream.WriteAsync(header, token); await stream.WriteAsync(bytes, token); await stream.FlushAsync(token);
    }
    public void Dispose()
    {
        _stop.Cancel();
        if (IsPrimary) _primary.ReleaseMutex();
        _primary.Dispose();
    }
}
