#Requires -Version 5.1
param([string]$Indirizzo, [switch]$Pulisci)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$session = Join-Path $env:LOCALAPPDATA 'ForgiaPilotaTemporaneo'
$shared = Join-Path $root 'Da-allegare'
$stateFile = Join-Path $session 'session.json'
$pfxPath = Join-Path $session 'server.pfx'
$caPath = Join-Path $shared 'Forgia-Pilota-CA.cer'
$accountsPath = Join-Path $session 'accounts.json'
$port = 8443
$model = 'qwen2.5:1.5b'

function Write-Json($Path, $Value) {
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 5), [Text.UTF8Encoding]::new($false))
}

function New-HexSecret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

function Invoke-Firewall([string]$Rule, [string]$Ip, [switch]$Remove) {
    if ($Rule -notmatch '^ForgiaPilota-[0-9a-f]{32}$') { throw 'Regola firewall non valida.' }
    if ($Remove) {
        $command = "Get-NetFirewallRule -Name '$Rule' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop"
    } else {
        if ($Ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw 'Indirizzo non valido.' }
        $command = "Get-NetFirewallRule -Name '$Rule' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop; New-NetFirewallRule -Name '$Rule' -DisplayName 'Forgia pilota temporaneo' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -LocalAddress '$Ip' -RemoteAddress LocalSubnet -Profile Private -EdgeTraversalPolicy Block -ErrorAction Stop | Out-Null"
    }
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("try { $command } catch { exit 1 }; exit 0"))
    $process = Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile', '-EncodedCommand', $encoded -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw 'Impossibile aggiornare la regola firewall temporanea.' }
}

$state = if (Test-Path $stateFile) { Get-Content $stateFile -Raw | ConvertFrom-Json } else { $null }
if ($Pulisci) {
    if ($state) {
        if ($state.RuntimeId) {
            $oldRuntime = Get-Process -Id $state.RuntimeId -ErrorAction SilentlyContinue
            if ($oldRuntime -and $oldRuntime.ProcessName -eq 'ollama' -and
                $oldRuntime.StartTime.ToUniversalTime().ToString('o') -eq $state.RuntimeStartedAt) {
                Stop-Process -Id $oldRuntime.Id -Force
            }
        }
        if ($state.ProcessId) {
            $oldGateway = Get-Process -Id $state.ProcessId -ErrorAction SilentlyContinue
            if ($oldGateway -and $oldGateway.ProcessName -eq 'node' -and
                $oldGateway.StartTime.ToUniversalTime().ToString('o') -eq $state.ProcessStartedAt) {
                Stop-Process -Id $oldGateway.Id -Force
            }
        }
        Invoke-Firewall -Rule $state.FirewallRule -Remove
    }
    if (Test-Path $session) { Remove-Item $session -Recurse -Force }
    foreach ($publicFile in @($caPath, (Join-Path $shared 'Forgia-Pilota-URL.txt'))) {
        if (Test-Path $publicFile) { Remove-Item $publicFile -Force }
    }
    Write-Host 'Sessione Windows rimossa. Rimuovi anche il certificato pilota da iPhone.'
    return
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node -or [int]((& $node.Source --version).TrimStart('v').Split('.')[0]) -lt 24) {
    throw 'Installa Node.js 24, poi riapri PowerShell.'
}
$ollamaCommand = Get-Command ollama.exe -ErrorAction SilentlyContinue
$ollama = if ($ollamaCommand) { $ollamaCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe' }
if (-not (Test-Path $ollama)) { throw 'Installa Ollama per Windows, poi riapri PowerShell.' }

$privateInterfaces = @(Get-NetConnectionProfile | Where-Object NetworkCategory -eq Private | ForEach-Object InterfaceIndex)
$addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.InterfaceIndex -in $privateInterfaces -and $_.AddressState -eq 'Preferred' -and
    $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
})
if ($Indirizzo) { $addresses = @($addresses | Where-Object IPAddress -eq $Indirizzo) }
if ($addresses.Count -ne 1) {
    $options = ($addresses | ForEach-Object { "$($_.InterfaceAlias) $($_.IPAddress)" }) -join ', '
    throw "Scegli l'indirizzo IPv4 della rete privata condivisa con i telefoni tramite -Indirizzo. Reti disponibili: $options"
}
$ip = $addresses[0].IPAddress
if ($state -and ($state.Ip -ne $ip -or [DateTimeOffset]::Parse($state.ValidUntil) -le [DateTimeOffset]::UtcNow)) {
    throw 'La sessione precedente usa un altro indirizzo o un certificato scaduto. Esegui -Pulisci e riavvia il kit.'
}
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "La porta $port e gia in uso. Chiudi il gateway precedente."
}
New-Item -ItemType Directory -Force -Path $session, $shared | Out-Null
if (-not $state) {
    $secret = ConvertTo-SecureString (New-HexSecret) -AsPlainText -Force
    $validUntil = [DateTime]::UtcNow.AddDays(7)
    $issuer = $null
    $leaf = $null
    try {
        $issuer = New-SelfSignedCertificate -Type Custom -Subject 'CN=Forgia Pilota Temporaneo' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyUsage CertSign,CRLSign -KeyExportPolicy NonExportable -NotAfter $validUntil.AddDays(1) -TextExtension '2.5.29.19={critical}{text}ca=true&pathlength=0'
        $leaf = New-SelfSignedCertificate -Type Custom -Subject "CN=$ip" -Signer $issuer -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyUsage DigitalSignature,KeyEncipherment -KeyExportPolicy Exportable -NotAfter $validUntil -TextExtension "2.5.29.17={text}IPAddress=$ip", '2.5.29.37={text}1.3.6.1.5.5.7.3.1'
        Export-Certificate -Cert $issuer -FilePath $caPath | Out-Null
        Export-PfxCertificate -Cert $leaf -FilePath $pfxPath -Password $secret -ChainOption EndEntityCertOnly | Out-Null
    } finally {
        foreach ($cert in @($leaf, $issuer)) {
            if ($cert) { Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -DeleteKey -ErrorAction SilentlyContinue }
        }
    }
    $state = [PSCustomObject]@{
        Ip = $ip; ValidUntil = $validUntil.ToString('o'); Password = (ConvertFrom-SecureString $secret);
        FirewallRule = 'ForgiaPilota-' + [Guid]::NewGuid().ToString('N'); ProcessId = $null; ProcessStartedAt = $null
        RuntimeId = $null; RuntimeStartedAt = $null
    }
    Write-Json $stateFile $state
}
if (-not (Test-Path $caPath) -or -not (Test-Path $pfxPath)) {
    throw 'I file della sessione sono incompleti. Esegui -Pulisci e riavvia il kit.'
}
$origin = "https://${ip}:$port"
[IO.File]::WriteAllText((Join-Path $shared 'Forgia-Pilota-URL.txt'), $origin)
$expiry = [DateTimeOffset]::UtcNow.AddHours(8).ToString('o')
$codes = @(New-HexSecret; New-HexSecret)
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $accounts = @($codes | ForEach-Object {
        @{id = [Guid]::NewGuid().ToString(); sha256 = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::ASCII.GetBytes($_))).Replace('-', '').ToLowerInvariant(); expiresAt = $expiry}
    })
} finally { $sha.Dispose() }
Write-Json $accountsPath $accounts

$runtime = $null
$gateway = $null
$firewall = $false
try {
    $env:OLLAMA_HOST = '127.0.0.1:11434'
    try { Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null }
    catch {
        $runtime = Start-Process $ollama -ArgumentList 'serve' -WindowStyle Hidden -PassThru
        $state.RuntimeId = $runtime.Id
        $state.RuntimeStartedAt = $runtime.StartTime.ToUniversalTime().ToString('o')
        Write-Json $stateFile $state
        for ($n = 0; $n -lt 30; $n++) {
            try { Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null; break }
            catch { if ($n -eq 29) { throw }; Start-Sleep -Seconds 1 }
        }
    }
    & $ollama pull $model
    if ($LASTEXITCODE -ne 0) { throw 'Il download del modello locale non e riuscito.' }
    Invoke-Firewall -Rule $state.FirewallRule -Ip $ip
    $firewall = $true
    $env:OLLAMA_MODEL = $model
    foreach ($name in 'LLAMACPP_MODEL', 'GROQ_MODEL', 'OPENROUTER_MODEL', 'CLOUDFLARE_MODEL') {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    $env:FORGIA_DISABLE_WEB_GATEWAY = '1'
    $env:FORGIA_DATA_DIR = Join-Path $session 'data'
    $env:FORGIA_PILOT_HOST = $ip
    $env:FORGIA_PILOT_PORT = "$port"
    $env:FORGIA_PILOT_TLS_PFX = $pfxPath
    $secret = ConvertTo-SecureString $state.Password
    $env:FORGIA_PILOT_TLS_PFX_PASSWORD = [System.Net.NetworkCredential]::new('', $secret).Password
    $env:FORGIA_PILOT_ACCOUNTS = $accountsPath
    $gateway = Start-Process $node.Source -ArgumentList '--experimental-strip-types', 'server/main.ts' -WorkingDirectory $root -NoNewWindow -PassThru
    $state.ProcessId = $gateway.Id
    $state.ProcessStartedAt = $gateway.StartTime.ToUniversalTime().ToString('o')
    Write-Json $stateFile $state
    $env:FORGIA_SMOKE_TEST_CODE = $codes[0]
    try {
        & $node.Source (Join-Path $PSScriptRoot 'verifica-pilota-windows.mjs') $origin $caPath
        if ($LASTEXITCODE -ne 0) { throw 'Il gateway non ha superato la verifica HTTPS locale.' }
    } finally {
        [Environment]::SetEnvironmentVariable('FORGIA_SMOKE_TEST_CODE', $null, 'Process')
    }
    Write-Host "Gateway attivo su $origin"
    Write-Host "Codice iPhone:  $($codes[0])"
    Write-Host "Codice Android: $($codes[1])"
    Write-Host "Allega in chat solo i due file nella cartella Da-allegare. Lascia aperta questa finestra."
    Read-Host 'Premi Invio per spegnere il gateway' | Out-Null
} finally {
    if ($gateway -and -not $gateway.HasExited) { Stop-Process -Id $gateway.Id -Force }
    if ($runtime -and -not $runtime.HasExited) { Stop-Process -Id $runtime.Id -Force }
    [Environment]::SetEnvironmentVariable('FORGIA_PILOT_TLS_PFX_PASSWORD', $null, 'Process')
    if (Test-Path $accountsPath) { Remove-Item $accountsPath -Force }
    if ($firewall) {
        try { Invoke-Firewall -Rule $state.FirewallRule -Remove }
        catch { Write-Warning 'Esegui il comando con -Pulisci per rimuovere la regola firewall.' }
    }
}
