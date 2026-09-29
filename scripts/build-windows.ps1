$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
function Run-Step([string]$program, [string[]]$arguments) {
    & $program @arguments
    if ($LASTEXITCODE -ne 0) { throw "$program failed (exit $LASTEXITCODE)" }
}
if (!(Test-Path '.venv\Scripts\python.exe')) { Run-Step 'py' @('-3.11','-m','venv','.venv') }
$python = (Resolve-Path '.venv\Scripts\python.exe').Path
Run-Step $python @('-m','pip','install','--upgrade','pip')
Run-Step $python @('-m','pip','install','torch','torchaudio','--index-url','https://download.pytorch.org/whl/cpu')
Run-Step $python @('-m','pip','install','-r','companion/requirements.txt','pyinstaller','pip-licenses')
Run-Step $python @('-c','import numpy,torch,demucs.separate,uvicorn; print("Engine imports OK")')
Run-Step $python @('-m','piplicenses','--with-license-file','--format=plain-vertical','--output-file=THIRD-PARTY-NOTICES.txt')
Run-Step $python @('-m','PyInstaller','--noconfirm','--clean','--onedir','--name','open-wave-engine','--distpath','runtime','--paths','.', '--collect-all','demucs','--collect-all','torch','--collect-all','torchaudio','--collect-all','sphn','--collect-all','numpy','--collect-all','uvicorn','--collect-all','multipart','--copy-metadata','demucs','companion/entry.py')
Run-Step 'runtime\open-wave-engine\open-wave-engine.exe' @('--demucs','--help')
Run-Step 'npm.cmd' @('ci')
Run-Step 'npm.cmd' @('run','dist:win')
Write-Host 'Installer generated in release/. Test it on a clean Windows 10/11 x64 computer before sharing.'
