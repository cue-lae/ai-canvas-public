[Code]
const
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{A824AB0C-29C1-4EF2-9117-EC098BF86169}_is1';
var
  InstallPage: TWizardPage;
  LocationEdit: TNewEdit;
  LocationButton, FinishOnlyButton: TNewButton;
  DesktopCheckbox: TNewCheckBox;
  LocationNote, StepLabel, VersionLabel: TNewStaticText;
  PreviousRoot, PreviousVersion: String;
  IsUpdate: Boolean;
  EngineStateFile, EngineError: String;
  EngineCompleted, EngineCancelled, ControllerCancel: Boolean;
  EnginePercent: Integer;

function GetFileAttributesW(FileName: String): LongWord;
  external 'GetFileAttributesW@kernel32.dll stdcall';
function SetEnvironmentVariableW(Name, Value: String): Boolean;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';
function GetDriveTypeW(RootPath: String): LongWord;
  external 'GetDriveTypeW@kernel32.dll stdcall';

#include "installer-file-association.iss"

procedure WriteEngineState(const Phase, ErrorText: String);
var SingleLine: String;
begin
  if EngineStateFile = '' then exit;
  SingleLine := ErrorText;
  StringChangeEx(SingleLine, #13#10, ' ', True);
  SetIniString('state', 'percent', IntToStr(EnginePercent), EngineStateFile);
  SetIniString('state', 'error', SingleLine, EngineStateFile);
  SetIniString('state', 'phase', Phase, EngineStateFile);
end;

procedure InitializeEngineChannel;
var Candidate, AllowedRoot, Parent: String; Attr: LongWord;
begin
  Candidate := ExpandConstant('{param:CANVASSTATE|}');
  if Candidate = '' then exit;
  Candidate := ExpandFileName(Candidate);
  AllowedRoot := AddBackslash(ExpandFileName(ExpandConstant('{%TEMP}'))) + 'AI-Canvas-Installer\';
  if (CompareText(Copy(Candidate, 1, Length(AllowedRoot)), AllowedRoot) <> 0) or
     (CompareText(ExtractFileName(Candidate), 'state.ini') <> 0) or not FileExists(Candidate) then exit;
  Parent := ExtractFileDir(Candidate);
  while Length(Parent) >= Length(RemoveBackslashUnlessRoot(AllowedRoot)) do begin
    Attr := GetFileAttributesW(Parent);
    if (Attr = $FFFFFFFF) or ((Attr and $400) <> 0) then exit;
    if ExtractFileDir(Parent) = Parent then exit;
    Parent := ExtractFileDir(Parent);
  end;
  EngineStateFile := Candidate;
  WriteEngineState('preparing', '');
end;

function HasWebView2: Boolean;
var V: String;
begin
  Result := False;
  if RegQueryStringValue(HKLM32, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V) then
    Result := (V <> '') and (V <> '0.0.0.0');
  if not Result then
    if RegQueryStringValue(HKCU32, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V) then
      Result := (V <> '') and (V <> '0.0.0.0');
end;

function InitializeSetup: Boolean;
var I: Integer;
begin
  Result := False;
#ifdef CanvasAssociationCompileOnly
  Log('Compile-only association model: installation is disabled.');
  exit;
#endif
  InitializeEngineChannel;
  if IsAdminInstallMode then begin
    MsgBox('本应用只支持当前用户安装，请不要使用 ALLUSERS。', mbError, MB_OK); exit;
  end;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/ALLUSERS') = 0 then exit;
  if not HasWebView2 then begin
    MsgBox('缺少 Microsoft Edge WebView2 Runtime。请先从 https://developer.microsoft.com/microsoft-edge/webview2/ 安装 Evergreen Runtime 后重试。', mbError, MB_OK); exit;
  end;
  IsUpdate := RegKeyExists(HKCU, UninstallKey);
  if IsUpdate then begin
    if not RegQueryStringValue(HKCU, UninstallKey, 'InstallLocation', PreviousRoot) then
      RegQueryStringValue(HKCU, UninstallKey, 'Inno Setup: App Path', PreviousRoot);
    PreviousRoot := RemoveBackslashUnlessRoot(PreviousRoot);
    if (PreviousRoot = '') or not DirExists(PreviousRoot) then begin
      MsgBox('找到了旧版记录，但原安装目录不可用。请先恢复原安装目录，再运行更新。', mbError, MB_OK); exit;
    end;
    RegQueryStringValue(HKCU, UninstallKey, 'DisplayVersion', PreviousVersion);
  end;
  Result := True;
end;

function CreateDesktopShortcut: Boolean;
begin
  if IsUpdate then Result := FileExists(ExpandConstant('{autodesktop}\AI Canvas Test.lnk')) or FileExists(ExpandConstant('{autodesktop}\AI Canvas.lnk'))
  else if EngineStateFile <> '' then Result := ExpandConstant('{param:CANVASDESKTOP|1}') = '1'
  else Result := DesktopCheckbox.Checked;
end;

procedure ChangeLocation(Sender: TObject);
var Selected: String;
begin
  Selected := LocationEdit.Text;
  if BrowseForFolder('选择应用的安装文件夹', Selected, True) then begin
    LocationEdit.Text := Selected;
    WizardForm.DirEdit.Text := Selected;
  end;
end;

procedure FinishWithoutLaunch(Sender: TObject);
begin
  if WizardForm.RunList.Items.Count > 0 then WizardForm.RunList.Checked[0] := False;
  WizardForm.NextButton.OnClick(WizardForm.NextButton);
end;

procedure InitializeWizard;
var LabelControl: TNewStaticText;
begin
  WizardForm.Caption := 'AI Canvas 安装程序';
  WizardForm.Font.Name := 'Microsoft YaHei UI';
  WizardForm.Color := clWhite;
  WizardForm.MainPanel.Color := clWhite;
  WizardForm.PageNameLabel.Font.Size := 17;
  WizardForm.PageNameLabel.Font.Style := [fsBold];
  WizardForm.PageNameLabel.AutoSize := False;
  WizardForm.PageNameLabel.Height := ScaleY(32);
  WizardForm.PageDescriptionLabel.Top := WizardForm.PageNameLabel.Top + WizardForm.PageNameLabel.Height + ScaleY(6);
  WizardForm.PageDescriptionLabel.Height := ScaleY(24);
  WizardForm.MainPanel.Height := WizardForm.MainPanel.Height + ScaleY(28);
  WizardForm.InnerNotebook.Top := WizardForm.InnerNotebook.Top + ScaleY(28);
  WizardForm.InnerNotebook.Height := WizardForm.InnerNotebook.Height - ScaleY(28);
  WizardForm.PageDescriptionLabel.Font.Size := 9;
  WizardForm.PageDescriptionLabel.Font.Color := $007D746F;
  WizardForm.WizardSmallBitmapImage.Visible := False;
  WizardForm.WizardBitmapImage.Visible := False;
  WizardForm.WizardBitmapImage2.Visible := False;
  WizardForm.BeveledLabel.Caption := '初版';
  if IsUpdate then begin
    WizardForm.DirEdit.Text := PreviousRoot;
    InstallPage := CreateCustomPage(wpWelcome, '准备更新', '沿用原安装位置，保留已有画布项目与设置。');
  end else
    InstallPage := CreateCustomPage(wpWelcome, '准备安装', '让图片、标注与说明在同一张画布上工作。');
  VersionLabel := TNewStaticText.Create(InstallPage);
  VersionLabel.Parent := InstallPage.Surface;
  VersionLabel.SetBounds(0, ScaleY(8), InstallPage.SurfaceWidth, ScaleY(20));
  VersionLabel.Font.Color := $007D746F;
  if IsUpdate then VersionLabel.Caption := '已安装 ' + PreviousVersion + '  →  {#PackageVersion}'
  else VersionLabel.Caption := '当前版本  {#PackageVersion}';
  LabelControl := TNewStaticText.Create(InstallPage);
  LabelControl.Parent := InstallPage.Surface;
  LabelControl.SetBounds(0, ScaleY(46), ScaleX(180), ScaleY(20));
  LabelControl.Caption := '安装位置';
  LabelControl.Font.Color := $007D746F;
  LocationButton := TNewButton.Create(InstallPage);
  LocationButton.Parent := InstallPage.Surface;
  LocationButton.SetBounds(InstallPage.SurfaceWidth - ScaleX(92), ScaleY(39), ScaleX(92), ScaleY(28));
  LocationButton.Caption := '更改位置';
  LocationButton.OnClick := @ChangeLocation;
  LocationButton.Visible := not IsUpdate;
  LocationEdit := TNewEdit.Create(InstallPage);
  LocationEdit.Parent := InstallPage.Surface;
  LocationEdit.SetBounds(0, ScaleY(75), InstallPage.SurfaceWidth, ScaleY(30));
  LocationEdit.Font.Size := 9;
  LocationEdit.ReadOnly := IsUpdate;
  LocationEdit.Text := WizardDirValue;
  LocationNote := TNewStaticText.Create(InstallPage);
  LocationNote.Parent := InstallPage.Surface;
  LocationNote.SetBounds(0, ScaleY(115), InstallPage.SurfaceWidth, ScaleY(36));
  LocationNote.WordWrap := True;
  LocationNote.Font.Color := $007D746F;
  if IsUpdate then LocationNote.Caption := '更新使用原目录；画布项目与用户设置保留。'
  else LocationNote.Caption := '仅为当前用户安装。画布数据保存在独立用户目录。';
  DesktopCheckbox := TNewCheckBox.Create(InstallPage);
  DesktopCheckbox.Parent := InstallPage.Surface;
  DesktopCheckbox.SetBounds(0, ScaleY(166), InstallPage.SurfaceWidth, ScaleY(22));
  DesktopCheckbox.Caption := '创建桌面快捷方式';
  DesktopCheckbox.Checked := True;
  DesktopCheckbox.Visible := not IsUpdate;
  StepLabel := TNewStaticText.Create(WizardForm);
  StepLabel.Parent := WizardForm.MainPanel;
  StepLabel.SetBounds(WizardForm.MainPanel.Width - ScaleX(68), ScaleY(20), ScaleX(50), ScaleY(18));
  StepLabel.Font.Color := $007D746F;
  StepLabel.Caption := '1 / 3';
  FinishOnlyButton := TNewButton.Create(WizardForm);
  FinishOnlyButton.Parent := WizardForm;
  FinishOnlyButton.SetBounds(WizardForm.NextButton.Left - ScaleX(96), WizardForm.NextButton.Top, ScaleX(84), WizardForm.NextButton.Height);
  FinishOnlyButton.Caption := '完成';
  FinishOnlyButton.OnClick := @FinishWithoutLaunch;
  FinishOnlyButton.Visible := False;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = InstallPage.ID then begin
    if IsUpdate then WizardForm.DirEdit.Text := PreviousRoot
    else WizardForm.DirEdit.Text := Trim(LocationEdit.Text);
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  FinishOnlyButton.Visible := CurPageID = wpFinished;
  if CurPageID = InstallPage.ID then begin
    StepLabel.Caption := '1 / 3';
    if IsUpdate then WizardForm.NextButton.Caption := '开始更新'
    else WizardForm.NextButton.Caption := '开始安装';
    WizardForm.ActiveControl := WizardForm.NextButton;
  end;
  if CurPageID = wpInstalling then begin
    StepLabel.Caption := '2 / 3';
    if IsUpdate then begin
      WizardForm.PageNameLabel.Caption := '正在更新';
      WizardForm.PageDescriptionLabel.Caption := '保留已有画布项目与设置。';
    end else begin
      WizardForm.PageNameLabel.Caption := '正在安装';
      WizardForm.PageDescriptionLabel.Caption := '安装完成后即可打开画布。';
    end;
  end;
  if CurPageID = wpFinished then begin
    StepLabel.Caption := '3 / 3';
    WizardForm.RunList.Visible := False;
    WizardForm.FinishedHeadingLabel.Left := ScaleX(12);
    WizardForm.FinishedHeadingLabel.Width := WizardForm.FinishedPage.Width - ScaleX(24);
    WizardForm.FinishedHeadingLabel.Font.Size := 18;
    WizardForm.FinishedLabel.Left := ScaleX(12);
    WizardForm.FinishedLabel.Width := WizardForm.FinishedPage.Width - ScaleX(24);
    WizardForm.FinishedLabel.Caption := '现在可以开始使用画布了。' + #13#10 + #13#10 + '连接操作说明以安装包旁边的独立文档交付。';
    if IsUpdate then WizardForm.FinishedHeadingLabel.Caption := '更新完成'
    else WizardForm.FinishedHeadingLabel.Caption := '安装完成';
    WizardForm.NextButton.Caption := '打开画布';
  end;
end;


function RunPluginAction(const NodeExe, Script, Action, AppRoot: String): Boolean;
var ExitCode: Integer; Args, ReportFile, OldOptions, OldPath: String; ReportText: AnsiString;
begin
  ReportFile := ExpandConstant('{tmp}\canvas-plugin-check.txt');
  Args := '"' + Script + '" ' + Action + ' "' + AppRoot + '" "' + ReportFile + '"';
  OldOptions := GetEnv('NODE_OPTIONS'); OldPath := GetEnv('NODE_PATH');
  Result := False;
  EngineError := '无法隔离插件来源检查环境，请保留现场并重试。';
  if not SetEnvironmentVariableW('NODE_OPTIONS', '') or not SetEnvironmentVariableW('NODE_PATH', '') then exit;
  try
    Result := Exec(NodeExe, Args, ExtractFileDir(NodeExe), SW_HIDE, ewWaitUntilTerminated, ExitCode);
    if Result then Result := ExitCode = 0;
    if not Result then begin
      EngineError := 'Codex 插件来源无法安全更新，请保留现有文件并查看安装说明。';
      if LoadStringFromFile(ReportFile, ReportText) and (Length(ReportText) > 0) then EngineError := UTF8Decode(ReportText);
    end;
  finally
    SetEnvironmentVariableW('NODE_OPTIONS', OldOptions); SetEnvironmentVariableW('NODE_PATH', OldPath);
  end;
end;

function DesiredShortcutOwned(const FileName, ExpectedTarget, ExpectedArgument: String): Boolean;
var Shell, Link: Variant;
begin
  Result := True;
  if not FileExists(FileName) then exit;
  Result := False;
  try
    Shell := CreateOleObject('WScript.Shell'); Link := Shell.CreateShortcut(FileName);
    Result := (CompareText(ExpandFileName(Link.TargetPath), ExpandFileName(ExpectedTarget)) = 0) and
              (CompareText(Trim(Link.Arguments), ExpectedArgument) = 0);
  except end;
end;

function CheckInstallTarget(var NeedsRestart: Boolean): String;
var Target, Parent, Arguments, ReportFile, OldNodeOptions, OldNodePath: String;
    Attr, DriveKind: LongWord; ExitCode: Integer; Started: Boolean; ReportText: AnsiString;
begin
  Result := '';
  Target := RemoveBackslashUnlessRoot(WizardDirValue);
  if not DesiredShortcutOwned(ExpandConstant('{autodesktop}\AI Canvas.lnk'), Target + '\AiCanvas.WebViewHost.exe', '') or
     not DesiredShortcutOwned(ExpandConstant('{userprograms}\AI Canvas\AI Canvas.lnk'), Target + '\AiCanvas.WebViewHost.exe', '') then begin
    Result := '存在属于其他应用的同名 AI Canvas 快捷方式，未覆盖。请保留现场并联系支持。'; exit;
  end;
  if (Pos('"', Target) > 0) or (Pos('"', PreviousRoot) > 0) then begin
    Result := '安装目录名称无效。'; exit;
  end;
  DriveKind := GetDriveTypeW(AddBackslash(ExtractFileDrive(Target)));
  if (DriveKind <> 2) and (DriveKind <> 3) then begin
    Result := '请选择当前可用的本地磁盘目录，不使用网络映射目录。'; exit;
  end;
  if IsUpdate and (CompareText(Target, PreviousRoot) <> 0) then begin
    Result := '更新必须使用原安装位置。'; exit;
  end;
  if CheckForMutexes('Local\AI.Canvas.DesktopTest.Window') then begin
    Result := '请先保存并关闭全部画布窗口，在 Codex 停用 AI Canvas 插件或旧读取连接后重试。'; exit;
  end;
  Parent := Target;
  while Length(Parent) > 3 do begin
    if DirExists(Parent) then begin
      Attr := GetFileAttributesW(Parent);
      if (Attr = $FFFFFFFF) or ((Attr and $400) <> 0) then begin
        Result := '安装位置包含目录链接或无法确认，请选择普通本地目录。'; exit;
      end;
    end;
    if ExtractFileDir(Parent) = Parent then Break;
    Parent := ExtractFileDir(Parent);
  end;
  ExtractTemporaryFile('installer-node.exe');
  ExtractTemporaryFile('installer-policy.mjs');
  ExtractTemporaryFile('plugin-install.mjs');
  ExtractTemporaryFile('plugin-legacy-hashes.json');
  ReportFile := ExpandConstant('{tmp}\installer-check.txt');
  Arguments := '"' + ExpandConstant('{tmp}\installer-policy.mjs') + '" "' + Target + '" "' + PreviousRoot + '" "{#PackageVersion}" "' + ExpandConstant('{localappdata}\AI Canvas Test') + '" "' + ReportFile + '"';
  OldNodeOptions := GetEnv('NODE_OPTIONS'); OldNodePath := GetEnv('NODE_PATH');
  if not SetEnvironmentVariableW('NODE_OPTIONS', '') or not SetEnvironmentVariableW('NODE_PATH', '') then begin
    Result := '无法隔离安装前检查环境，请退出后重试。'; exit;
  end;
  try
    Started := Exec(ExpandConstant('{tmp}\installer-node.exe'), Arguments, ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ExitCode);
  finally
    SetEnvironmentVariableW('NODE_OPTIONS', OldNodeOptions); SetEnvironmentVariableW('NODE_PATH', OldNodePath);
  end;
  if not Started then begin Result := '安装前检查未能启动，请重试。'; exit; end;
  if ExitCode <> 0 then begin
    if LoadStringFromFile(ReportFile, ReportText) then Result := UTF8Decode(ReportText)
    else Result := '安装位置或连接状态无法确认，请重试。';
    if Result = '' then Result := '安装前检查未通过，请重试。';
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := CheckInstallTarget(NeedsRestart);
  EngineError := Result;
  if Result <> '' then WriteEngineState('error', Result)
  else WriteEngineState('preparing', '');
end;

procedure CancelButtonClick(CurPageID: Integer; var Cancel, Confirm: Boolean);
begin
  if ControllerCancel then begin
    Cancel := True;
    Confirm := False;
    EngineCancelled := True;
    WriteEngineState('cancelled', '');
  end;
end;

procedure CurInstallProgressChanged(CurProgress, MaxProgress: Integer);
var NewPercent: Integer;
begin
  if EngineStateFile = '' then exit;
  if MaxProgress > 0 then NewPercent := Round((CurProgress * 100.0) / MaxProgress) else NewPercent := 0;
  if NewPercent <> EnginePercent then begin
    EnginePercent := NewPercent;
    WriteEngineState('installing', '');
  end;
  if not ControllerCancel and
     (GetIniString('control', 'cancel', '0', AddBackslash(ExtractFileDir(EngineStateFile)) + 'command.ini') = '1') then begin
    ControllerCancel := True;
    WizardForm.CancelButton.OnClick(WizardForm.CancelButton);
  end;
end;

procedure RemoveOwnedLegacyShortcut(const LinkName, ExpectedArgument: String);
var FileName, ExpectedTarget: String; Shell, Link: Variant;
begin
  FileName := ExpandConstant('{userprograms}\AI Canvas Test\') + LinkName + '.lnk';
  if not FileExists(FileName) then exit;
  ExpectedTarget := ExpandFileName(ExpandConstant('{app}\AiCanvas.WebViewHost.exe'));
  try
    Shell := CreateOleObject('WScript.Shell');
    Link := Shell.CreateShortcut(FileName);
    if (CompareText(ExpandFileName(Link.TargetPath), ExpectedTarget) = 0) and
       (CompareText(Trim(Link.Arguments), ExpectedArgument) = 0) then
      if not DeleteFile(FileName) then Log('Could not remove owned legacy shortcut: ' + LinkName);
  except
    Log('Legacy shortcut ownership not confirmed; left unchanged: ' + LinkName);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then WriteEngineState('installing', '');
  if CurStep = ssPostInstall then begin
#ifdef TimingDiagnostics
    Log('TIMING plugin-register begin');
#endif
    if not RunPluginAction(ExpandConstant('{app}\runtime\node.exe'), ExpandConstant('{app}\scripts\plugin-install.mjs'), 'register', ExpandConstant('{app}')) then
      RaiseException(EngineError);
#ifdef TimingDiagnostics
    Log('TIMING plugin-register end');
#endif
    RemoveOwnedLegacyShortcut('AI Canvas Test', '');
    if DesiredShortcutOwned(ExpandConstant('{autodesktop}\AI Canvas Test.lnk'), ExpandConstant('{app}\AiCanvas.WebViewHost.exe'), '') then
      DeleteFile(ExpandConstant('{autodesktop}\AI Canvas Test.lnk'));
    if DesiredShortcutOwned(ExpandConstant('{userprograms}\AI Canvas Test\卸载 AI Canvas Test.lnk'), ExpandConstant('{uninstallexe}'), '') then
      DeleteFile(ExpandConstant('{userprograms}\AI Canvas Test\卸载 AI Canvas Test.lnk'));

    RemoveOwnedLegacyShortcut('Codex 连接说明', '--connection-guide');
    RemoveOwnedLegacyShortcut('停止测试版连接服务', '--stop-bridge');
    ApplyCanvasFileAssociation('Register');
  end;
  if CurStep = ssDone then begin
    EngineCompleted := True;
    EnginePercent := 100;
    WriteEngineState('completed', '');
  end;
end;

procedure DeinitializeSetup;
begin
  if EngineCompleted then exit;
  if EngineCancelled then WriteEngineState('cancelled', '')
  else begin
    if EngineError = '' then begin
      if CheckForMutexes('Local\AI.Canvas.DesktopTest.Window') then
        EngineError := '请先保存并关闭全部画布窗口，并在 Codex 停用 AI Canvas 插件或旧读取连接后重试。'
      else EngineError := '安装未完成，请检查安装位置和程序占用情况后重试。';
    end;
    WriteEngineState('error', EngineError);
  end;
end;

function InitializeUninstall: Boolean;
var ExitCode: Integer;
begin
  Result := False;
#ifdef CanvasAssociationCompileOnly
  Log('Compile-only association model: uninstallation is disabled.');
  exit;
#endif
  if CheckForMutexes('Local\AI.Canvas.DesktopTest.Window') then begin
    MsgBox('请先关闭全部 AI Canvas 窗口，并在 Codex 停用 AI Canvas 插件或旧读取连接或退出 Codex。', mbError, MB_OK); exit;
  end;
  if not Exec(ExpandConstant('{app}\AiCanvas.WebViewHost.exe'), '--package-status', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ExitCode) then begin
    MsgBox('无法确认画布连接状态，未执行卸载。', mbError, MB_OK); exit;
  end;
  if ExitCode <> 0 then begin
    MsgBox('连接仍在运行或状态不明。请先保存并关闭全部画布，等待连接自动结束后重试；若 Codex 读取组件仍在运行，请停用该连接。', mbError, MB_OK); exit;
  end;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then begin
    if not RunPluginAction(ExpandConstant('{app}\runtime\node.exe'), ExpandConstant('{app}\scripts\plugin-install.mjs'), 'unregister', ExpandConstant('{app}')) then
      RaiseException(EngineError);
    ApplyCanvasFileAssociation('Unregister');
  end;
end;
