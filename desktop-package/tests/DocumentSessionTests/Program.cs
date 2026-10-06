using AiCanvas.WebViewHost;
var checks = 0;
void Check(bool condition, string message) { if (!condition) throw new Exception(message); checks++; Console.WriteLine("PASS " + message); }
var a = new DocumentSessionState("C:\\test\\A.excalidraw");
var b = new DocumentSessionState("C:\\test\\B.excalidraw");
a.Observe(a.Id, 2, true); b.Observe(b.Id, 3, true);
Check(!a.Observe(b.Id, 4, false) && a.Dirty, "another document cannot clear dirty state");
Check(a.BeginSave("one", 2), "save captures a document revision");
a.Observe(a.Id, 3, true);
Check(!a.CompleteSave(new(a.Id, "one", 2, "saved"), "C:\\test\\A.excalidraw") && a.Dirty, "stale save cannot close newer edits");
foreach(var status in new[]{"cancelled", "failed"}) {
    a.BeginSave(status, 3);
    Check(!a.CompleteSave(new(a.Id,status,3,status), null) && a.Dirty, status+" retains the document");
}
var plan = new DocumentClosePlan(); plan.Approve(a, true);
Check(!plan.Ready(new[]{a,b}), "window cannot close before every document decision");
plan.Approve(b, true); Check(plan.Ready(new[]{a,b}), "all explicit discard decisions complete the close plan");
b.Observe(b.Id,4,true); Check(!plan.Ready(new[]{a,b}), "new edit invalidates a prepared close plan");
Check(a.Id != b.Id, "document identities are independent");
var queue = new DocumentSaveQueue();
var disk = "";
await queue.WriteAsync(3, () => { disk = "revision-3"; return Task.FromResult<string?>("C:\\test\\A.excalidraw"); });
var oldWrite = await queue.WriteAsync(2, () => { disk = "revision-2"; return Task.FromResult<string?>("C:\\test\\A.excalidraw"); });
Check(!oldWrite.Written && disk == "revision-3", "older delayed write cannot regress disk contents");
var held = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
var first = queue.WriteAsync(4, () => held.Task);
var secondStarted = false;
var second = queue.WriteAsync(5, () => { secondStarted = true; return Task.FromResult<string?>("C:\\test\\A.excalidraw"); });
Check(!secondStarted, "same-document file writes are serialized");
held.SetResult("C:\\test\\A.excalidraw"); await first; await second;
Check(secondStarted, "queued newer write proceeds after prior write completes");
var cancelledPlan = new DocumentClosePlan(); cancelledPlan.Approve(a, true);
cancelledPlan = new DocumentClosePlan();
Check(!cancelledPlan.Ready(new[]{a}), "discard approval does not survive a cancelled window-close attempt");
var root = "C:\\Candidate\\host";
var valid = System.Text.Json.JsonSerializer.Serialize(new DocumentDispatchRequest(1, root, "open", "C:\\files\\A.EXCALIDRAW"));
Check(DocumentDispatchProtocol.Parse(valid, root).Path == "C:\\files\\A.EXCALIDRAW", "same-root local file dispatch accepted without reading file bytes");
foreach(var invalid in new[]{
    new DocumentDispatchRequest(1, "C:\\Foreign\\host", "open", "C:\\files\\A.excalidraw"),
    new DocumentDispatchRequest(1, root, "--stop-bridge", null),
    new DocumentDispatchRequest(1, root, "open", "https://remote/A.excalidraw"),
    new DocumentDispatchRequest(1, root, "activate", "C:\\files\\A.excalidraw")}) {
    var rejected = false;
    try { DocumentDispatchProtocol.Parse(System.Text.Json.JsonSerializer.Serialize(invalid), root); }
    catch(Exception) { rejected = true; }
    Check(rejected, "foreign root, component commands, remote URL or activate path rejected");
}
var reopened = new DocumentSessionState("C:\\test\\A.excalidraw");
Check(reopened.Id != a.Id && reopened.RecoveryId == a.RecoveryId, "same path has fresh runtime identity and stable recovery identity");
Check(new DocumentSessionState("D:\\test\\A.excalidraw").RecoveryId != a.RecoveryId, "same filename at another path has separate recovery identity");
var delayed = new DocumentSessionState();
var barrier = new DocumentCloseStateBarrier(delayed);
string refreshRequest = "";
var refreshed = barrier.RefreshAsync(id => refreshRequest = id, TimeSpan.FromSeconds(1));
Check(!refreshed.IsCompleted && !delayed.Dirty, "close waits for fresh state while ordinary dirty notification is delayed");
Check(!barrier.Receive(b.Id, refreshRequest, true, 1, true) && !refreshed.IsCompleted, "another document cannot satisfy close freshness");
Check(!barrier.Receive(delayed.Id, "old-request", true, 1, false) && !refreshed.IsCompleted, "an old request cannot satisfy close freshness");
Check(barrier.Receive(delayed.Id, refreshRequest, true, 1, true) && await refreshed && delayed.Dirty,
    "fresh correlated reply reveals unsaved edits before close decision");
var freshPlan = new DocumentClosePlan(); freshPlan.Approve(delayed, false);
Check(!freshPlan.Ready(new[] { delayed }), "fresh dirty state cannot take the clean close path");
delayed.Observe(delayed.Id, 5, true);
refreshed = barrier.RefreshAsync(id => refreshRequest = id, TimeSpan.FromSeconds(1));
Check(!barrier.Receive(delayed.Id, refreshRequest, true, 4, false) && !refreshed.IsCompleted, "stale revision cannot clear newer edits at close");
barrier.Receive(delayed.Id, refreshRequest, false, 0, false);
Check(!await refreshed && delayed.Dirty, "unready refresh preserves the document rather than guessing clean");
refreshed = barrier.RefreshAsync(id => refreshRequest = id, TimeSpan.Zero);
Check(!await refreshed, "missing refresh reply times out without granting close");
Check(!barrier.Receive(delayed.Id, refreshRequest, true, 5, false), "a late reply after timeout is ignored");
refreshed = barrier.RefreshAsync(id => refreshRequest = id, TimeSpan.FromSeconds(1));
barrier.Receive(delayed.Id, refreshRequest, true, 6, true);
Check(await refreshed, "a new close attempt uses its own fresh request after failure");
foreach (var closeKind in new[] { "tab", "whole-window" }) {
    var inputEnabled = true;
    using (var gate = new DocumentCloseInputGate(enabled => inputEnabled = enabled)) {
        Check(!inputEnabled, closeKind + " blocks input throughout freshness and user decision");
        // Simulate cancellation of this close attempt, not document disposal.
    }
    Check(inputEnabled, closeKind + " cancellation restores interaction");
    using (var gate = new DocumentCloseInputGate(enabled => inputEnabled = enabled)) {
        using var cancellation = new CancellationTokenSource();
        refreshed = barrier.RefreshAsync(_ => { }, TimeSpan.FromSeconds(1), cancellation.Token);
        cancellation.Cancel();
        Check(!await refreshed && !inputEnabled, closeKind + " failed refresh never closes or unlocks early");
    }
    Check(inputEnabled, closeKind + " failed refresh restores interaction");
}
var operationBusy = false;
var readyTask = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
var opened = 0;
var uiOpen = DocumentOpenOperation.TryRunAsync(() => operationBusy, value => operationBusy = value, async () => {
    opened++; if (!await readyTask.Task) throw new InvalidOperationException("ReadyTask failed");
});
Check(operationBusy && !uiOpen.IsCompleted, "UI open holds shared busy flag while ReadyTask is delayed");
var concurrentDispatch = await DocumentOpenOperation.TryRunAsync(() => operationBusy, value => operationBusy = value, () => { opened++; return Task.CompletedTask; });
Check(!concurrentDispatch && opened == 1, "concurrent dispatch is rejected, never accepted without opening a tab");
readyTask.SetResult(true);
Check(await uiOpen && !operationBusy, "only completed ReadyTask permits accepted and releases shared flag");
Check(await DocumentOpenOperation.TryRunAsync(() => operationBusy, value => operationBusy = value, () => { opened++; return Task.CompletedTask; }) && opened == 2,
    "normal open after busy completes creates its document and succeeds");
foreach (var operation in new[] { "drag", "single-tab close", "window close input block" }) {
    var accepted = await DocumentOpenOperation.TryRunAsync(() => true, value => operationBusy = value, () => { opened++; return Task.CompletedTask; });
    Check(!accepted && opened == 2, operation + " cannot silently accept a new document");
}
try {
    await DocumentOpenOperation.TryRunAsync(() => operationBusy, value => operationBusy = value, () => throw new InvalidOperationException("failed ReadyTask"));
    throw new Exception("Expected failed open");
} catch (InvalidOperationException) { Check(!operationBusy, "failed readiness propagates failure and releases shared operation flag"); }
Check(DocumentDragGeometry.DetachedSize(1280, 800, false) == new DocumentSize(960,600), "normal default detaches at 75 percent constrained by minimum");
Check(DocumentDragGeometry.DetachedSize(1920, 1200, false) == new DocumentSize(1280,800), "normal large RestoreBounds respects explicit upper bounds");
Check(DocumentDragGeometry.DetachedSize(960,600,true) == new DocumentSize(960,600), "lightweight repeated detach does not shrink");
Check(DocumentDragGeometry.DetachedSize(1600,1000,true) == new DocumentSize(1600,1000), "manually enlarged lightweight source retains actual normal size");
Check(DocumentDragGeometry.DetachedSize(1280,800,true,true) == new DocumentSize(960,600), "merge-expanded lightweight detaches at its intended small size");
Check(DocumentDragGeometry.DetachedSize(1920,1200,false,true) == new DocumentSize(1280,800), "merge provenance never overrides normal window sizing");
var mergeSize = new DocumentMergeSizeState();
mergeSize.Remember(new(1280,800)); mergeSize.Observe(new(1920,1080),false);
Check(mergeSize.Matches(new(1280,800)), "maximize preserves the normal merge-size provenance");
mergeSize.Observe(new(1400,850),true); mergeSize.Observe(new(1280,800),true);
Check(!mergeSize.Matches(new(1280,800)), "manual resize clears automatic provenance even after returning to the old size");
mergeSize.Remember(new(1280,800),1); mergeSize.Observe(new(1118,650),true,1.5);
Check(mergeSize.Matches(new(1118,650)), "real display scaling preserves automatic provenance across constrained normal bounds");
mergeSize.Observe(new(1040,620),true,1.5);
Check(!mergeSize.Remembered, "manual normal resize at the same display density clears provenance");
var placement=DocumentDragGeometry.Place(700,200,100,17,new(960,600),new(0,0,1680,1002),1);
Check(placement == new DocumentBounds(600,183,960,600), "drop pointer aligns with title grab point");
placement=DocumentDragGeometry.Place(10000,10000,100,17,new(960,600),new(0,0,1680,1002),1.5);
Check(placement == new DocumentBounds(228,90,1440,900), "150 percent uses physical dimensions and eight DIP safety margin");
placement=DocumentDragGeometry.Place(0,0,100,17,new(900,600),new(-800,0,800,500),1);
Check(placement.Width==900 && placement.Height==600 && placement.Left==-792 && placement.Top==8, "small work area keeps minimum and reachable title");
var slots=new (double Left,double Width)[]{(0,238),(238,238)};
Check(DocumentDragGeometry.InsertSlot(118,slots,0)==0 && DocumentDragGeometry.InsertSlot(119,slots,0)==1 && DocumentDragGeometry.InsertSlot(600,slots,0)==2, "tab midpoint and final insertion slot are exact");
Check(DocumentDragGeometry.ReorderSlot(0,2,2)==1 && DocumentDragGeometry.ReorderSlot(1,0,2)==0, "same-window move adjusts removal offset once");
var dragLease=new DocumentDragLease("A");
Check(dragLease.Accept("A",dragLease.Id) && !dragLease.Accept("B",dragLease.Id) && !dragLease.Accept("A","old"), "capture callback must match document and drag generation");
dragLease.End(); Check(!dragLease.Accept("A",dragLease.Id), "ended/cancelled drag rejects late captures");
Check(DocumentThemeTokens.Mix("#FFFFFF","#000000",.55)=="#8C8C8C" && DocumentThemeTokens.Mix("#FFFFFF","#000000",.24)=="#3D3D3D", "hover ratios preserve 55 and 24 percent rules");
Check(!DocumentThemeTokens.Legal("red") && !DocumentThemeTokens.Legal("#00000000") && DocumentThemeTokens.Legal("#a89bd4"), "native document tokens admit RGB hex only");
Check(!DocumentThemeTokens.Ready(new Dictionary<string,string>()), "missing document palette fails closed rather than selecting fixed theme");
Check(DocumentDragGeometry.ShouldDetach(true,false,false,true,2), "released multi-tab source detaches regardless of foreign OLE effect");
Check(!DocumentDragGeometry.ShouldDetach(false,false,false,true,2) && !DocumentDragGeometry.ShouldDetach(true,true,false,true,2) && !DocumentDragGeometry.ShouldDetach(true,false,true,true,2) && !DocumentDragGeometry.ShouldDetach(true,false,false,false,2), "no release, Escape, owned merge or lost source cannot detach");
foreach (var count in new[]{0,1})
    Check(!DocumentDragGeometry.ShouldDetach(true,false,false,true,count), "empty or single-tab source never creates another window");
Check(!DocumentDragGeometry.ShouldDetach(true,false,true,true,1), "single-tab accepted merge never also creates a window");
var names = new[] { "A", "B", "C" };
Check(DocumentDragGeometry.DropHint(names,1,1)=="位置不变" && DocumentDragGeometry.DropHint(names,2,1)=="位置不变", "both edges around own tab describe an unchanged position");
Check(DocumentDragGeometry.DropHint(names,0,1)=="调整顺序 · 放在「A」之前", "same-window move before another document describes actual order");
Check(DocumentDragGeometry.DropHint(names,3,1)=="调整顺序 · 放在「C」之后", "same-window tail drop accounts for source removal");
Check(DocumentDragGeometry.DropHint(names,2,0)=="调整顺序 · 放在「C」之前", "middle slot describes the neighbor after source removal");
Check(DocumentDragGeometry.DropHint(names,0,-1)=="合并 · 放在「A」之前" && DocumentDragGeometry.DropHint(names,3,-1)=="合并 · 放在「C」之后", "cross-window hint distinguishes merge and both endpoint slots");
Check(DocumentDragGeometry.DropHint(Array.Empty<string>(),0,-1)=="合并到此窗口", "empty receiver has a meaningful merge hint");
Check(DocumentDispatchProtocol.ParseReply(DocumentDispatchProtocol.Reply(DocumentDispatchResult.Accepted))==DocumentDispatchResult.Accepted, "successful dispatch retains accepted reply");
Check(DocumentDispatchProtocol.ParseReply(DocumentDispatchProtocol.Reply(DocumentDispatchResult.RejectedWithNotice))==DocumentDispatchResult.RejectedWithNotice, "host-handled rejection remains a rejection rather than accepted");
Check(DocumentDispatchProtocol.ParseReply("unknown")==DocumentDispatchResult.Rejected && DocumentDispatchProtocol.ParseReply("rejected")==DocumentDispatchResult.Rejected, "unknown and unhandled responses never grant acceptance");
var standard = new DocumentSize(1280,800);var minimum = new DocumentSize(900,600);
Check(DocumentDragGeometry.MergedSize(new(960,600),standard,new(1664,986),minimum)==standard,"small receiving window grows to startup size after merge");
Check(DocumentDragGeometry.MergedSize(new(1600,1000),standard,new(1904,1064),minimum)==new DocumentSize(1600,1000),"larger receiver is never shrunk");
Check(DocumentDragGeometry.MergedSize(new(1600,700),standard,new(1904,1064),minimum)==new DocumentSize(1600,800),"only the deficient dimension grows");
Check(DocumentDragGeometry.MergedSize(new(900,600),standard,new(1104,634),minimum)==new DocumentSize(1104,634),"150 percent work area limits newly added size");
Check(DocumentDragGeometry.MergedSize(new(900,600),standard,new(700,450),minimum)==minimum,"tiny work area does not bypass existing minimum constraints");
Check(DocumentDragGeometry.MergedSize(new(960,600),new(1400,900),new(1904,1064),minimum)==new DocumentSize(1400,900),"merge consumes startup defaults supplied by the host, not the source window");
Check(DocumentThemeTokens.Mix("#303238","#F7F7F7",.12)=="#DFDFE0","neutral light header target is distinct without changing accent state");
var saveAsState = new DocumentSessionState("C:\\test\\menu-source.excalidraw");
var originalSaveAsIdentity = saveAsState.Id; var originalRecovery = saveAsState.RecoveryId;
saveAsState.Observe(saveAsState.Id, 1, true);
Check(saveAsState.BeginSave("save-as-cancel",1),"Save As begins against a captured document revision");
saveAsState.CompleteSave(new(saveAsState.Id,"save-as-cancel",1,"cancelled"),null);
Check(saveAsState.RecoveryId==originalRecovery && saveAsState.Dirty,"cancelled Save As preserves original path identity and dirty state");
Check(saveAsState.BeginSave("save-as-ok",1),"Save As retries the same content revision after cancellation");
saveAsState.CompleteSave(new(saveAsState.Id,"save-as-ok",1,"saved"),"C:\\test\\menu-copy.excalidraw");
Check(saveAsState.Id==originalSaveAsIdentity && saveAsState.RecoveryId!=originalRecovery && saveAsState.Name=="menu-copy.excalidraw" && !saveAsState.Dirty,
    "Save As changes file identity while keeping the living document identity");
var equalRevisionQueue = new DocumentSaveQueue();
await equalRevisionQueue.WriteAsync(2,()=>Task.FromResult<string?>("source"));
var saveAsAtSameRevision=await equalRevisionQueue.WriteAsync(2,()=>Task.FromResult<string?>("copy"));
Check(saveAsAtSameRevision.Written && saveAsAtSameRevision.Path=="copy","Save As may write the same saved content revision to a new destination");
var namedDraft = new DocumentSessionState();
namedDraft.Observe(namedDraft.Id, 5, true);
var draftRecovery = namedDraft.RecoveryId;
namedDraft.Renamed("新建方案.excalidraw", null);
Check(namedDraft.Name == "新建方案.excalidraw" && namedDraft.FilePath is null && namedDraft.Dirty && namedDraft.Revision == 5 && namedDraft.RecoveryId == draftRecovery,
    "draft naming preserves identity, unsaved edits and recovery key");
Check(DocumentRenamePolicy.FileName("  方案.EXCALIDRAW ") == "方案.excalidraw", "document name normalizes its fixed extension");
foreach (var invalid in new[] { "", " ", ".excalidraw", "../other", "C:\\other", "CON", "NUL.txt", "LPT1", "name.", "a?b" }) {
    var rejected = false; try { DocumentRenamePolicy.FileName(invalid); } catch (System.IO.IOException) { rejected = true; }
    Check(rejected, "invalid or path-like document name is rejected");
}
var renameRoot = System.IO.Path.GetFullPath(System.IO.Path.Combine(System.IO.Directory.GetCurrentDirectory(), "temp", "multi-document-implementation-20261002", "root57-menus", "rename-model-" + Guid.NewGuid().ToString("N")));
System.IO.Directory.CreateDirectory(renameRoot);
var renameSource = System.IO.Path.Combine(renameRoot, "before.excalidraw");
var collision = System.IO.Path.Combine(renameRoot, "occupied.excalidraw");
System.IO.File.WriteAllText(renameSource,"last saved bytes");System.IO.File.WriteAllText(collision,"another document");
bool CanRenameTest(string path) => System.IO.Path.GetFullPath(path).StartsWith(renameRoot + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
var renameFailed = false;
try { DocumentRenamePolicy.RenameFile(renameSource,"occupied",_=>true,CanRenameTest); } catch(System.IO.IOException) { renameFailed=true; }
Check(renameFailed && System.IO.File.ReadAllText(renameSource)=="last saved bytes" && System.IO.File.ReadAllText(collision)=="another document", "rename collision never overwrites either file");
var targetOccupied=false;try{DocumentRenamePolicy.RenameFile(renameSource,"open-target",_=>false,CanRenameTest);}catch(System.IO.IOException){targetOccupied=true;}
Check(targetOccupied && System.IO.File.Exists(renameSource),"another open document blocks the target path");
System.IO.File.SetAttributes(renameSource,System.IO.FileAttributes.ReadOnly);
var readOnlyBlocked=false;try{DocumentRenamePolicy.RenameFile(renameSource,"read-only",_=>true,CanRenameTest);}catch(System.IO.IOException){readOnlyBlocked=true;}
Check(readOnlyBlocked && System.IO.File.Exists(renameSource),"read-only rename leaves source intact");
System.IO.File.SetAttributes(renameSource,System.IO.FileAttributes.Normal);
var renamedPath=DocumentRenamePolicy.RenameFile(renameSource,"after",_=>true,CanRenameTest);
Check(!System.IO.File.Exists(renameSource) && System.IO.File.ReadAllText(renamedPath)=="last saved bytes","rename moves original bytes in the same directory");
var dirtyNamed=new DocumentSessionState(renameSource);dirtyNamed.Observe(dirtyNamed.Id,7,true);var originalNamedId=dirtyNamed.Id;
dirtyNamed.Renamed("after.excalidraw",renamedPath);
Check(dirtyNamed.Id==originalNamedId && dirtyNamed.Dirty && dirtyNamed.Revision==7 && dirtyNamed.FilePath==renamedPath,"file naming never marks live unsaved content as saved");
var casePath=DocumentRenamePolicy.RenameFile(renamedPath,"AFTER",_=>true,CanRenameTest);
Check(System.IO.File.Exists(casePath) && System.IO.File.ReadAllText(casePath)=="last saved bytes" && System.IO.Directory.GetFiles(renameRoot).Any(path=>System.IO.Path.GetFileName(path)=="AFTER.excalidraw"),"case-only file rename changes on-disk spelling and preserves content");
var exclusiveQueue=new DocumentSaveQueue();var releaseSave=new TaskCompletionSource();var order=new List<string>();
var queuedSave=exclusiveQueue.WriteAsync(1,async()=>{await releaseSave.Task;order.Add("save");return "path";});
var queuedRename=exclusiveQueue.ExclusiveAsync(()=>{order.Add("rename");return Task.CompletedTask;});
Check(!queuedRename.IsCompleted,"rename waits for the in-flight save");releaseSave.SetResult();await Task.WhenAll(queuedSave,queuedRename);
Check(order.SequenceEqual(new[]{"save","rename"}),"save and rename finish in serialized order");
Console.WriteLine($"DocumentSessionTests: {checks} checks passed.");
