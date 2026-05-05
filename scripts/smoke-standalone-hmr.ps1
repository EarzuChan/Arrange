param(
  [Parameter(Mandatory = $true)]
  [string] $Executable,

  [string] $UiSourceDir = "demo\ui-src",

  [string] $OutputDir = "artifacts\m1\standalone-hmr",

  [string] $DevServerUrl = "http://127.0.0.1:9178",

  [string] $PnpmCommand = "pnpm.cmd",

  [switch] $UseExistingDevServer,

  [int] $StartupTimeoutSeconds = 40,

  [int] $ReloadWaitMs = 1800
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class ArrangeHmrSmokeWin32 {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowTextLength(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  public static IntPtr FindVisibleWindowForProcess(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint windowPid;
      GetWindowThreadProcessId(hWnd, out windowPid);
      if (windowPid == pid && IsWindowVisible(hWnd)) {
        found = hWnd;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static string GetTitle(IntPtr hWnd) {
    int length = GetWindowTextLength(hWnd);
    StringBuilder builder = new StringBuilder(length + 1);
    GetWindowText(hWnd, builder, builder.Capacity);
    return builder.ToString();
  }
}
"@

Add-Type -AssemblyName System.Drawing

function Resolve-RepoPath([string] $Path) {
  if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
  return Join-Path (Get-Location) $Path
}

function Write-DemoSfc([string] $Path, [string] $Title, [string] $Subtitle, [string] $ColorHex) {
  $source = @"
<template>
  <Column
    :modifier="m.size(dp(420), dp(300)).padding(dp(16)).background(Color(0xFF1F232A)).testTag('hmr-window-root')"
    :vertical-arrangement="Arrangement.spacedBy(dp(10))"
  >
    <Text
      text="$Title"
      :text-style="{ fontSize: sp(22), color: Color(0xFFE8EAED) }"
      :modifier="m.height(dp(34)).background(Color($ColorHex)).testTag('hmr-title')"
    />
    <Text
      text="$Subtitle"
      :text-style="{ fontSize: sp(13), color: Color(0xFFB8BDC7) }"
      :modifier="m.height(dp(26)).testTag('hmr-subtitle')"
    />
    <Input
      v-model="preset"
      placeholder="Dev preset"
      :text-style="{ fontSize: sp(13), color: Color(0xFFE8EAED) }"
      :modifier="m.size(dp(240), dp(28)).background(Color(0xFF151922)).border(dp(1), Color(0xFF4B5563)).testTag('hmr-input')"
    />
    <Text
      :text="preset"
      :text-style="{ fontSize: sp(13), color: Color(0xFFE8EAED) }"
      :modifier="m.height(dp(24)).testTag('hmr-preset')"
    />
  </Column>
</template>

<script setup>
import { Arrangement, Color, dp, m, sp } from "@arrange/runtime";
import { ref } from "vue";

const preset = ref("来自同一个 Standalone 进程的 dev server bundle");
</script>
"@
  Set-Content -LiteralPath $Path -Value $source -Encoding UTF8
}

function Write-BrokenSfc([string] $Path) {
  $source = @"
<template>
  <Column :modifier="m.size(dp(420), dp(300)).padding(dp(16))">
    <Text text="这个文件故意写坏，用来验证错误屏"
</template>

<script setup>
import { dp, m } from "@arrange/runtime";
</script>
"@
  Set-Content -LiteralPath $Path -Value $source -Encoding UTF8
}

function Wait-DevBundle([string] $Url, [bool] $ExpectOk, [int] $TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastStatus = "none"
  do {
    try {
      $response = Invoke-WebRequest -Uri "$Url/@arrange/app.mjs" -UseBasicParsing -TimeoutSec 5
      $lastStatus = [string]$response.StatusCode
      if ($ExpectOk -and $response.StatusCode -eq 200) { return }
      if (-not $ExpectOk -and $response.StatusCode -ge 500) { return }
    } catch {
      $status = $null
      if ($_.Exception.Response -ne $null) {
        try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = $null }
      }
      $lastStatus = if ($status -ne $null) { [string]$status } else { $_.Exception.Message }
      if (-not $ExpectOk -and $status -ge 500) { return }
    }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)

  $wanted = if ($ExpectOk) { "HTTP 200" } else { "HTTP 5xx" }
  throw "Timed out waiting for dev bundle $wanted. Last status: $lastStatus"
}

function Wait-StandaloneWindow([System.Diagnostics.Process] $Process, [int] $TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 250
    $Process.Refresh()
    if ($Process.HasExited) {
      throw "Standalone exited before a window appeared. ExitCode=$($Process.ExitCode)"
    }
    $window = [ArrangeHmrSmokeWin32]::FindVisibleWindowForProcess([uint32]$Process.Id)
    if ($window -ne [IntPtr]::Zero) { return $window }
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for Standalone main window. ProcessId=$($Process.Id)"
}

function Save-WindowPng([IntPtr] $Window, [string] $OutputPng) {
  $outputParent = Split-Path -Parent $OutputPng
  if ($outputParent) { New-Item -ItemType Directory -Force -Path $outputParent | Out-Null }

  [void][ArrangeHmrSmokeWin32]::ShowWindow($Window, 9)
  [void][ArrangeHmrSmokeWin32]::BringWindowToTop($Window)
  [void][ArrangeHmrSmokeWin32]::SetForegroundWindow($Window)
  Start-Sleep -Milliseconds 350

  $rect = New-Object ArrangeHmrSmokeWin32+RECT
  if (-not [ArrangeHmrSmokeWin32]::GetWindowRect($Window, [ref] $rect)) {
    throw "GetWindowRect failed."
  }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 0 -or $height -le 0) {
    throw "Invalid window rectangle: $($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)"
  }

  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $hdc = $graphics.GetHdc()
    try {
      $printed = [ArrangeHmrSmokeWin32]::PrintWindow($Window, $hdc, 2)
    } finally {
      $graphics.ReleaseHdc($hdc)
    }
    if (-not $printed) {
      $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    }
    $bitmap.Save($OutputPng, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
  Write-Host "[hmr-smoke] saved $OutputPng"
}

$executablePath = Resolve-RepoPath $Executable
$uiDir = Resolve-RepoPath $UiSourceDir
$outputPath = Resolve-RepoPath $OutputDir
$appVue = Join-Path $uiDir "src\App.vue"
$manifest = Join-Path $outputPath "manifest.txt"
$devServerProcess = $null
$standaloneProcess = $null
$oldArrangeDevServer = $env:ARRANGE_DEV_SERVER

if (-not (Test-Path -LiteralPath $executablePath)) {
  throw "Standalone executable not found: $executablePath"
}
if (-not (Test-Path -LiteralPath $appVue)) {
  throw "Demo App.vue not found: $appVue"
}
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

$originalAppVue = Get-Content -LiteralPath $appVue -Raw
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("Arrange Standalone HMR/error smoke")
$lines.Add("StartedAt=$((Get-Date).ToString('o'))")
$lines.Add("Executable=$executablePath")
$lines.Add("UiSourceDir=$uiDir")
$lines.Add("DevServerUrl=$DevServerUrl")

try {
  Write-DemoSfc $appVue "HMR window A" "初始 dev bundle，由真实 ArrangeEditor/QuickJS/JUCE 绘制" "0xFF2E7D32"

  if (-not $UseExistingDevServer) {
    $stdout = Join-Path $outputPath "vite.stdout.log"
    $stderr = Join-Path $outputPath "vite.stderr.log"
    Write-Host "[hmr-smoke] starting dev server: $PnpmCommand dev"
    $devServerProcess = Start-Process -FilePath $PnpmCommand -ArgumentList @("dev") -WorkingDirectory $uiDir -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $lines.Add("DevServerProcessId=$($devServerProcess.Id)")
  } else {
    $lines.Add("DevServerProcessId=existing")
  }

  Wait-DevBundle $DevServerUrl $true $StartupTimeoutSeconds

  $env:ARRANGE_DEV_SERVER = $DevServerUrl
  Write-Host "[hmr-smoke] launching standalone: $executablePath"
  $standaloneProcess = Start-Process -FilePath $executablePath -WorkingDirectory (Split-Path -Parent $executablePath) -PassThru
  $lines.Add("StandaloneProcessId=$($standaloneProcess.Id)")
  $window = Wait-StandaloneWindow $standaloneProcess $StartupTimeoutSeconds
  $lines.Add("WindowHandle=$window")
  $lines.Add("WindowTitle=$([ArrangeHmrSmokeWin32]::GetTitle($window))")

  Start-Sleep -Milliseconds $ReloadWaitMs
  Save-WindowPng $window (Join-Path $outputPath "01-hmr-a.png")
  $lines.Add("01=01-hmr-a.png")

  Write-DemoSfc $appVue "HMR window B" "保存 SFC 后，同一个窗口经 Vite WS reload 到 B" "0xFF3A7AFE"
  Wait-DevBundle $DevServerUrl $true $StartupTimeoutSeconds
  Start-Sleep -Milliseconds $ReloadWaitMs
  Save-WindowPng $window (Join-Path $outputPath "02-hmr-b.png")
  $lines.Add("02=02-hmr-b.png")

  Write-BrokenSfc $appVue
  Wait-DevBundle $DevServerUrl $false $StartupTimeoutSeconds
  Start-Sleep -Milliseconds $ReloadWaitMs
  Save-WindowPng $window (Join-Path $outputPath "03-error-screen.png")
  $lines.Add("03=03-error-screen.png")

  Write-DemoSfc $appVue "HMR recovered" "修复 SFC 后，错误屏通过同一 reload 路径恢复" "0xFFFFB020"
  Wait-DevBundle $DevServerUrl $true $StartupTimeoutSeconds
  Start-Sleep -Milliseconds $ReloadWaitMs
  Save-WindowPng $window (Join-Path $outputPath "04-recovered.png")
  $lines.Add("04=04-recovered.png")

  $lines.Add("CompletedAt=$((Get-Date).ToString('o'))")
  Set-Content -LiteralPath $manifest -Value $lines -Encoding UTF8
  Write-Host "[hmr-smoke] manifest $manifest"
} finally {
  Set-Content -LiteralPath $appVue -Value $originalAppVue -Encoding UTF8
  $env:ARRANGE_DEV_SERVER = $oldArrangeDevServer

  if ($standaloneProcess -ne $null) {
    try {
      $standaloneProcess.Refresh()
      if (-not $standaloneProcess.HasExited) {
        [void]$standaloneProcess.CloseMainWindow()
        if (-not $standaloneProcess.WaitForExit(3000)) {
          $standaloneProcess.Kill()
          $standaloneProcess.WaitForExit()
        }
      }
    } catch {}
  }

  if ($devServerProcess -ne $null) {
    try {
      $devServerProcess.Refresh()
      if (-not $devServerProcess.HasExited) {
        $devServerProcess.Kill()
        $devServerProcess.WaitForExit()
      }
    } catch {}
  }
}
