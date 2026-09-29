# Open Wave Desktop — Windows build project

This repository contains the desktop application source and Windows installer build scripts.
It does **not** contain a prebuilt or signed Windows installer. Windows packaging and
real Demucs inference have not yet been verified on a clean Windows system.

## Build the installer

1. Install 64-bit Python 3.11 and Node.js 22 LTS with npm on Windows.
2. Clone or download this repository.
3. Double-click `Build-Windows-Installer.bat`. Internet is required for dependencies.
4. When successful, the `release` folder contains `Open-Wave-0.1.0-Windows-x64-Setup.exe`.
5. Test that EXE on a clean Windows 10/11 x64 computer before sharing it.

You can also open **Actions**, select **Build Windows installer**, and choose **Run workflow**.
Download the installer artifact after the workflow completes. The workflow still needs
its first successful Windows run.

The build bundles Electron, Python, and CPU PyTorch/Demucs. Recipients do not need
Python, Node, pip, or terminal commands. The first separation downloads the model
into the user's application data folder; subsequent separation can run offline.
Initial builds are unsigned and may trigger Windows SmartScreen warnings.

## Implemented

- Desktop multitrack editor, mixer, synth, beat maker, and effects
- On-device Demucs stem separation with progress and cancellation
- Native project Save/Open dialogs with embedded audio
- Per-user model cache retained across restarts
- No account, paid API, cloud storage, or remote inference

## Release checks still required

Test installation, microphone permission, import/play/export, project saving,
clip editing, synth controls, model download, two/four-stem separation,
cancellation, cached offline separation, and uninstall on Windows 10/11.
Review dependency and model licenses before public redistribution.

## Development

Create a Python 3.11 virtual environment, install `companion/requirements.txt`,
then run `npm ci` and `npm start`. Never expose the companion service to a
public network; the desktop app supplies a per-session token.

Existing saved sessions remain compatible. The legacy IndexedDB name and
`.pulse.json` extension are retained for project compatibility.

Website: https://openwavestudio.com
