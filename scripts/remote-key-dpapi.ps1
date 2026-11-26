# Windows-only DPAPI key source. Call through the Node adapter, not a terminal.
param([Parameter(Mandatory=$true)][ValidateSet('init','read')][string]$Action,
      [Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
$key = $null
$blob = $null
$rng = $null
$stream = $null
try {
    if ($env:OS -ne 'Windows_NT' -or -not [Console]::IsOutputRedirected) { throw 'Refused' }
    Add-Type -AssemblyName System.Security
    $dir = Get-Item -LiteralPath $Directory -Force
    if (-not $dir.PSIsContainer -or ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refused' }
    $path = [IO.Path]::Combine($dir.FullName, 'remote-key-v1.dpapi')
    $entropy = [Text.Encoding]::ASCII.GetBytes('forgia-remote-key:v1')
    $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($Action -eq 'init') {
        $key = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($key)
        $blob = [Security.Cryptography.ProtectedData]::Protect($key, $entropy, $scope)
        $stream = [IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        $stream.Write($blob,0,$blob.Length)
        $stream.Flush($true)
    } else {
        $file = Get-Item -LiteralPath $path -Force
        if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -lt 1 -or $file.Length -gt 4096) { throw 'Refused' }
        $blob = [IO.File]::ReadAllBytes($path)
        if ($blob.Length -gt 4096) { throw 'Refused' }
        $key = [Security.Cryptography.ProtectedData]::Unprotect($blob, $entropy, $scope)
        if ($key.Length -ne 32) { throw 'Refused' }
        # Private anonymous child stdout, consumed only by Node. No console or file output.
        $out = [Console]::OpenStandardOutput()
        $hex = [Text.Encoding]::ASCII.GetBytes([BitConverter]::ToString($key).Replace('-','').ToLowerInvariant())
        try { $out.Write($hex,0,$hex.Length); $out.Flush() }
        finally { [Array]::Clear($hex,0,$hex.Length) }
    }
} catch {
    [Console]::Error.WriteLine('Windows key source refused or failed.')
    exit 1
} finally {
    if ($stream) { $stream.Dispose() }
    if ($rng) { $rng.Dispose() }
    if ($key) { [Array]::Clear($key,0,$key.Length) }
    if ($blob) { [Array]::Clear($blob,0,$blob.Length) }
}
