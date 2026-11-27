<#
.SYNOPSIS
  Tests deploy\ai-watch-web-deploy\install.ps1 against real Docker, in Windows PowerShell 5.1 and/or PowerShell 7.
  It covers what is specific to PowerShell (the login hash through standard input, reading an HTTP status in both
  versions, the file:// download); the behaviour shared with install.sh is tested in test_install.sh.
  Needs Docker Desktop, curl, and Git Bash (for release\assets.sh).
  The web image must exist as $env:AIW_TEST_IMAGE_REPO:$env:AIW_TEST_VERSION (default ai-watch-web:v0.0.1).
.EXAMPLE
  .\deploy\test_install.ps1                 # every PowerShell found
  .\deploy\test_install.ps1 -Shell powershell
#>
param([ValidateSet('all', 'powershell', 'pwsh')][string]$Shell = 'all')
# Windows PowerShell 5.1 turns the stderr of a native command (docker saying "No such image") into an exception
# under 'Stop'. The assertions below throw their own errors, so a native failure is not enough to stop.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$bundle = Join-Path $here 'ai-watch-web-deploy'
$repo = if ($env:AIW_TEST_IMAGE_REPO) { $env:AIW_TEST_IMAGE_REPO } else { 'ai-watch-web' }
$v1 = if ($env:AIW_TEST_VERSION) { $env:AIW_TEST_VERSION } else { 'v0.0.1' }
$v2 = 'v0.0.2'
$srv = 'ghcr.io/athegreat90/ai-watch-server:v1.1.4@sha256:26c92877901a03e8333ea72f31ec1fd7f18fc69f5b3a3068eeac9b153e78c9bd'
$password = 'correct horse battery'

function Stop-Test([string]$Message) { throw "FAIL: $Message" }
& docker image inspect "$repo`:$v1" *> $null
if ($LASTEXITCODE -ne 0) { Stop-Test "the image $repo`:$v1 does not exist: build it first" }
& docker image inspect $srv *> $null
if ($LASTEXITCODE -ne 0) { & docker pull -q $srv | Out-Null }

$work = Join-Path ([IO.Path]::GetTempPath()) ("aiw-ps-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$script:dirs = @(); $script:containers = @(); $script:madeTags = @(); $script:counter = 0

function Cleanup {
    foreach ($d in $script:dirs) {
        Push-Location $d.Dir -ErrorAction SilentlyContinue
        $env:COMPOSE_PROJECT_NAME = $d.Proj; & docker compose down -v *> $null; Pop-Location -ErrorAction SilentlyContinue
    }
    foreach ($c in $script:containers) { & docker rm -f $c *> $null }
    foreach ($t in $script:madeTags) { & docker rmi $t *> $null }
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

function Tag-IfMissing([string]$Name) {
    & docker image inspect $Name *> $null
    if ($LASTEXITCODE -ne 0) { & docker tag "$repo`:$v1" $Name; $script:madeTags += $Name }
}
function Free-Port { $l = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $l.Start(); $p = $l.LocalEndpoint.Port; $l.Stop(); $p }
function New-Dir {
    $script:counter++
    $cur = Join-Path $work "d$($script:counter)"; $proj = "aiw-ptest-$PID-$($script:counter)"
    New-Item -ItemType Directory -Path $cur | Out-Null
    Copy-Item (Join-Path $bundle '*') $cur -Recurse -Force
    $script:dirs += [pscustomobject]@{ Dir = $cur; Proj = $proj }
    $script:cur = $cur; $script:proj = $proj
}
# Run the installer in a child process: its Fail() calls exit.
function Inst([string[]]$InstallArgs) {
    $env:COMPOSE_PROJECT_NAME = $script:proj; $env:AI_WATCH_IMAGE_REPO = $repo; $env:AI_WATCH_SERVER_IMAGE = $srv
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    Push-Location $script:cur
    try { $script:out = (& $script:exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $script:cur 'install.ps1') @InstallArgs 2>&1 | Out-String); $script:rc = $LASTEXITCODE }
    finally { Pop-Location; $ErrorActionPreference = $old }
}
function Mention([string]$Text, [string]$What) { if (-not $script:out.Contains($Text)) { Write-Host $script:out; Stop-Test "$What (expected '$Text' in the output)" } }
function Refused([string]$What, [string]$Text) { if ($script:rc -eq 0) { Write-Host $script:out; Stop-Test "${What}: it was accepted" }; Mention $Text $What }
function Code([string]$Url, [string]$User = '') {
    $a = @('-s', '-o', 'NUL', '-m', '10', '-w', '%{http_code}'); if ($User) { $a += @('-u', $User) }
    & curl.exe @a $Url
}
function Cid { Push-Location $script:cur; $env:COMPOSE_PROJECT_NAME = $script:proj; $c = (& docker compose ps -q web | Select-Object -First 1); Pop-Location; $c }
function Hashes {
    # .NET directly: Get-FileHash is missing in a session started from another shell with a different PSModulePath.
    ($args | ForEach-Object {
        $s = [IO.File]::OpenRead($_)
        try { [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($s)) } finally { $s.Dispose() }
    }) -join ' '
}

function Run-Suite([string]$Exe) {
    $script:exe = $Exe
    Write-Host "== $Exe"
    Tag-IfMissing "$repo`:$v2"; Tag-IfMissing "$repo`:latest"

    Write-Host '1. fresh install with the server and a login'
    New-Dir; $web = Free-Port; $sp = Free-Port
    [IO.File]::WriteAllText((Join-Path $script:cur 'pw.txt'), $password)
    Inst @('-Version', $v1, '-NoPull', '-WithServer', '-Port', $web, '-ServerPort', $sp, '-AuthUser', 'bob', '-AuthPasswordFile', 'pw.txt')
    if ($script:rc -ne 0) { Write-Host $script:out; Stop-Test 'the install failed' }
    Mention 'the server answered and accepted the token' 'the end-to-end check did not run'
    $token = (Get-Content (Join-Path $script:cur 'server\config.local.json') -Raw | ConvertFrom-Json).token
    if ((Get-Content (Join-Path $script:cur 'secrets\monitor_key') -Raw) -ne $token) { Stop-Test 'the secret is not the server token' }
    $base = "http://127.0.0.1:$web"
    if ((Code "$base/") -ne '401') { Stop-Test 'the page is open without a login' }
    if ((Code "$base/healthz") -ne '200') { Stop-Test 'healthz must stay open' }
    if ((Code "$base/" 'bob:wrong') -ne '401') { Stop-Test 'a wrong password was accepted' }
    # A stray carriage return in the hashed password would make the right one fail.
    if ((Code "$base/" "bob:$password") -ne '200') { Stop-Test 'the right password was refused (is a newline in the hash?)' }
    if ((Code "$base/api/status" "bob:$password") -ne '200') { Stop-Test 'the page does not reach the server' }
    if ((Get-Content (Join-Path $script:cur 'secrets\htpasswd') -Raw) -notmatch '^bob:\$6\$') { Stop-Test 'the login is not a salted SHA-512 hash' }
    if ((Get-Content (Join-Path $script:cur 'secrets\htpasswd') -Raw).Contains($password)) { Stop-Test 'the password is in clear text' }
    if ($script:out.Contains($token)) { Stop-Test 'the token was printed' }
    if ((Get-Content (Join-Path $script:cur '.env') -Raw).Contains($token)) { Stop-Test 'the token is in .env' }
    if ((Get-Content (Join-Path $script:cur '.env') -Raw) -notmatch 'COMPOSE_FILE=compose.yaml:compose.server.yaml:compose.auth.yaml') { Stop-Test 'COMPOSE_FILE does not list the optional files' }
    $bytes = [IO.File]::ReadAllBytes((Join-Path $script:cur '.env'))
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { Stop-Test '.env has a BOM, which Compose refuses' }

    Write-Host '2. a rerun leaves it alone'
    $first = Cid; $before = Hashes (Join-Path $script:cur '.env') (Join-Path $script:cur 'secrets\monitor_key') (Join-Path $script:cur 'secrets\htpasswd')
    Inst @('-NoPull')
    if ($script:rc -ne 0) { Write-Host $script:out; Stop-Test 'the rerun failed' }
    Mention 'already running; leaving it untouched' 'the rerun touched the deployment'
    if ((Cid) -ne $first) { Stop-Test 'the container was recreated' }
    if ((Hashes (Join-Path $script:cur '.env') (Join-Path $script:cur 'secrets\monitor_key') (Join-Path $script:cur 'secrets\htpasswd')) -ne $before) { Stop-Test 'a rerun changed a setting or a secret' }

    Write-Host '3. update, force, version and rollback'
    Inst @('-Update', '-Force', '-NoPull')
    if ($script:rc -ne 0) { Write-Host $script:out; Stop-Test '-Update -Force failed' }
    if ((Cid) -eq $first) { Stop-Test '-Force did not recreate the container' }
    # Nothing changed (same image, same configuration), so nothing is history: a rollback must never return to what runs.
    $hist = Join-Path $script:cur '.deploy-history'
    if ((Test-Path $hist) -and (Get-Item $hist).Length -gt 0) { Stop-Test 'an update with nothing new was recorded in the history' }
    Inst @('-Version', $v2, '-NoPull')
    if ($script:rc -ne 0) { Write-Host $script:out; Stop-Test '-Version failed' }
    if (-not (Select-String -Path $hist -Pattern "^\d{4}-\d{2}-\d{2}T[\d:]+Z $repo`:$v1 ")) { Stop-Test 'the history line is missing or malformed' }
    if ((Get-Content (Join-Path $script:cur '.env')) -notcontains "AI_WATCH_WEB_IMAGE=$repo`:$v2") { Stop-Test "the image is not $v2" }
    Inst @('-Rollback', 'previous', '-NoPull')
    if ($script:rc -ne 0) { Write-Host $script:out; Stop-Test '-Rollback failed' }
    if ((Get-Content (Join-Path $script:cur '.env')) -notcontains "AI_WATCH_WEB_IMAGE=$repo`:$v1") { Stop-Test "-Rollback did not return to $v1" }

    Write-Host '4. nothing is overwritten'
    [IO.File]::WriteAllText((Join-Path $script:cur 'secrets\monitor_key'), 'Zz9zZ9zZ9zZ9zZ9zZ9zZ9zZ9zZ9zZ9')
    Inst @('-WithServer', '-NoPull')
    Refused 'a key that differs from the server token' 'already holds a different token'
    [IO.File]::WriteAllText((Join-Path $script:cur 'secrets\monitor_key'), $token)
    Inst @('-AuthUser', 'alice', '-AuthPasswordFile', 'pw.txt', '-NoPull')
    Refused 'a second login' 'secrets/htpasswd already exists'

    Write-Host '5. an external server: the token from a config file, a wrong token, an unreachable server'
    $srvdir = Join-Path $work "srv$PID"; New-Item -ItemType Directory -Path $srvdir -Force | Out-Null
    & docker run --rm --entrypoint /app/ai-watch-server -v "${srvdir}:/cfg" $srv init-config --config /cfg/config.local.json | Out-Null
    $name = "aiw-ptest-srv-$PID"; $script:containers += $name
    & docker run -d --name $name -p 0.0.0.0::8765 -e MONITOR_BIND=0.0.0.0 --read-only --tmpfs /tmp:size=16m --cap-drop ALL -v "${srvdir}\config.local.json:/app/config.local.json:ro" $srv | Out-Null
    $extPort = ((& docker port $name 8765/tcp | Select-Object -First 1) -split ':')[-1]
    for ($i = 0; $i -lt 30; $i++) { if ((Code "http://127.0.0.1:$extPort/health") -eq '200') { break }; Start-Sleep -Seconds 1 }
    $ext = "http://host.docker.internal:$extPort"
    New-Dir; $p = Free-Port
    Inst @('-Version', $v1, '-NoPull', '-ServerUrl', $ext, '-TokenFile', (Join-Path $srvdir 'config.local.json'), '-Port', $p)
    if ($script:rc -ne 0) { Write-Host $script:out; Stop-Test 'the external server install failed' }
    Mention 'the server answered and accepted the token' 'the check did not run'
    New-Dir; $p = Free-Port
    [IO.File]::WriteAllText((Join-Path $script:cur 'wrong.txt'), 'abcdefghijklmnopqrstuvwxyz012345')
    Inst @('-Version', $v1, '-NoPull', '-ServerUrl', $ext, '-TokenFile', 'wrong.txt', '-Port', $p)
    Refused 'a token the server does not know' 'refused the token'
    New-Dir; $p = Free-Port
    [IO.File]::WriteAllText((Join-Path $script:cur 't.txt'), 'abcdefghijklmnopqrstuvwxyz012345')
    Inst @('-Version', $v1, '-NoPull', '-ServerUrl', 'http://host.docker.internal:1', '-TokenFile', 't.txt', '-Port', $p)
    Refused 'an unreachable server' 'cannot reach the AI Watch server'

    Write-Host '6. wrong input is refused'
    New-Dir
    Inst @(); Refused 'no flags on a new folder' 'no token yet'
    Inst @('-Version', '1.2'); Refused 'a bad version' '-Version must be'
    Inst @('-WithServer', '-ServerUrl', 'http://h:1'); Refused 'both choices' 'different choices'
    Inst @('-Rollback', 'previous'); Refused 'a rollback with no history' 'no previous deployment'

    Write-Host '7. the installer alone downloads the bundle over file:// and refuses a tampered one'
    $results = Join-Path $work 'results'; New-Item -ItemType Directory -Path $results -Force | Out-Null
    '{"bomFormat":"CycloneDX"}' | Set-Content (Join-Path $results 'sbom-amd64.cdx.json'); Copy-Item (Join-Path $results 'sbom-amd64.cdx.json') (Join-Path $results 'sbom-arm64.cdx.json')
    $dist = Join-Path $work 'dist'
    $env:RELEASE_TAG = 'v0.0.1'; $env:ASSETS_DIR = ($dist -replace '\\', '/'); $env:RESULTS_DIR = ($results -replace '\\', '/')
    Push-Location $root; & bash release/assets.sh *> $null; $assetsRc = $LASTEXITCODE; Pop-Location
    Remove-Item Env:RELEASE_TAG, Env:ASSETS_DIR, Env:RESULTS_DIR
    if ($assetsRc -ne 0) { Stop-Test 'release/assets.sh failed' }
    $rel = Join-Path $work 'rel\v0.0.1'; New-Item -ItemType Directory -Path $rel -Force | Out-Null
    Copy-Item (Join-Path $dist '*') $rel
    New-Item -ItemType Directory -Path (Join-Path $work 'rel\api\releases') -Force | Out-Null
    '{"tag_name": "v0.0.1"}' | Set-Content (Join-Path $work 'rel\api\releases\latest')
    $env:AI_WATCH_RELEASE_BASE = ([Uri](Join-Path $work 'rel')).AbsoluteUri
    $env:AI_WATCH_RELEASE_API = ([Uri](Join-Path $work 'rel\api')).AbsoluteUri
    New-Dir; Remove-Item (Join-Path $script:cur '*') -Recurse -Force; Copy-Item (Join-Path $bundle 'install.ps1') $script:cur
    Inst @('-NoPull', '-WithServer', '-Port', (Free-Port), '-ServerPort', (Free-Port))
    if ($script:rc -ne 0) { Write-Host $script:out; Stop-Test 'the installer alone could not install' }
    Mention 'downloading the deployment bundle' 'it did not download the bundle'
    if (-not (Test-Path (Join-Path $script:cur 'compose.server.yaml'))) { Stop-Test 'the bundle was not extracted' }
    [IO.File]::AppendAllText((Join-Path $rel 'ai-watch-web-deploy-v0.0.1.zip'), 'tampered')
    New-Dir; Remove-Item (Join-Path $script:cur '*') -Recurse -Force; Copy-Item (Join-Path $bundle 'install.ps1') $script:cur
    Inst @('-NoPull', '-WithServer', '-Version', 'v0.0.1')
    Refused 'a tampered bundle' 'checksum mismatch'
    if (Test-Path (Join-Path $script:cur 'compose.yaml')) { Stop-Test 'a bundle that failed its checksum was extracted' }
    Remove-Item Env:AI_WATCH_RELEASE_BASE, Env:AI_WATCH_RELEASE_API
}

$failed = $false
try {
    $exes = @()
    if ($Shell -in 'all', 'powershell') { if (Get-Command powershell.exe -ErrorAction SilentlyContinue) { $exes += 'powershell.exe' } }
    if ($Shell -in 'all', 'pwsh') { if (Get-Command pwsh -ErrorAction SilentlyContinue) { $exes += 'pwsh' } }
    if (-not $exes) { Stop-Test 'no PowerShell found to test' }
    foreach ($e in $exes) { Run-Suite $e }
    Write-Host 'deploy (PowerShell): ok'
} catch {
    # With ErrorActionPreference 'Continue' a thrown assertion would otherwise still end with exit code 0.
    [Console]::Error.WriteLine("$_")
    $failed = $true
} finally { Cleanup }
if ($failed) { exit 1 }
