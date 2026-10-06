$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $root
$project = Join-Path $root 'AiCanvas.WebViewHost'
$xaml = Get-Content -Raw (Join-Path $project 'MainWindow.xaml')
$code = Get-Content -Raw (Join-Path $project 'MainWindow.xaml.cs')
$policy = Get-Content -Raw (Join-Path $project 'HostNavigationPolicy.cs')
$projectFile = Get-Content -Raw (Join-Path $project 'AiCanvas.WebViewHost.csproj')
$startup = Get-Content -Raw (Join-Path $project 'DocumentOpenRequest.cs')
$app = Get-Content -Raw (Join-Path $repoRoot 'src\App.tsx')
$styles = Get-Content -Raw (Join-Path $repoRoot 'src\styles.css')

if ($xaml -notmatch 'Microsoft\.Web\.WebView2\.Wpf') { throw 'WPF WebView2 control is missing.' }
if ($code -notmatch 'EnsureCoreWebView2Async') { throw 'WebView2 initialization is missing.' }
if ($code -notmatch 'SetVirtualHostNameToFolderMapping') { throw 'Static asset mapping is missing.' }
if ($code -notmatch 'NavigationStarting') { throw 'Navigation gate is missing.' }
if ($code -notmatch 'NewWindowRequested') { throw 'New-window gate is missing.' }
if ($code -notmatch 'Browser\.Dispose') { throw 'WebView2 cleanup is missing.' }
if ($code -notmatch 'Key\.F11') { throw 'Fullscreen shortcut is missing.' }
if ($policy -notmatch 'appassets\.local') { throw 'Application host policy is missing.' }
if ($xaml -notmatch 'Title=""') { throw 'Native title text is not hidden.' }
if ($xaml -match 'Icon="Assets/AI-Canvas-Logo-Black-AC-V1\.ico"') { throw 'Window titlebar icon is still explicitly rendered.' }
if ($xaml -notmatch 'WindowStyle="None"') { throw 'Custom window chrome is missing.' }
if ($xaml -notmatch 'shell:WindowChrome\.WindowChrome') { throw 'WPF WindowChrome is missing.' }
if ($xaml -notmatch 'ResizeBorderThickness="6"') { throw 'All four native resize borders must remain available.' }
if ($xaml -notmatch 'x:Name="DocumentViews" Margin="4,0,4,4"') { throw 'Document host must leave the confirmed four-DIP visible gutter.' }
if ($xaml -notmatch 'MinWidth="900"' -or $xaml -notmatch 'MinHeight="600"') { throw 'Original minimum window size must remain unchanged.' }
if ($code -notmatch 'var dpi = GetDpiForWindow\(hwnd\)') { throw 'Native minimum tracking size must use the actual window DPI.' }
if ($code -notmatch 'Math.Max\(minMaxInfo.MinTrackSize.X, \(int\)Math.Ceiling\(MinWidth \* scaleX\)\)' -or
    $code -notmatch 'Math.Max\(minMaxInfo.MinTrackSize.Y, \(int\)Math.Ceiling\(MinHeight \* scaleY\)\)') { throw 'Native minimum tracking dimensions must preserve WPF and system minimums.' }
if ($code -notmatch 'WindowState == WindowState.Normal && !_isFullscreen') { throw 'Resize gutter must be removed while maximized or fullscreen.' }
if ($code -match 'Browser\.ZoomFactor\s*=') { throw 'Desktop UI must follow system scaling without an extra page zoom override.' }
if ($xaml -notmatch 'CaptionHeight="0"') { throw 'Overlay titlebar must not create a second client row.' }
if ($xaml -notmatch 'x:Name="TitleBar"') { throw 'Outer titlebar is missing.' }
if ($xaml -notmatch 'x:Name="TitleBarRow"') { throw 'Titlebar row is missing.' }
if ($xaml -notmatch 'Height="34"') { throw 'DPI-adjusted light application shell height is missing.' }
if ($xaml -notmatch 'CornerRadius="0"') { throw 'WPF chrome corner clipping must remain disabled.' }
if ($xaml -notmatch 'Background="#FFFFFF"') { throw 'Loading titlebar must start pure white.' }
if ($xaml -notmatch 'Height="800"') { throw 'Trial default window height is missing.' }
if ($xaml -notmatch 'Width="1280"') { throw 'Trial default window width is missing.' }
if ($xaml -match 'CanvasTab') { throw 'Fake canvas tab must remain removed.' }
if ($xaml -notmatch 'MouseLeftButtonDown="OnTitleBarMouseLeftButtonDown"') { throw 'Titlebar drag region is missing.' }
if ($xaml -notmatch 'Click="OnMinimizeClick"') { throw 'Minimize control is missing.' }
if ($xaml -notmatch 'Click="OnMaximizeClick"') { throw 'Maximize control is missing.' }
if ($xaml -notmatch 'Click="OnCloseClick"') { throw 'Close control is missing.' }
if ($xaml -notmatch 'CloseWindowControlButton') { throw 'Close hover treatment is missing.' }
if ($xaml -notmatch 'CaptionHoverBackground" Color="\#E6E0F4"' -or $xaml -notmatch 'DynamicResource CaptionHoverBackground') { throw 'Default hover brush and document-theme mapping are missing.' }
if ($xaml -notmatch 'CaptionHoverForeground" Color="\#392B68"' -or $xaml -notmatch 'DynamicResource CaptionHoverForeground') { throw 'Default hover text and document-theme mapping are missing.' }
if ($xaml -notmatch 'OverridesDefaultStyle" Value="True"') { throw 'Window control default system hover style is not overridden.' }
if ($xaml -notmatch 'x:Key="WindowControlTemplate"') { throw 'Window control custom template is missing.' }
if ($xaml -notmatch 'FocusVisualStyle" Value="\{x:Null\}"') { throw 'Window control focus outline must remain hidden.' }
if ($xaml -notmatch 'x:Name="LoadingOverlay"') { throw 'Loading overlay is missing.' }
if ($xaml -notmatch 'x:Name="LoadingOverlay"[\s\S]*Grid.Row="1"') { throw 'Loading overlay must remain below the titlebar.' }
if ($xaml -match 'x:Name="LoadingOverlay"[\s\S]*Grid.RowSpan="2"') { throw 'Loading overlay must not cover window controls.' }
if ($xaml -notmatch 'x:Name="LoadingLogo"') { throw 'Loading logo is missing.' }
if ($xaml -notmatch 'Background="#FFFFFF"') { throw 'Loading overlay must be pure white.' }
if ($xaml -notmatch '<Grid x:Name="ChromeRoot" Background="\{Binding Background, ElementName=TitleBar\}">') { throw 'Native resize gutter must follow the titlebar theme.' }
if ($code -notmatch 'AI-Canvas-Logo-Black-AC-V1\.ico') { throw 'Loading logo asset is missing.' }
if ($code -notmatch 'OrderByDescending\(image => image.PixelWidth\)') { throw 'Loading logo must use its highest resolution frame.' }
if ($xaml -notmatch 'RepeatBehavior="Forever"') { throw 'Loading breathing animation loop is missing.' }
if ($xaml -notmatch 'AutoReverse="True"') { throw 'Loading breathing animation reverse is missing.' }
if ($xaml -notmatch 'Foreground" Value="\#3F4148"') { throw 'Window control default contrast is missing.' }
if ($xaml -notmatch 'StrokeThickness="1.3"') { throw 'Window control icon stroke weight is missing.' }
if ($xaml -notmatch 'Width="10"') { throw 'Window control icon size is missing.' }
if ($xaml -notmatch 'RadiusX="1.5"') { throw 'Maximize icon rounded rectangle is missing.' }
if ($code -notmatch 'DragMove\(\)') { throw 'Window drag behavior is missing.' }
if ($code -notmatch 'SystemCommands\.MaximizeWindow') { throw 'Window maximize behavior is missing.' }
if ($code -notmatch 'TitleBarRow\.Height') { throw 'Fullscreen titlebar collapse is missing.' }
if ($code -notmatch 'DwmSetWindowAttribute') { throw 'DWM window corner handling is missing.' }
if ($code -notmatch 'DwmWindowCornerPreference') { throw 'DWM corner preference attribute is missing.' }
if ($code -notmatch 'WmGetMinMaxInfo') { throw 'Maximized work-area boundary handling is missing.' }
if ($code -notmatch 'WindowMessageHook') { throw 'Window message hook is missing.' }
if ($code -notmatch 'monitorInfo\.WorkArea') { throw 'Maximized work-area sizing is missing.' }
if ($code -notmatch 'LoadingOverlay\.Visibility = Visibility\.Collapsed') { throw 'Loading overlay completion handling is missing.' }
if ($code -notmatch 'WebMessageReceived') { throw 'Canvas theme message bridge is missing.' }
if ($app -notmatch 'createHostDocumentOpenGate') { throw 'Host document-open gate is missing.' }
if ($app -notmatch 'parseAiCanvasProjectFile\(document\.content\)') { throw 'Native document open must reuse project parsing.' }
if ($code -notmatch 'canvas-document-open-offer' -or $code -notmatch 'canvas-document-open-ready' -or $code -notmatch 'canvas-document-open') { throw 'Native document message handshake is missing.' }
if ($code -notmatch 'OfferDocumentOpen\(\)') { throw 'Native document offer must wait for canvas readiness.' }
if ($startup -notmatch 'Path\.IsPathFullyQualified' -or $startup -notmatch '\.excalidraw' -or $startup -notmatch 'TryTakeDelivery') { throw 'Native startup document path validation is missing.' }
if ($projectFile -notmatch 'AI-Canvas-Document-A\.ico' -or $projectFile -notmatch 'CopyToOutputDirectory') { throw 'Document icon must be copied independently of the application icon.' }
if ($code -notmatch 'canvas-theme') { throw 'Canvas theme message type is missing.' }
if ($code -notmatch '_themeHeaderColor') { throw 'Theme header color state is missing.' }
if ($code -notmatch 'Browser\.Visibility = Visibility\.Visible') { throw 'Browser must be revealed before loading overlay fades.' }
if ($code -notmatch 'Task\.Delay\(50, _loadingCancellation.Token\)') { throw 'Browser first-paint settle time is missing.' }
if ($code -notmatch 'LoadingBreath\.Storyboard\.Remove\(LoadingLogo\)') { throw 'Loading animation must stop before fade-out.' }
if ($code -notmatch 'fade.Completed \+= completed') { throw 'Loading reveal must wait for the real animation completion.' }
if ($code -notmatch 'LoadingFadeMilliseconds = 200') { throw 'Accepted loading fade duration must remain unchanged.' }
if ($code -notmatch 'SetLoadingChrome\(true\)') { throw 'Loading titlebar state is missing.' }
if ($code -notmatch 'MinimizeButton\.Visibility = isLoading') { throw 'Loading minimize visibility state is missing.' }
if ($code -notmatch 'MaximizeButton\.Visibility = isLoading') { throw 'Loading maximize visibility state is missing.' }
if ($code -notmatch 'TitleBar\.Background = isLoading') { throw 'Loading white titlebar state is missing.' }
if ($code -notmatch 'Task\.Delay\(remaining, _loadingCancellation.Token\)') { throw 'Loading cancellable minimum display duration is missing.' }
if ($code -notmatch 'LoadingTimeoutMilliseconds = 5000') { throw 'Five second loading timeout is missing.' }
if ($code -notmatch 'MinimumLoadingMilliseconds = 1350') { throw 'Accepted minimum loading duration must remain unchanged.' }
if ($code -notmatch 'EnforceLoadingTimeoutAsync') { throw 'Loading timeout handling is missing.' }
if ($projectFile -notmatch '<ApplicationIcon>Assets\\AI-Canvas-Logo-Black-AC-V1\.ico</ApplicationIcon>') { throw 'Application icon is missing.' }
if (-not (Test-Path (Join-Path $project 'Assets\AI-Canvas-Logo-Black-AC-V1.ico'))) { throw 'Icon asset is missing.' }
if ($app -match 'canvas-shell-state') { throw 'Page shell bridge must remain absent.' }
if ($app -notmatch 'canvas-theme') { throw 'Canvas theme message is missing.' }
if ($app -notmatch 'postMessage') { throw 'Canvas theme postMessage call is missing.' }
if ($styles -match 'app-header--single-shell') { throw 'Page header must remain independent.' }

Write-Output 'HostContract.Tests: all static checks passed.'

$documentSession = Get-Content (Join-Path $project 'DocumentSession.cs') -Raw
$documentTabs = Get-Content (Join-Path $project 'DocumentTabController.cs') -Raw
if ($documentSession -notmatch 'Settings\.IsZoomControlEnabled = false;' -or $documentSession -notmatch 'View\.ZoomFactor = 1;') { throw 'Every document must normalize browser page zoom without changing scene zoom or OS DPI.' }
if ($documentTabs -match '_window\.Hide\(') { throw 'Dragging a single tab must not hide the live source window.' }
Write-Output 'Document feedback guards: page zoom and source visibility passed.'
