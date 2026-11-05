# dsh-deep-focus: write the whole-machine idle time in milliseconds, one sample per interval.
# ASCII only: Windows PowerShell 5.1 reads BOM-less files as ANSI, so no non-ASCII characters here.
$ErrorActionPreference = 'Stop'

Add-Type -Namespace DshDeepFocus -Name IdleTime -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
[DllImport("kernel32.dll")] public static extern ulong GetTickCount64();
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
  $idle = [DshDeepFocus.IdleTime]::IdleMs()
  [Console]::Out.WriteLine([string]$idle)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds $sampleMs
}
