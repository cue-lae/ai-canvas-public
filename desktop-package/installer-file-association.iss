// Ordinary helpers only: lifecycle events remain in installer-ui.iss.
procedure ApplyCanvasFileAssociation(const Action: String);
var Args, ScriptPath, ReportFile: String; ExitCode: Integer; ReportText: AnsiString;
begin
  ScriptPath := ExpandConstant('{app}\scripts\installer-file-association.ps1');
  ReportFile := ExpandConstant('{tmp}\canvas-file-association.txt');
  Args := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ScriptPath +
    '" -Action ' + Action + ' -AppRoot "' + ExpandConstant('{app}') + '"';
  if (Action = 'Register') and (PreviousRoot <> '') then
    Args := Args + ' -PreviousRoot "' + PreviousRoot + '"';
  Args := Args + ' -ReportPath "' + ReportFile + '"';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Args,
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ExitCode) then begin
    Log('Canvas file association skipped: helper could not start.');
    exit;
  end;
  if LoadStringFromFile(ReportFile, ReportText) then Log('Canvas file association: ' + UTF8Decode(ReportText));
  if ExitCode <> 0 then Log('Canvas file association skipped or incomplete; unrelated defaults preserved.');
end;
