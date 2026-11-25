/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import type { DesktopMouseButton, DesktopUiElement, DesktopWindowInfo } from '@/common/desktopControl';

const POWERSHELL_TIMEOUT_MS = 15_000;

const VIRTUAL_KEY_MAP: Record<string, number> = {
  backspace: 0x08,
  tab: 0x09,
  enter: 0x0d,
  return: 0x0d,
  shift: 0x10,
  ctrl: 0x11,
  control: 0x11,
  alt: 0x12,
  menu: 0x12,
  pause: 0x13,
  capslock: 0x14,
  esc: 0x1b,
  escape: 0x1b,
  space: 0x20,
  pageup: 0x21,
  pagedown: 0x22,
  end: 0x23,
  home: 0x24,
  left: 0x25,
  arrowleft: 0x25,
  up: 0x26,
  arrowup: 0x26,
  right: 0x27,
  arrowright: 0x27,
  down: 0x28,
  arrowdown: 0x28,
  printscreen: 0x2c,
  insert: 0x2d,
  delete: 0x2e,
  del: 0x2e,
  win: 0x5b,
  lwin: 0x5b,
  meta: 0x5b,
  cmd: 0x5b,
  super: 0x5b,
  rwin: 0x5c,
  f1: 0x70,
  f2: 0x71,
  f3: 0x72,
  f4: 0x73,
  f5: 0x74,
  f6: 0x75,
  f7: 0x76,
  f8: 0x77,
  f9: 0x78,
  f10: 0x79,
  f11: 0x7a,
  f12: 0x7b,
  f13: 0x7c,
  f14: 0x7d,
  f15: 0x7e,
  f16: 0x7f,
  f17: 0x80,
  f18: 0x81,
  f19: 0x82,
  f20: 0x83,
  f21: 0x84,
  f22: 0x85,
  f23: 0x86,
  f24: 0x87,
  ';': 0xba,
  '=': 0xbb,
  ',': 0xbc,
  '-': 0xbd,
  '.': 0xbe,
  '/': 0xbf,
  '`': 0xc0,
  '[': 0xdb,
  '\\': 0xdc,
  ']': 0xdd,
  "'": 0xde,
};

/**
 * Resolve a human-friendly key name (e.g. "Ctrl", "Enter", "a", "F5") into a Windows Virtual Key code.
 */
export function resolveVirtualKeyCode(key: string): number {
  const normalized = key.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Key name cannot be empty.');
  }
  if (normalized in VIRTUAL_KEY_MAP) {
    return VIRTUAL_KEY_MAP[normalized];
  }
  if (/^[a-z0-9]$/.test(normalized)) {
    return normalized.toUpperCase().charCodeAt(0);
  }
  throw new Error(`Unsupported key name: "${key}"`);
}

/**
 * Resolve an array of key names into validated Windows Virtual Key codes.
 */
export function resolveHotkeyCodes(keys: string[]): number[] {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('At least one key must be provided.');
  }
  return keys.map(resolveVirtualKeyCode);
}

/**
 * Validate finite screen coordinates.
 */
export function validateCoordinates(x: number, y: number): { x: number; y: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`Invalid screen coordinates: (${String(x)}, ${String(y)})`);
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Shared Win32 P/Invoke preamble compiled once per PowerShell invocation.
 */
export const WIN32_CSHARP_PREAMBLE = `
$win32Code = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace AionUiDesktop {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public INPUTUNION U;
  }

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  public static class Native {
    public const uint INPUT_MOUSE = 0;
    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_HWHEEL = 0x01000;
    public const int SW_RESTORE = 9;

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public static void SendMouseFlags(uint flags, int mouseData = 0) {
      var input = new INPUT[1];
      input[0].type = INPUT_MOUSE;
      input[0].U.mi.dwFlags = flags;
      input[0].U.mi.mouseData = unchecked((uint)mouseData);
      SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void SendUnicodeText(string text) {
      if (string.IsNullOrEmpty(text)) return;
      var inputs = new List<INPUT>(text.Length * 2);
      foreach (char ch in text) {
        inputs.Add(new INPUT {
          type = INPUT_KEYBOARD,
          U = new INPUTUNION {
            ki = new KEYBDINPUT { wVk = 0, wScan = ch, dwFlags = KEYEVENTF_UNICODE }
          }
        });
        inputs.Add(new INPUT {
          type = INPUT_KEYBOARD,
          U = new INPUTUNION {
            ki = new KEYBDINPUT { wVk = 0, wScan = ch, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP }
          }
        });
      }
      var arr = inputs.ToArray();
      SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void SendKeyCombo(ushort[] vks) {
      var inputs = new List<INPUT>(vks.Length * 2);
      for (int i = 0; i < vks.Length; i++) {
        inputs.Add(new INPUT {
          type = INPUT_KEYBOARD,
          U = new INPUTUNION { ki = new KEYBDINPUT { wVk = vks[i], dwFlags = 0 } }
        });
      }
      for (int i = vks.Length - 1; i >= 0; i--) {
        inputs.Add(new INPUT {
          type = INPUT_KEYBOARD,
          U = new INPUTUNION { ki = new KEYBDINPUT { wVk = vks[i], dwFlags = KEYEVENTF_KEYUP } }
        });
      }
      var arr = inputs.ToArray();
      SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    }
  }
}
"@
Add-Type -TypeDefinition $win32Code -Language CSharp
[void][AionUiDesktop.Native]::SetProcessDPIAware()
`;

const PAYLOAD_LOADER = `
$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:AIONUI_DC_PAYLOAD))
$payload = $payloadJson | ConvertFrom-Json
`;

export function buildClickScript(): string {
  return `
${WIN32_CSHARP_PREAMBLE}
${PAYLOAD_LOADER}
[void][AionUiDesktop.Native]::SetCursorPos([int]$payload.x, [int]$payload.y)
Start-Sleep -Milliseconds 25
$downFlag = [uint32]0x0002
$upFlag = [uint32]0x0004
if ($payload.button -eq 'right') {
  $downFlag = [uint32]0x0008
  $upFlag = [uint32]0x0010
} elseif ($payload.button -eq 'middle') {
  $downFlag = [uint32]0x0020
  $upFlag = [uint32]0x0040
}
$count = [int]$payload.clickCount
for ($i = 0; $i -lt $count; $i++) {
  [AionUiDesktop.Native]::SendMouseFlags($downFlag)
  [AionUiDesktop.Native]::SendMouseFlags($upFlag)
  if ($i -lt ($count - 1)) { Start-Sleep -Milliseconds 40 }
}
@{ clicked = $true; x = [int]$payload.x; y = [int]$payload.y; button = $payload.button; clickCount = $count } | ConvertTo-Json -Compress
`;
}

export function buildMoveScript(): string {
  return `
${WIN32_CSHARP_PREAMBLE}
${PAYLOAD_LOADER}
if ($payload.drag -eq $true) {
  [void][AionUiDesktop.Native]::SetCursorPos([int]$payload.x, [int]$payload.y)
  Start-Sleep -Milliseconds 30
  [AionUiDesktop.Native]::SendMouseFlags([uint32]0x0002)
  Start-Sleep -Milliseconds 40
  [void][AionUiDesktop.Native]::SetCursorPos([int]$payload.toX, [int]$payload.toY)
  Start-Sleep -Milliseconds 40
  [AionUiDesktop.Native]::SendMouseFlags([uint32]0x0004)
  @{ moved = $true; dragged = $true; from = @{ x = [int]$payload.x; y = [int]$payload.y }; to = @{ x = [int]$payload.toX; y = [int]$payload.toY } } | ConvertTo-Json -Compress
} else {
  [void][AionUiDesktop.Native]::SetCursorPos([int]$payload.x, [int]$payload.y)
  @{ moved = $true; dragged = $false; x = [int]$payload.x; y = [int]$payload.y } | ConvertTo-Json -Compress
}
`;
}

export function buildScrollScript(): string {
  return `
${WIN32_CSHARP_PREAMBLE}
${PAYLOAD_LOADER}
if ($null -ne $payload.x -and $null -ne $payload.y) {
  [void][AionUiDesktop.Native]::SetCursorPos([int]$payload.x, [int]$payload.y)
  Start-Sleep -Milliseconds 20
}
if ([int]$payload.deltaY -ne 0) {
  [AionUiDesktop.Native]::SendMouseFlags([uint32]0x0800, [int]$payload.deltaY)
}
if ([int]$payload.deltaX -ne 0) {
  [AionUiDesktop.Native]::SendMouseFlags([uint32]0x01000, [int]$payload.deltaX)
}
@{ scrolled = $true; deltaX = [int]$payload.deltaX; deltaY = [int]$payload.deltaY } | ConvertTo-Json -Compress
`;
}

export function buildTypeScript(): string {
  return `
${WIN32_CSHARP_PREAMBLE}
${PAYLOAD_LOADER}
[AionUiDesktop.Native]::SendUnicodeText([string]$payload.text)
@{ typed = $true; length = ([string]$payload.text).Length } | ConvertTo-Json -Compress
`;
}

export function buildHotkeyScript(): string {
  return `
${WIN32_CSHARP_PREAMBLE}
${PAYLOAD_LOADER}
$vkArray = [ushort[]]@($payload.vkCodes | ForEach-Object { [ushort]$_ })
[AionUiDesktop.Native]::SendKeyCombo($vkArray)
@{ pressed = $true; keys = $payload.keys } | ConvertTo-Json -Compress
`;
}

export function buildCursorScript(): string {
  return `
${WIN32_CSHARP_PREAMBLE}
$pt = New-Object AionUiDesktop.POINT
[void][AionUiDesktop.Native]::GetCursorPos([ref]$pt)
@{ x = $pt.X; y = $pt.Y } | ConvertTo-Json -Compress
`;
}

export function buildListWindowsScript(): string {
  return `
${WIN32_CSHARP_PREAMBLE}
$fg = [AionUiDesktop.Native]::GetForegroundWindow()
$results = New-Object System.Collections.ArrayList
$procCache = @{}
$cb = [AionUiDesktop.EnumWindowsProc]{
  param($hWnd, $lParam)
  if (-not [AionUiDesktop.Native]::IsWindowVisible($hWnd)) { return $true }
  $len = [AionUiDesktop.Native]::GetWindowTextLength($hWnd)
  if ($len -le 0) { return $true }
  $sb = New-Object System.Text.StringBuilder ($len + 1)
  [void][AionUiDesktop.Native]::GetWindowText($hWnd, $sb, $sb.Capacity)
  $title = $sb.ToString()
  if ([string]::IsNullOrWhiteSpace($title)) { return $true }
  $rect = New-Object AionUiDesktop.RECT
  [void][AionUiDesktop.Native]::GetWindowRect($hWnd, [ref]$rect)
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top
  if ($w -le 0 -or $h -le 0) { return $true }
  [uint32]$procId = 0
  [void][AionUiDesktop.Native]::GetWindowThreadProcessId($hWnd, [ref]$procId)
  $procName = ''
  if ($procId -gt 0) {
    if (-not $procCache.ContainsKey($procId)) {
      try { $procCache[$procId] = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $procCache[$procId] = '' }
    }
    $procName = $procCache[$procId]
  }
  [void]$results.Add([pscustomobject]@{
    hwnd = ('0x{0:X}' -f $hWnd.ToInt64())
    title = $title
    processName = $procName
    pid = [int]$procId
    bounds = [pscustomobject]@{ x = $rect.Left; y = $rect.Top; width = $w; height = $h }
    isMinimized = [bool][AionUiDesktop.Native]::IsIconic($hWnd)
    isForeground = ($hWnd -eq $fg)
  })
  return $true
}
[void][AionUiDesktop.Native]::EnumWindows($cb, [IntPtr]::Zero)
ConvertTo-Json -InputObject @($results) -Depth 4 -Compress
`;
}

export function buildFocusWindowScript(): string {
  return `
${WIN32_CSHARP_PREAMBLE}
${PAYLOAD_LOADER}
$targetHwnd = [IntPtr]::Zero
$matchedTitle = ''
$matchedPid = 0
$cb = [AionUiDesktop.EnumWindowsProc]{
  param($hWnd, $lParam)
  if (-not [AionUiDesktop.Native]::IsWindowVisible($hWnd)) { return $true }
  $hwndHex = ('0x{0:X}' -f $hWnd.ToInt64())
  $len = [AionUiDesktop.Native]::GetWindowTextLength($hWnd)
  $title = ''
  if ($len -gt 0) {
    $sb = New-Object System.Text.StringBuilder ($len + 1)
    [void][AionUiDesktop.Native]::GetWindowText($hWnd, $sb, $sb.Capacity)
    $title = $sb.ToString()
  }
  [uint32]$procId = 0
  [void][AionUiDesktop.Native]::GetWindowThreadProcessId($hWnd, [ref]$procId)
  $match = $false
  if ($payload.hwnd -and $hwndHex.ToLower() -eq ([string]$payload.hwnd).ToLower()) { $match = $true }
  elseif ($payload.pid -and [int]$procId -eq [int]$payload.pid -and -not [string]::IsNullOrWhiteSpace($title)) { $match = $true }
  elseif ($payload.title -and $title -and $title.ToLower().Contains(([string]$payload.title).ToLower())) { $match = $true }
  if ($match) {
    $script:targetHwnd = $hWnd
    $script:matchedTitle = $title
    $script:matchedPid = [int]$procId
    return $false
  }
  return $true
}
[void][AionUiDesktop.Native]::EnumWindows($cb, [IntPtr]::Zero)
if ($targetHwnd -eq [IntPtr]::Zero) {
  throw 'Matching window not found.'
}
if ([AionUiDesktop.Native]::IsIconic($targetHwnd)) {
  [void][AionUiDesktop.Native]::ShowWindow($targetHwnd, [AionUiDesktop.Native]::SW_RESTORE)
}
$focused = [AionUiDesktop.Native]::SetForegroundWindow($targetHwnd)
@{ focused = $focused; hwnd = ('0x{0:X}' -f $targetHwnd.ToInt64()); title = $matchedTitle; pid = $matchedPid } | ConvertTo-Json -Compress
`;
}

export function buildUiTreeScript(): string {
  return `
${WIN32_CSHARP_PREAMBLE}
${PAYLOAD_LOADER}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$targetHwnd = [IntPtr]::Zero
if ($payload.hwnd) {
  $cleanHex = ([string]$payload.hwnd).Replace('0x', '')
  $targetHwnd = [IntPtr]::new([Convert]::ToInt64($cleanHex, 16))
} elseif ($payload.title) {
  $cb = [AionUiDesktop.EnumWindowsProc]{
    param($hWnd, $lParam)
    if (-not [AionUiDesktop.Native]::IsWindowVisible($hWnd)) { return $true }
    $len = [AionUiDesktop.Native]::GetWindowTextLength($hWnd)
    if ($len -le 0) { return $true }
    $sb = New-Object System.Text.StringBuilder ($len + 1)
    [void][AionUiDesktop.Native]::GetWindowText($hWnd, $sb, $sb.Capacity)
    $t = $sb.ToString()
    if ($t.ToLower().Contains(([string]$payload.title).ToLower())) {
      $script:targetHwnd = $hWnd
      return $false
    }
    return $true
  }
  [void][AionUiDesktop.Native]::EnumWindows($cb, [IntPtr]::Zero)
} else {
  $targetHwnd = [AionUiDesktop.Native]::GetForegroundWindow()
}

if ($targetHwnd -eq [IntPtr]::Zero) {
  throw 'Target window for UI tree inspection was not found.'
}

$root = [System.Windows.Automation.AutomationElement]::FromHandle($targetHwnd)
$maxDepth = [int]$payload.maxDepth
$maxNodes = [int]$payload.maxNodes
$script:nodeCount = 0

function Walk-UiaNode {
  param($el, [int]$depth)
  if ($null -eq $el -or $depth -gt $maxDepth -or $script:nodeCount -ge $maxNodes) { return $null }
  $script:nodeCount++
  $cur = $el.Current
  $rect = $cur.BoundingRectangle
  $bx = if ([double]::IsInfinity($rect.X) -or [double]::IsNaN($rect.X)) { 0 } else { [int][Math]::Round($rect.X) }
  $by = if ([double]::IsInfinity($rect.Y) -or [double]::IsNaN($rect.Y)) { 0 } else { [int][Math]::Round($rect.Y) }
  $bw = if ([double]::IsInfinity($rect.Width) -or [double]::IsNaN($rect.Width)) { 0 } else { [int][Math]::Round($rect.Width) }
  $bh = if ([double]::IsInfinity($rect.Height) -or [double]::IsNaN($rect.Height)) { 0 } else { [int][Math]::Round($rect.Height) }

  $val = $null
  try {
    $vp = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      if ($cur.IsPassword) { $val = '[REDACTED]' } else { $val = [string]$vp.Current.Value }
    }
  } catch {}

  $childrenList = New-Object System.Collections.ArrayList
  if ($depth -lt $maxDepth -and $script:nodeCount -lt $maxNodes) {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($el)
    while ($null -ne $child -and $script:nodeCount -lt $maxNodes) {
      $cNode = Walk-UiaNode -el $child -depth ($depth + 1)
      if ($null -ne $cNode) { [void]$childrenList.Add($cNode) }
      $child = $walker.GetNextSibling($child)
    }
  }

  $obj = [ordered]@{
    name = [string]$cur.Name
    controlType = [string]($cur.ControlType.ProgrammaticName -replace '^ControlType\\.', '')
    isEnabled = [bool]$cur.IsEnabled
    bounds = @{ x = $bx; y = $by; width = $bw; height = $bh }
    center = @{ x = [int]($bx + [Math]::Floor($bw / 2)); y = [int]($by + [Math]::Floor($bh / 2)) }
  }
  if ($cur.AutomationId) { $obj.automationId = [string]$cur.AutomationId }
  if ($cur.ClassName) { $obj.className = [string]$cur.ClassName }
  if ($null -ne $val -and $val -ne '') { $obj.value = $val }
  if ($childrenList.Count -gt 0) { $obj.children = @($childrenList) }
  return $obj
}

$tree = Walk-UiaNode -el $root -depth 0
ConvertTo-Json -InputObject $tree -Depth 15 -Compress
`;
}

export function parseJsonStdout<T>(stdout: string): T {
  const trimmed = (stdout || '').trim();
  if (!trimmed) {
    throw new Error('PowerShell command returned empty output.');
  }
  return JSON.parse(trimmed) as T;
}

export type PowerShellRunner = (script: string, payload?: Record<string, unknown>) => Promise<string>;

export const defaultPowerShellRunner: PowerShellRunner = (script, payload) => {
  return new Promise<string>((resolve, reject) => {
    const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
    const env = { ...process.env };
    if (payload !== undefined) {
      env.AIONUI_DC_PAYLOAD = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    }

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-EncodedCommand', encodedCommand],
      { env, timeout: POWERSHELL_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr?.trim() || error.message || 'PowerShell execution failed';
          reject(new Error(msg));
          return;
        }
        resolve(stdout);
      }
    );
  });
};

export interface IDesktopOsDriver {
  click(params: { x: number; y: number; button: DesktopMouseButton; clickCount: number }): Promise<unknown>;
  move(params: { x: number; y: number; drag?: boolean; toX?: number; toY?: number }): Promise<unknown>;
  scroll(params: { x?: number; y?: number; deltaX: number; deltaY: number }): Promise<unknown>;
  typeText(params: { text: string }): Promise<unknown>;
  hotkey(params: { keys: string[] }): Promise<unknown>;
  getCursor(): Promise<{ x: number; y: number }>;
  listWindows(): Promise<DesktopWindowInfo[]>;
  focusWindow(params: { hwnd?: string; title?: string; pid?: number }): Promise<unknown>;
  getUiTree(params: { hwnd?: string; title?: string; maxDepth: number; maxNodes: number }): Promise<DesktopUiElement>;
}

export class WindowsDesktopDriver implements IDesktopOsDriver {
  private readonly runPs: PowerShellRunner;

  constructor(runner: PowerShellRunner = defaultPowerShellRunner) {
    this.runPs = runner;
  }

  public async click(params: {
    x: number;
    y: number;
    button: DesktopMouseButton;
    clickCount: number;
  }): Promise<unknown> {
    const coords = validateCoordinates(params.x, params.y);
    const clickCount = Math.max(1, Math.min(3, Math.round(params.clickCount || 1)));
    const out = await this.runPs(buildClickScript(), {
      x: coords.x,
      y: coords.y,
      button: params.button || 'left',
      clickCount,
    });
    return parseJsonStdout(out);
  }

  public async move(params: { x: number; y: number; drag?: boolean; toX?: number; toY?: number }): Promise<unknown> {
    const start = validateCoordinates(params.x, params.y);
    const drag = Boolean(params.drag);
    const end = drag ? validateCoordinates(params.toX ?? params.x, params.toY ?? params.y) : start;
    const out = await this.runPs(buildMoveScript(), {
      x: start.x,
      y: start.y,
      drag,
      toX: end.x,
      toY: end.y,
    });
    return parseJsonStdout(out);
  }

  public async scroll(params: { x?: number; y?: number; deltaX: number; deltaY: number }): Promise<unknown> {
    const payload: Record<string, unknown> = {
      deltaX: Math.round(params.deltaX || 0),
      deltaY: Math.round(params.deltaY || 0),
    };
    if (params.x !== undefined && params.y !== undefined) {
      const coords = validateCoordinates(params.x, params.y);
      payload.x = coords.x;
      payload.y = coords.y;
    }
    const out = await this.runPs(buildScrollScript(), payload);
    return parseJsonStdout(out);
  }

  public async typeText(params: { text: string }): Promise<unknown> {
    if (typeof params.text !== 'string' || params.text.length === 0) {
      throw new Error('Text to type cannot be empty.');
    }
    const out = await this.runPs(buildTypeScript(), { text: params.text });
    return parseJsonStdout(out);
  }

  public async hotkey(params: { keys: string[] }): Promise<unknown> {
    const vkCodes = resolveHotkeyCodes(params.keys);
    const out = await this.runPs(buildHotkeyScript(), { keys: params.keys, vkCodes });
    return parseJsonStdout(out);
  }

  public async getCursor(): Promise<{ x: number; y: number }> {
    const out = await this.runPs(buildCursorScript());
    return parseJsonStdout<{ x: number; y: number }>(out);
  }

  public async listWindows(): Promise<DesktopWindowInfo[]> {
    const out = await this.runPs(buildListWindowsScript());
    const parsed = parseJsonStdout<DesktopWindowInfo | DesktopWindowInfo[]>(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  public async focusWindow(params: { hwnd?: string; title?: string; pid?: number }): Promise<unknown> {
    if (!params.hwnd && !params.title && !params.pid) {
      throw new Error('Provide at least one of hwnd, title, or pid to focus a window.');
    }
    const out = await this.runPs(buildFocusWindowScript(), params);
    return parseJsonStdout(out);
  }

  public async getUiTree(params: {
    hwnd?: string;
    title?: string;
    maxDepth: number;
    maxNodes: number;
  }): Promise<DesktopUiElement> {
    const out = await this.runPs(buildUiTreeScript(), {
      hwnd: params.hwnd || '',
      title: params.title || '',
      maxDepth: Math.max(1, Math.min(8, Math.round(params.maxDepth || 4))),
      maxNodes: Math.max(10, Math.min(400, Math.round(params.maxNodes || 120))),
    });
    return parseJsonStdout<DesktopUiElement>(out);
  }
}
