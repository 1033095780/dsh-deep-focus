# dsh-deep-focus: emit "<idleMs>|<foreground pid>|<process name>" once per sample interval.
# ASCII only: Windows PowerShell 5.1 reads BOM-less files as ANSI, so no non-ASCII characters here.
$ErrorActionPreference = 'Stop'

Add-Type -Namespace DshDeepFocus -Name Foreground -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
[DllImport("kernel32.dll")] public static extern ulong GetTickCount64();
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
public static ulong IdleMs() {
  LASTINPUTINFO lii = new LASTINPUTINFO();
  lii.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(LASTINPUTINFO));
  if (!GetLastInputInfo(ref lii)) { return 0xFFFFFFFFUL; }
  ulong tick = GetTickCount64() & 0xFFFFFFFFUL;
  uint last = lii.dwTime;
  return tick >= last ? tick - last : (0x100000000UL - last) + tick;
}
"@

$sampleMs = 5000
if ($env:DSH_FOCUS_SAMPLE_MS) {
  $parsed = 0
  if ([int]::TryParse($env:DSH_FOCUS_SAMPLE_MS, [ref]$parsed)) {
    if ($parsed -ge 300) { $sampleMs = $parsed }
  }
}

while ($true) {
  $idle = [DshDeepFocus.Foreground]::IdleMs()
  $hwnd = [DshDeepFocus.Foreground]::GetForegroundWindow()
  $fgPid = [uint32]0
  $exe = ''
  if ($hwnd -ne [IntPtr]::Zero) {
    try { [void][DshDeepFocus.Foreground]::GetWindowThreadProcessId($hwnd, [ref]$fgPid) } catch { $fgPid = [uint32]0 }
    if ($fgPid -gt 0) {
      try { $exe = [System.Diagnostics.Process]::GetProcessById([int]$fgPid).ProcessName } catch { $exe = '' }
    }
  }
  $nameB64 = ''
  if ($exe.Length -gt 0) {
    $nameB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($exe))
  }
  [Console]::Out.WriteLine(([string]$idle) + '|' + ([string]$fgPid) + '|b64:' + $nameB64)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds $sampleMs
}
