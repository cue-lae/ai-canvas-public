#ifndef Payload
  #error Payload must be provided
#endif
#ifndef Output
  #error Output must be provided
#endif

[Setup]
AppId={{A824AB0C-29C1-4EF2-9117-EC098BF86169}
AppName=AI Canvas
AppVersion={#ProductVersion}
AppVerName=AI Canvas {#PackageVersion} 初版
DefaultDirName={localappdata}\Programs\AI Canvas
DefaultGroupName=AI Canvas
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
UsePreviousPrivileges=no
UsePreviousAppDir=yes
UsePreviousGroup=no
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableWelcomePage=yes
DisableReadyPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#Output}
OutputBaseFilename=AI-Canvas-{#ProductVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=120,120
SetupIconFile=..\webview-host\AiCanvas.WebViewHost\Assets\AI-Canvas-Logo-Black-AC-V1.ico
UninstallDisplayIcon={app}\AiCanvas.WebViewHost.exe
UninstallDisplayName=AI Canvas
AppMutex=Local\AI.Canvas.DesktopTest.Window
CloseApplications=no
RestartApplications=no
ShowLanguageDialog=no
ChangesAssociations=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Messages]
SetupWindowTitle=AI Canvas 安装程序
ButtonInstall=开始安装
ButtonFinish=打开画布
SetupAppRunningError=请先保存并关闭所有 AI Canvas 窗口，并在 Codex 停用 AI Canvas 插件或旧读取连接或退出 Codex，再继续安装或更新。
InstallingLabel=正在安装应用文件，请稍候。
FinishedHeadingLabel=安装完成
FinishedLabelNoIcons=现在可以开始使用画布了。
FinishedLabel=现在可以开始使用画布了。

[Files]
Source: "{#Payload}\runtime\node.exe"; DestName: "installer-node.exe"; Flags: dontcopy
Source: "installer-policy.mjs"; Flags: dontcopy
Source: "plugin-install.mjs"; Flags: dontcopy
Source: "plugin-legacy-hashes.json"; Flags: dontcopy
Source: "{#Payload}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\AI Canvas"; Filename: "{app}\AiCanvas.WebViewHost.exe"; WorkingDir: "{app}"; Check: CreateDesktopShortcut
Name: "{group}\AI Canvas"; Filename: "{app}\AiCanvas.WebViewHost.exe"; WorkingDir: "{app}"
Name: "{group}\卸载 AI Canvas"; Filename: "{uninstallexe}"
Name: "{group}\AI Canvas 安装说明"; Filename: "{app}\AI Canvas 安装说明.txt"

[Run]
Filename: "{app}\AiCanvas.WebViewHost.exe"; Description: "打开画布"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

#include "installer-ui.iss"
