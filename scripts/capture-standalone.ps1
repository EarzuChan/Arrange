param(
  [Parameter(Mandatory = $true)]
  [string] $Executable,

  [Parameter(Mandatory = $true)]
  [string] $OutputPng,

  [int] $ClickX = -1,

  [int] $ClickY = -1,

  [int] $ClickDelayMs = 250,

  [int] $MoveX = -1,

  [int] $MoveY = -1,

  [int] $WindowWidth = -1,

  [int] $WindowHeight = -1,

  [string] $TypeText = "",

  [int] $TypeDelayMs = 80,

  [switch] $TypeViaMessage,

  [int] $WheelDelta = 0,

  [int] $WheelX = -1,

  [int] $WheelY = -1,

  [switch] $UseScreenCapture
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class Win32Capture {
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
  public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

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

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

  public static string GetTitle(IntPtr hWnd) {
    int length = GetWindowTextLength(hWnd);
    StringBuilder builder = new StringBuilder(Math.Max(length + 1, 256));
    GetWindowText(hWnd, builder, builder.Capacity);
    return builder.ToString();
  }

  public static string GetClass(IntPtr hWnd) {
    StringBuilder builder = new StringBuilder(256);
    GetClassName(hWnd, builder, builder.Capacity);
    return builder.ToString();
  }

  static bool IsAppWindowCandidate(IntPtr hWnd) {
    string title = GetTitle(hWnd);
    string className = GetClass(hWnd);
    if (String.IsNullOrWhiteSpace(title)) return false;
    if (title == "Tooltip" || title == "JUCEWindow") return false;
    if (title == "DirectSound" || title == "Windows Audio") return false;
    if (title.StartsWith("JuceMidiDeviceDetector_", StringComparison.Ordinal)) return false;
    if (className == "CiceroUIWndFrame" || className == "MSCTFIME UI" || className == "IME") return false;
    if (className.StartsWith("UAC", StringComparison.Ordinal)) return false;
    return true;
  }

  public static IntPtr FindVisibleWindowForProcess(uint pid) {
    IntPtr visibleTitled = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint windowPid;
      GetWindowThreadProcessId(hWnd, out windowPid);
      if (windowPid == pid) {
        bool visible = IsWindowVisible(hWnd);
        if (IsAppWindowCandidate(hWnd)) {
          if (visible) {
            visibleTitled = hWnd;
            return false;
          }
        }
      }
      return true;
    }, IntPtr.Zero);
    return visibleTitled;
  }

  public static void ClickScreenPoint(int x, int y) {
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    SetCursorPos(x, y);
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
  }

  public static void WheelScreenPoint(int x, int y, int delta) {
    const uint MOUSEEVENTF_WHEEL = 0x0800;
    SetCursorPos(x, y);
    mouse_event(MOUSEEVENTF_WHEEL, 0, 0, unchecked((uint)delta), UIntPtr.Zero);
  }

  public static void WheelClientPoint(IntPtr hWnd, int screenX, int screenY, int delta) {
    const uint WM_MOUSEWHEEL = 0x020A;
    IntPtr wParam = new IntPtr(delta << 16);
    IntPtr lParam = new IntPtr((screenY << 16) | (screenX & 0xffff));
    SendMessage(hWnd, WM_MOUSEWHEEL, wParam, lParam);
  }

  public static void ClickClientPoint(IntPtr hWnd, int x, int y) {
    const uint WM_LBUTTONDOWN = 0x0201;
    const uint WM_LBUTTONUP = 0x0202;
    IntPtr wParam = new IntPtr(1);
    IntPtr lParam = new IntPtr((y << 16) | (x & 0xffff));
    SendMessage(hWnd, WM_LBUTTONDOWN, wParam, lParam);
    SendMessage(hWnd, WM_LBUTTONUP, IntPtr.Zero, lParam);
  }

  public static void SendChar(IntPtr hWnd, char ch) {
    const uint WM_CHAR = 0x0102;
    SendMessage(hWnd, WM_CHAR, new IntPtr((int)ch), IntPtr.Zero);
  }

  public static void SendVirtualKey(IntPtr hWnd, int keyCode) {
    const uint WM_KEYDOWN = 0x0100;
    const uint WM_KEYUP = 0x0101;
    SendMessage(hWnd, WM_KEYDOWN, new IntPtr(keyCode), IntPtr.Zero);
    SendMessage(hWnd, WM_KEYUP, new IntPtr(keyCode), IntPtr.Zero);
  }
}
"@

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not (Test-Path -LiteralPath $Executable)) {
  throw "Standalone executable not found: $Executable"
}

$outputDir = Split-Path -Parent $OutputPng
if ($outputDir) {
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

$workdir = Split-Path -Parent $Executable
$process = Start-Process -FilePath $Executable -WorkingDirectory $workdir -PassThru

try {
  $deadline = (Get-Date).AddSeconds(25)
  do {
    Start-Sleep -Milliseconds 250
    $process.Refresh()
    $window = [Win32Capture]::FindVisibleWindowForProcess([uint32]$process.Id)
    if ($window -ne [IntPtr]::Zero) { break }
  } while ((Get-Date) -lt $deadline -and -not $process.HasExited)

  if ($process.HasExited) {
    throw "Standalone exited before a window appeared. ExitCode=$($process.ExitCode)"
  }

  if ($window -eq [IntPtr]::Zero) {
    throw "Timed out waiting for Standalone main window. ProcessId=$($process.Id)"
  }

  Write-Host "[capture] window handle=$window title='$([Win32Capture]::GetTitle($window))'"
  [void][Win32Capture]::ShowWindow($window, 9)
  [void][Win32Capture]::BringWindowToTop($window)
  [void][Win32Capture]::SetForegroundWindow($window)
  Start-Sleep -Milliseconds 800

  $rect = New-Object Win32Capture+RECT
  if (-not [Win32Capture]::GetWindowRect($window, [ref] $rect)) {
    throw "GetWindowRect failed."
  }

  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 0 -or $height -le 0) {
    throw "Invalid window rectangle: $($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)"
  }

  if ($MoveX -ge 0 -or $MoveY -ge 0 -or $WindowWidth -gt 0 -or $WindowHeight -gt 0) {
    $targetX = if ($MoveX -ge 0) { $MoveX } else { $rect.Left }
    $targetY = if ($MoveY -ge 0) { $MoveY } else { $rect.Top }
    $targetWidth = if ($WindowWidth -gt 0) { $WindowWidth } else { $width }
    $targetHeight = if ($WindowHeight -gt 0) { $WindowHeight } else { $height }
    Write-Host "[capture] move window to=($targetX,$targetY) size=($targetWidth,$targetHeight)"
    [void][Win32Capture]::MoveWindow($window, $targetX, $targetY, $targetWidth, $targetHeight, $true)
    Start-Sleep -Milliseconds 350
    if (-not [Win32Capture]::GetWindowRect($window, [ref] $rect)) {
      throw "GetWindowRect failed after MoveWindow."
    }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
  }

  if ($ClickX -ge 0 -and $ClickY -ge 0) {
    $screenX = $rect.Left + $ClickX
    $screenY = $rect.Top + $ClickY
    Write-Host "[capture] click relative=($ClickX,$ClickY) screen=($screenX,$screenY)"
    [Win32Capture]::ClickScreenPoint($screenX, $screenY)
    [Win32Capture]::ClickClientPoint($window, $ClickX, $ClickY)
    Start-Sleep -Milliseconds $ClickDelayMs
  }

  if ($TypeText.Length -gt 0) {
    Write-Host "[capture] type text length=$($TypeText.Length)"
    [void][Win32Capture]::BringWindowToTop($window)
    [void][Win32Capture]::SetForegroundWindow($window)
    if ($TypeViaMessage) {
      $index = 0
      while ($index -lt $TypeText.Length) {
        if ($TypeText.Substring($index).StartsWith("{ENTER}")) {
          [Win32Capture]::SendVirtualKey($window, 13)
          $index += 7
        } else {
          [Win32Capture]::SendChar($window, $TypeText[$index])
          $index += 1
        }
        Start-Sleep -Milliseconds $TypeDelayMs
      }
    } else {
      [System.Windows.Forms.SendKeys]::SendWait($TypeText)
      foreach ($ch in $TypeText.ToCharArray()) { Start-Sleep -Milliseconds $TypeDelayMs }
    }
    Start-Sleep -Milliseconds $ClickDelayMs
  }

  if ($WheelDelta -ne 0) {
    $relativeX = if ($WheelX -ge 0) { $WheelX } elseif ($ClickX -ge 0) { $ClickX } else { [int]($width / 2) }
    $relativeY = if ($WheelY -ge 0) { $WheelY } elseif ($ClickY -ge 0) { $ClickY } else { [int]($height / 2) }
    $screenX = $rect.Left + $relativeX
    $screenY = $rect.Top + $relativeY
    Write-Host "[capture] wheel relative=($relativeX,$relativeY) screen=($screenX,$screenY) delta=$WheelDelta"
    [void][Win32Capture]::BringWindowToTop($window)
    [void][Win32Capture]::SetForegroundWindow($window)
    [Win32Capture]::WheelScreenPoint($screenX, $screenY, $WheelDelta)
    [Win32Capture]::WheelClientPoint($window, $screenX, $screenY, $WheelDelta)
    Start-Sleep -Milliseconds $ClickDelayMs
  }

  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $printed = $false
    if (-not $UseScreenCapture) {
      $hdc = $graphics.GetHdc()
      try {
        $printed = [Win32Capture]::PrintWindow($window, $hdc, 2)
      } finally {
        $graphics.ReleaseHdc($hdc)
      }
    }
    if ($UseScreenCapture -or -not $printed) {
      $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    }
    $bitmap.Save($OutputPng, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }

  Write-Host "[capture] saved $OutputPng"
} finally {
  if (-not $process.HasExited) {
    [void]$process.CloseMainWindow()
    if (-not $process.WaitForExit(3000)) {
      $process.Kill()
      $process.WaitForExit()
    }
  }
}
