param(
  [Parameter(Mandatory = $true)]
  [string] $Executable,

  [Parameter(Mandatory = $true)]
  [string] $OutputTxt
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class Win32Inspect {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumChildWindows(IntPtr hWnd, EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
  public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowTextLength(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

  public static string GetText(IntPtr hWnd) {
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

  public static string GetRectText(IntPtr hWnd) {
    RECT rect;
    if (!GetWindowRect(hWnd, out rect)) return "unavailable";
    return rect.Left + "," + rect.Top + "," + rect.Right + "," + rect.Bottom;
  }

  public static string GetStyleText(IntPtr hWnd) {
    long style = GetWindowLongPtr64(hWnd, -16).ToInt64();
    bool thickFrame = (style & 0x00040000L) != 0;
    bool maximizeBox = (style & 0x00010000L) != 0;
    return "0x" + style.ToString("X") + " WS_THICKFRAME=" + thickFrame + " WS_MAXIMIZEBOX=" + maximizeBox;
  }
}
"@

$outputDir = Split-Path -Parent $OutputTxt
if ($outputDir) { New-Item -ItemType Directory -Force -Path $outputDir | Out-Null }

$process = Start-Process -FilePath $Executable -WorkingDirectory (Split-Path -Parent $Executable) -PassThru
$lines = New-Object System.Collections.Generic.List[string]
try {
  Start-Sleep -Seconds 3
  $process.Refresh()
  $lines.Add("ProcessId=$($process.Id) HasExited=$($process.HasExited) ExitCode=$($process.ExitCode)")
  [Win32Inspect]::EnumWindows({
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    [uint32]$windowPid = 0
    [void][Win32Inspect]::GetWindowThreadProcessId($hWnd, [ref]$windowPid)
    if ($windowPid -eq [uint32]$process.Id) {
      $lines.Add("WINDOW hwnd=$hWnd visible=$([Win32Inspect]::IsWindowVisible($hWnd)) class='$([Win32Inspect]::GetClass($hWnd))' text='$([Win32Inspect]::GetText($hWnd))' rect=$([Win32Inspect]::GetRectText($hWnd)) style=$([Win32Inspect]::GetStyleText($hWnd))")
      [Win32Inspect]::EnumChildWindows($hWnd, {
        param([IntPtr]$child, [IntPtr]$unused)
        $lines.Add("  CHILD hwnd=$child visible=$([Win32Inspect]::IsWindowVisible($child)) class='$([Win32Inspect]::GetClass($child))' text='$([Win32Inspect]::GetText($child))'")
        return $true
      }, [IntPtr]::Zero) | Out-Null
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  Set-Content -Path $OutputTxt -Value $lines -Encoding UTF8
  Get-Content -Path $OutputTxt
} finally {
  if (-not $process.HasExited) {
    [void]$process.CloseMainWindow()
    if (-not $process.WaitForExit(3000)) {
      $process.Kill()
      $process.WaitForExit()
    }
  }
}
