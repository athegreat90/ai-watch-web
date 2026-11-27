<#
.SYNOPSIS
  AI Watch Web standalone installer for Windows (Docker Desktop). Works in Windows PowerShell 5.1 and PowerShell 7.
  Needs only Docker with Compose: no git, Node or Python.

.EXAMPLE
  .\install.ps1 -WithServer              # install the page and the AI Watch server next to it (simplest)
  .\install.ps1 -ServerUrl http://192.168.1.50:8765 -TokenFile .\config.local.json
                                         # install the page for a server that already runs elsewhere
  .\install.ps1 -Version v0.1.0          # install a specific immutable version
  .\install.ps1 -Update                  # pull the current tag again and recreate the container
  .\install.ps1 -Rollback previous       # go back to the previously deployed image
  .\install.ps1 -Rollback v0.1.0         # go back to a specific version

  Options: -Dir DIR  -Bind IP  -Port N  -ServerPort N  -AuthUser NAME  -AuthPasswordFile FILE
           -NoPull  -NoCheck  -Force  -Repo owner/name

  The token of the AI Watch server goes into secrets\monitor_key (a Docker secret) and nowhere else.
  An existing .env and existing secrets are never overwritten. A running deployment is left untouched
  unless you pass -Update, -Version, -Rollback or -Force.
#>
[CmdletBinding()]
param(
    [string]$Dir = '',
    [string]$Version = '',
    [string]$Rollback = '',
    [switch]$Update,
    [string]$Bind = '',
    [int]$Port = 0,
    [int]$ServerPort = 0,
    [string]$ServerUrl = '',
    [string]$TokenFile = '',
    [switch]$WithServer,
    [string]$AuthUser = '',
    [string]$AuthPasswordFile = '',
    [string]$Repo = $(if ($env:AI_WATCH_REPO) { $env:AI_WATCH_REPO } else { 'athegreat90/ai-watch-web' }),
    [switch]$NoPull,
    [switch]$NoCheck,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
if (-not $Dir) { $Dir = Split-Path -Parent $MyInvocation.MyCommand.Path }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

function Note([string]$Message) { Write-Host "==> $Message" }
function Fail([string]$Message) { [Console]::Error.WriteLine("error: $Message"); exit 1 }
# Optional queries: a failure must not abort the script (Windows PowerShell 5.1 turns native stderr into errors).
function Query-Docker { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & docker @args 2>$null } finally { $ErrorActionPreference = $old } }
function Invoke-Docker { & docker @args; if ($LASTEXITCODE -ne 0) { throw "docker $($args -join ' ') failed (exit $LASTEXITCODE)" } }

$tagPattern = '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'
$tokenPattern = '^[A-Za-z0-9._~+/=-]{24,}$'    # the same rule as the container's entrypoint
$urlPattern = '^http://[A-Za-z0-9._-]+(:[0-9]{1,5})?/?$'
$defaultUpstream = 'http://ai-watch-server:8765'

if ($Version -and $Version -ne 'latest' -and $Version -notmatch $tagPattern) { Fail "-Version must be 'latest' or vX.Y.Z" }
if ($Rollback -and $Rollback -ne 'previous' -and $Rollback -notmatch $tagPattern) { Fail "-Rollback needs 'previous' or vX.Y.Z" }
if ($Port -ne 0 -and ($Port -lt 1 -or $Port -gt 65535)) { Fail '-Port must be a number from 1 to 65535' }
if ($ServerPort -ne 0 -and ($ServerPort -lt 1 -or $ServerPort -gt 65535)) { Fail '-ServerPort must be a number from 1 to 65535' }
if ($ServerUrl -and $ServerUrl -notmatch $urlPattern) { Fail '-ServerUrl must look like http://host or http://host:port' }
if ($Bind -and $Bind -notmatch '^[0-9]{1,3}(\.[0-9]{1,3}){3}$') { Fail '-Bind must be an IPv4 address, for example 192.168.1.50' }
if ($AuthUser -and $AuthUser -notmatch '^[A-Za-z0-9._-]{1,32}$') { Fail "-AuthUser may only use letters, digits, '.', '_' and '-' (up to 32)" }
if ($AuthPasswordFile -and -not $AuthUser) { Fail '-AuthPasswordFile needs -AuthUser' }
if ($WithServer -and $ServerUrl) { Fail '-WithServer and -ServerUrl are different choices: pick one' }
if ($WithServer -and $TokenFile) { Fail '-WithServer creates the token itself; -TokenFile is for a server that already runs' }

$imageRepo = if ($env:AI_WATCH_IMAGE_REPO) { $env:AI_WATCH_IMAGE_REPO } else { "ghcr.io/$($Repo.ToLower())" }
$releaseApi = if ($env:AI_WATCH_RELEASE_API) { $env:AI_WATCH_RELEASE_API } else { "https://api.github.com/repos/$Repo" }
$releaseBase = if ($env:AI_WATCH_RELEASE_BASE) { $env:AI_WATCH_RELEASE_BASE } else { "https://github.com/$Repo/releases/download" }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker is not installed or not on PATH. Install Docker Desktop first.' }
& docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Fail "The Docker Compose plugin is required ('docker compose')." }
# "up --wait --wait-timeout" needs Compose 2.17 or newer.
$composeVersion = ((& docker compose version --short 2>$null) -replace '^v', '')
if ($composeVersion -match '^(\d+)\.(\d+)' -and ([int]$Matches[1] -lt 2 -or ([int]$Matches[1] -eq 2 -and [int]$Matches[2] -lt 17))) { Fail "Docker Compose $composeVersion is too old: version 2.17 or newer is needed." }
& docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'The Docker daemon is not reachable. Start Docker Desktop and retry.' }

# Download over HTTPS, or copy from a file:// URL. Throws on failure.
function Get-File([string]$Url, [string]$Destination) {
    if ($Url -like 'file://*') { Copy-Item -LiteralPath ([Uri]$Url).LocalPath -Destination $Destination -Force; return }
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
}

# Download a release asset and verify it against the release's SHA256SUMS. Returns $false if it cannot be fetched.
function Get-VerifiedAsset([string]$Tag, [string]$Asset, [string]$Destination) {
    $sums = [IO.Path]::GetTempFileName()
    try {
        Get-File "$releaseBase/$Tag/SHA256SUMS" $sums
        Get-File "$releaseBase/$Tag/$Asset" $Destination
    } catch { Remove-Item $sums, $Destination -Force -ErrorAction SilentlyContinue; return $false }
    $line = Get-Content $sums | Where-Object { $_ -match "^[0-9a-f]{64} [ *]?$([regex]::Escape($Asset))$" } | Select-Object -First 1
    Remove-Item $sums -Force
    $expected = if ($line) { $line.Substring(0, 64) } else { '' }
    $stream = [IO.File]::OpenRead($Destination)
    try { $actual = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($stream)) -replace "-", "").ToLower() } finally { $stream.Dispose() }
    if (-not $expected -or $actual -ne $expected) { Remove-Item $Destination -Force; Fail "checksum mismatch for ${Asset}: refusing to use it." }
    return $true
}

# Paths the user gave are relative to where the command was run, not to -Dir.
if ($TokenFile -and -not [IO.Path]::IsPathRooted($TokenFile)) { $TokenFile = Join-Path (Get-Location).Path $TokenFile }
if ($AuthPasswordFile -and -not [IO.Path]::IsPathRooted($AuthPasswordFile)) { $AuthPasswordFile = Join-Path (Get-Location).Path $AuthPasswordFile }
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Set-Location $Dir
if (-not (Test-Path compose.yaml)) {
    Note 'compose.yaml not found next to the installer; downloading the deployment bundle'
    $bundleTag = $Version
    if (-not $bundleTag -or $bundleTag -eq 'latest') {
        $tmp = [IO.Path]::GetTempFileName()
        try { Get-File "$releaseApi/releases/latest" $tmp } catch { Remove-Item $tmp -Force -ErrorAction SilentlyContinue; Fail 'could not query the latest release; pass -Version vX.Y.Z' }
        $bundleTag = ([regex]::Match((Get-Content $tmp -Raw), '"tag_name":\s*"([^"]+)"')).Groups[1].Value
        Remove-Item $tmp -Force
    }
    if (-not $bundleTag) { Fail 'could not determine the latest release; pass -Version vX.Y.Z' }
    if ($bundleTag -notmatch $tagPattern) { Fail "the release tag '$bundleTag' is not a version" }
    $zip = [IO.Path]::GetTempFileName() + '.zip'
    if (-not (Get-VerifiedAsset $bundleTag "ai-watch-web-deploy-$bundleTag.zip" $zip)) { Fail "could not download the deployment bundle for $bundleTag" }
    $extract = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $extract)
    Get-ChildItem (Join-Path $extract 'ai-watch-web-deploy') -Force | ForEach-Object {
        if (-not (Test-Path $_.Name)) { Copy-Item $_.FullName -Destination . -Recurse }
    }
    Remove-Item $zip, $extract -Recurse -Force
}

# ---- preflight: check every input that can be checked now, so a refused run leaves nothing behind
function Read-Token([string]$File) {
    if (-not (Test-Path -LiteralPath $File)) { Fail "token file '$File' not found" }
    $raw = (Get-Content -LiteralPath $File -Raw)
    if ($null -eq $raw) { return '' }
    if ($raw.TrimStart().StartsWith('{')) {
        try { $t = ($raw | ConvertFrom-Json).token } catch { $t = '' }
        if ($t) { return [string]$t } else { return '' }
    }
    return ($raw -replace '\s', '')
}
function Get-Existing([string]$Key) {
    if (-not (Test-Path .env)) { return '' }
    $m = Select-String -Path .env -Pattern "^$Key=(.*)$" | Select-Object -Last 1
    if ($m) { return $m.Matches[0].Groups[1].Value.Trim() } else { return '' }
}
$preFiles = Get-Existing COMPOSE_FILE; if (-not $preFiles) { $preFiles = 'compose.yaml' }
$preServer = (":${preFiles}:" -like '*:compose.server.yaml:*') -or [bool]$WithServer
$preAuth = (":${preFiles}:" -like '*:compose.auth.yaml:*')
if ($TokenFile -and $preServer) { Fail 'this deployment runs the server next to the page; -TokenFile does not apply' }
if ($preServer -and (Test-Path secrets\monitor_key) -and (Get-Item secrets\monitor_key).Length -gt 0) {
    if (-not (Test-Path server\config.local.json)) { Fail 'secrets/monitor_key exists (from another server) but server/config.local.json does not, so a new server would get a different token. Delete secrets/monitor_key, or put the server''s config.local.json in server/.' }
    if ((Read-Token 'server\config.local.json') -ne ((Get-Content secrets\monitor_key -Raw) -replace '\s', '')) { Fail 'secrets/monitor_key already holds a different token than server/config.local.json. Delete one of them.' }
}
if ($Rollback -eq 'previous') {
    $lastEntry = if (Test-Path .deploy-history) { Get-Content .deploy-history | Select-Object -Last 1 } else { '' }
    if (-not $lastEntry -or -not (($lastEntry -split ' ')[1])) { Fail 'no previous deployment recorded in .deploy-history; pass -Rollback vX.Y.Z' }
}
if (-not $preServer) {
    if ($TokenFile -and ((Read-Token $TokenFile) -notmatch $tokenPattern)) { Fail 'the token is missing or not valid (at least 24 of A-Z a-z 0-9 . _ ~ + / = -)' }
    if (-not $TokenFile -and -not ((Test-Path secrets\monitor_key) -and (Get-Item secrets\monitor_key).Length -gt 0)) { Fail 'no token yet: pass -TokenFile (a file with the AI Watch server''s token, or its config.local.json), or use -WithServer' }
    $preUrl = if ($ServerUrl) { $ServerUrl } else { Get-Existing UPSTREAM_URL }
    if (-not $preUrl -or $preUrl -eq $defaultUpstream) { Fail 'no server configured: pass -ServerUrl http://HOST:PORT, or use -WithServer' }
}
$password = ''
if ($AuthUser) {
    if ((Test-Path secrets\htpasswd) -and (Get-Item secrets\htpasswd).Length -gt 0) { Fail 'secrets/htpasswd already exists. Delete it to set a new login.' }
    if ($AuthPasswordFile) {
        if (-not (Test-Path -LiteralPath $AuthPasswordFile)) { Fail "password file '$AuthPasswordFile' not found" }
        $password = ((Get-Content -LiteralPath $AuthPasswordFile -TotalCount 1) -replace "`r", '')
    } elseif ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
        $first = Read-Host "Password for $AuthUser" -AsSecureString
        $again = Read-Host 'Repeat the password' -AsSecureString
        $p1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($first))
        $p2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($again))
        if ($p1 -ne $p2) { Fail 'the passwords differ' }
        $password = $p1
    } else { Fail 'there is no terminal to ask on: give the password with -AuthPasswordFile FILE' }
    if ($password.Length -lt 8) { Fail 'the password needs at least 8 characters' }
} elseif ($preAuth -and -not ((Test-Path secrets\htpasswd) -and (Get-Item secrets\htpasswd).Length -gt 0)) {
    Fail 'compose.auth.yaml is on but secrets/htpasswd is missing: run with -AuthUser NAME, or remove it from COMPOSE_FILE in .env'
}

$newEnv = $false
if (-not (Test-Path .env)) {
    $newEnv = $true
    if (Test-Path env.example) { Copy-Item env.example .env } else { New-Item .env -ItemType File | Out-Null }
}
function Get-EnvValue([string]$Key) {
    $m = Select-String -Path .env -Pattern "^$Key=(.*)$" | Select-Object -Last 1
    if ($m) { return $m.Matches[0].Groups[1].Value.Trim() } else { return '' }
}
function Set-EnvValue([string]$Key, [string]$Value) {
    $lines = @(Get-Content .env)
    if ($lines -match "^$Key=") { $lines = $lines -replace "^$Key=.*$", "$Key=$Value" } else { $lines += "$Key=$Value" }
    [IO.File]::WriteAllLines((Join-Path (Get-Location) '.env'), [string[]]$lines)   # UTF-8 without BOM, which Compose requires
}

# ---- which optional files are on (kept in .env as COMPOSE_FILE, so plain `docker compose` works too)
$files = Get-EnvValue COMPOSE_FILE; if (-not $files) { $files = 'compose.yaml' }
$serverOn = (":${files}:" -like '*:compose.server.yaml:*')
$authOn = (":${files}:" -like '*:compose.auth.yaml:*')
if ($WithServer -and -not $serverOn) { $files = "${files}:compose.server.yaml"; $serverOn = $true }
if ($ServerUrl -and $serverOn) { Fail 'this deployment runs the server next to the page (-WithServer); to use another server, edit COMPOSE_FILE and UPSTREAM_URL in .env' }
if ($AuthUser -and -not $authOn) { $files = "${files}:compose.auth.yaml"; $authOn = $true }

# ---- image: explicit intent only, an existing .env keeps its image unless a version flag was given
$history = '.deploy-history'
$explicit = $false
$target = ''
if ($Rollback) {
    if ($Rollback -eq 'previous') {
        $last = if (Test-Path $history) { Get-Content $history | Select-Object -Last 1 } else { '' }
        $target = if ($last) { ($last -split ' ')[1] } else { '' }
        if (-not $target) { Fail "no previous deployment recorded in $history; pass -Rollback vX.Y.Z" }
        # A tag can be moved: ":latest" after an update is another image. The recorded digest is what was running.
        $lastDigest = if ($last) { ($last -split ' ')[2] } else { '' }
        if ($target -like '*:latest' -and $lastDigest -and $lastDigest -ne 'unknown') { $target = $lastDigest }
    } else { $target = "${imageRepo}:$Rollback" }
    $explicit = $true
} elseif ($Version) { $target = "${imageRepo}:$Version"; $explicit = $true }

# ---- the token: only into secrets\monitor_key, never printed, never overwritten without a word
New-Item -ItemType Directory -Force -Path secrets | Out-Null
function Save-Token([string]$Token) {
    if ($Token -notmatch $tokenPattern) { Fail 'the token is missing or not valid (at least 24 of A-Z a-z 0-9 . _ ~ + / = -)' }
    $key = 'secrets\monitor_key'
    if ((Test-Path $key) -and (Get-Item $key).Length -gt 0) {
        if (((Get-Content $key -Raw) -replace '\s', '') -ne $Token) { Fail 'secrets/monitor_key already holds a different token. Delete it if you want to replace it.' }
    } else {
        [IO.File]::WriteAllText((Join-Path (Get-Location) $key), $Token)   # no newline, no BOM
        Note 'Saved the token in secrets/monitor_key'
    }
}
function Restrict-ToUser([string]$Path) { try { & icacls $Path /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" *> $null } catch { } }

# The web image is decided now, because the login hash below is made with it.
if ($target) { Set-EnvValue AI_WATCH_WEB_IMAGE $target }
elseif ($newEnv -or -not (Get-EnvValue AI_WATCH_WEB_IMAGE)) { Set-EnvValue AI_WATCH_WEB_IMAGE "${imageRepo}:latest" }

if ($serverOn) {
    if ($ServerPort -gt 0) { Set-EnvValue MONITOR_HOST_PORT "$ServerPort"; $explicit = $true }
    # Lets a test or a mirror choose the server image without editing .env by hand.
    if ($env:AI_WATCH_SERVER_IMAGE) { Set-EnvValue AI_WATCH_SERVER_IMAGE $env:AI_WATCH_SERVER_IMAGE }
}
$serverImage = Get-EnvValue AI_WATCH_SERVER_IMAGE; if (-not $serverImage) { $serverImage = 'ghcr.io/athegreat90/ai-watch-server:latest' }

if ($serverOn) {
    New-Item -ItemType Directory -Force -Path server | Out-Null
    if (-not (Test-Path server\config.local.json)) {
        Note "Generating server/config.local.json with a new random token (the server image's own init-config)"
        Invoke-Docker run --rm --entrypoint /app/ai-watch-server -v "$((Get-Location).Path)\server:/cfg" $serverImage init-config --config /cfg/config.local.json
        Restrict-ToUser 'server'
    } else { Note 'Keeping the existing server/config.local.json and its token' }
    Save-Token (Read-Token 'server\config.local.json')
    Set-EnvValue UPSTREAM_URL $defaultUpstream
} else {
    if ($ServerUrl) { Set-EnvValue UPSTREAM_URL $ServerUrl; $explicit = $true }
    if ($TokenFile) { Save-Token (Read-Token $TokenFile); $explicit = $true }
    if (-not ((Test-Path secrets\monitor_key) -and (Get-Item secrets\monitor_key).Length -gt 0)) { Fail 'no token yet: pass -TokenFile (a file with the AI Watch server''s token, or its config.local.json), or use -WithServer' }
    if ((Get-EnvValue UPSTREAM_URL) -eq $defaultUpstream) { Fail 'no server configured: pass -ServerUrl http://HOST:PORT, or use -WithServer' }
}
Restrict-ToUser 'secrets'
$upstream = Get-EnvValue UPSTREAM_URL

# ---- the optional login
if ($AuthUser) {
    # Salted SHA-512 made by the image itself (BusyBox cryptpw), so no extra tool is needed. The password goes in
    # through standard input, with no newline, and never appears on a command line.
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = 'docker'
    $psi.Arguments = "run --rm -i --entrypoint sh $(Get-EnvValue AI_WATCH_WEB_IMAGE) -c `"cryptpw -m sha512 -P 0`""
    $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false
    $proc = [Diagnostics.Process]::Start($psi)
    # UTF-8 bytes, not the console code page, so a non-ASCII password hashes the same way the browser sends it.
    $pwBytes = [Text.Encoding]::UTF8.GetBytes($password)
    $proc.StandardInput.BaseStream.Write($pwBytes, 0, $pwBytes.Length); $proc.StandardInput.Close()
    $hash = $proc.StandardOutput.ReadToEnd().Trim(); [void]$proc.StandardError.ReadToEnd(); $proc.WaitForExit()
    if (-not $hash.StartsWith('$6$')) { Fail 'could not create the password hash (is the web image available?)' }
    [IO.File]::WriteAllText((Join-Path (Get-Location) 'secrets\htpasswd'), "${AuthUser}:$hash`n")
    Note "Saved the login of '$AuthUser' in secrets/htpasswd (a salted hash, not the password)"
    $explicit = $true
} elseif ($authOn -and -not ((Test-Path secrets\htpasswd) -and (Get-Item secrets\htpasswd).Length -gt 0)) {
    Fail 'compose.auth.yaml is on but secrets/htpasswd is missing: run with -AuthUser NAME, or remove it from COMPOSE_FILE in .env'
}

# ---- the remaining choices
if ($Bind) { Set-EnvValue WEB_HOST_BIND $Bind; $explicit = $true }
if ($Port -gt 0) { Set-EnvValue WEB_HOST_PORT "$Port"; $explicit = $true }
if ($files -ne 'compose.yaml') { Set-EnvValue COMPOSE_FILE $files; Set-EnvValue COMPOSE_PATH_SEPARATOR ':' }
if ($WithServer) { $explicit = $true }
$image = Get-EnvValue AI_WATCH_WEB_IMAGE
$hostBind = Get-EnvValue WEB_HOST_BIND; if (-not $hostBind) { $hostBind = '127.0.0.1' }
$hostPort = Get-EnvValue WEB_HOST_PORT; if (-not $hostPort) { $hostPort = '8080' }
$checkHost = if ($hostBind -eq '0.0.0.0') { '127.0.0.1' } else { $hostBind }

$running = (Query-Docker compose ps -q web | Select-Object -First 1)
if ($running -and -not $Update -and -not $explicit -and -not $Force) {
    Note 'AI Watch Web is already running; leaving it untouched (use -Update, -Version or -Rollback to change it).'
} else {
    if ($running) {
        $prevRef = (& docker inspect --format '{{.Config.Image}}' $running)
        $prevId = (& docker inspect --format '{{.Image}}' $running)
        $prevDigest = (Query-Docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' $prevId)
        if (-not $prevDigest) { $prevDigest = 'unknown' }
    }
    if (-not $NoPull) { Note "Pulling $image"; Invoke-Docker compose pull }
    Note 'Starting the containers'
    $up = @('compose', 'up', '-d', '--wait', '--wait-timeout', '90'); if ($Force) { $up += '--force-recreate' }
    & docker @up
    if ($LASTEXITCODE -ne 0) { & docker compose logs --tail 30; Fail 'the containers did not become healthy' }
    # Only a real change goes into the history: a rerun or an -Update with nothing new would otherwise make
    # "-Rollback" return to the image that is already running.
    if ($running) {
        $newCid = (& docker compose ps -q web | Select-Object -First 1)
        if ((& docker inspect --format '{{.Config.Image}}' $newCid) -ne $prevRef -or (& docker inspect --format '{{.Image}}' $newCid) -ne $prevId) {
            Add-Content -Path $history -Value "$([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')) $prevRef $prevDigest"
        }
    }
}

Note "Waiting for the page on ${checkHost}:$hostPort"
$healthy = $false
for ($i = 0; $i -lt 30 -and -not $healthy; $i++) {
    try { $healthy = (Invoke-WebRequest -UseBasicParsing -Uri "http://${checkHost}:$hostPort/healthz" -TimeoutSec 2).StatusCode -eq 200 } catch { Start-Sleep -Seconds 1 }
}
if (-not $healthy) { Fail "http://${checkHost}:$hostPort/healthz did not answer" }

$cid = (& docker compose ps -q web | Select-Object -First 1)
$imageId = (& docker inspect --format '{{.Image}}' $cid)
$resolvedVersion = (Query-Docker image inspect --format '{{index .Config.Labels `org.opencontainers.image.version`}}' $imageId)
$resolvedDigest = (Query-Docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' $imageId)

# The status code of a URL, and the header the page adds when the server itself said 401. Works in 5.1 and 7.
function Get-Status([string]$Url, [hashtable]$Headers) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers $Headers -TimeoutSec 5
        return [pscustomobject]@{ Code = [int]$r.StatusCode; Upstream = '' }
    } catch {
        $resp = $_.Exception.Response
        if (-not $resp) { return [pscustomobject]@{ Code = 0; Upstream = '' } }
        $up = ''
        try { $v = $resp.Headers['X-AIW-Upstream-Status']; if ($v) { $up = [string]$v } } catch { }
        if (-not $up) { try { $vals = $null; if ($resp.Headers.TryGetValues('X-AIW-Upstream-Status', [ref]$vals)) { $up = ($vals -join '') } } catch { } }
        return [pscustomobject]@{ Code = [int]$resp.StatusCode; Upstream = $up }
    }
}

if (-not $NoCheck) {
    if ($authOn -and -not $password) {
        Note 'A login is on and its password is not known to this run: skipping the server check (run it again with -AuthUser to be asked, or open the page)'
    } else {
        Note "Checking that the page reaches the AI Watch server at $upstream"
        $headers = @{}
        if ($password) { $headers['Authorization'] = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${AuthUser}:$password")) }
        $status = $null
        for ($i = 0; $i -lt 12; $i++) {
            $status = Get-Status "http://${checkHost}:$hostPort/api/status" $headers
            if ($status.Code -notin 0, 502, 504) { break }
            Start-Sleep -Seconds 2
        }
        switch ($status.Code) {
            200 { Note 'OK: the server answered and accepted the token.' }
            401 {
                if ($status.Upstream -eq '401') { Fail 'the AI Watch server refused the token in secrets/monitor_key. Use the token of that server (-TokenFile) after deleting the old file.' }
                else { Fail 'the page asked for a login and the one given was refused' }
            }
            { $_ -in 0, 502, 504 } { Fail "the page cannot reach the AI Watch server at $upstream. Check that the server runs and listens on an address the container can reach (a container cannot use the 127.0.0.1 of this machine). Use -WithServer to run it next to the page." }
            default { Fail "unexpected answer $($status.Code) from /api/status" }
        }
    }
}

if (-not $resolvedVersion) { $resolvedVersion = 'unknown' }
if (-not $resolvedDigest) { $resolvedDigest = 'not available (local image)' }
Write-Host @"

AI Watch Web is running.
  requested image : $image
  deployed version: $resolvedVersion
  image digest    : $resolvedDigest
  page            : http://${hostBind}:$hostPort
  server          : $upstream   (token: $((Get-Location).Path)\secrets\monitor_key)
  update          : .\install.ps1 -Update       roll back: .\install.ps1 -Rollback previous
"@
if ($hostBind -eq '127.0.0.1') { Write-Host "  Note: the page listens on this machine only. For other devices run: .\install.ps1 -Bind <this PC's LAN IP> -AuthUser NAME" }
elseif (-not $authOn) { Write-Host "  WARNING: the page is reachable from the network and has no login. Add one with -AuthUser NAME, or read 'Remote access' in README.md." }
