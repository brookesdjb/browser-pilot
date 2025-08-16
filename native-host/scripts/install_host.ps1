# Browser Pilot Native Messaging Host Installer for Windows
# This script installs the native messaging host for the Browser Pilot Chrome extension
# Requires PowerShell 3.0 or higher

# Ensure script is running with administrator privileges
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Warning "Please run this script as Administrator"
    exit 1
}

# Configuration
$ExtensionId = "EXTENSION_ID_PLACEHOLDER" # Will be replaced during packaging
$HostName = "com.brookesdjb.browser_pilot"
$AppName = "Browser Pilot"

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ParentDir = Split-Path -Parent $ScriptDir

# Define paths
$InstallDir = Join-Path $env:LOCALAPPDATA "BrowserPilot"
$HostExePath = Join-Path $InstallDir "browser-pilot-host.exe" # For packaged executable
$HostJsPath = Join-Path $InstallDir "browser-pilot-host.js" # For Node.js version
$ManifestTemplate = Join-Path $ParentDir "manifests" "$HostName.json"

# Create installation directory
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Write-Host "Created installation directory: $InstallDir"

# Check if we're using packaged executable or Node.js
$IsNodeVersion = $false
$HostSourcePath = Join-Path $ParentDir "dist" "index.js"

if (Test-Path $HostSourcePath) {
    # Node.js version
    $IsNodeVersion = $true
    $HostFinalPath = $HostJsPath
    
    # For Node.js, we need a wrapper batch file
    $BatchPath = Join-Path $InstallDir "browser-pilot-host.bat"
    $NodeExe = "node.exe"
    
    # Create batch file to launch Node.js script
    @"
@echo off
"$NodeExe" "$HostJsPath" %*
"@ | Out-File -FilePath $BatchPath -Encoding ascii
    
    # Copy Node.js script
    Copy-Item -Path $HostSourcePath -Destination $HostFinalPath -Force
    Write-Host "Installed Node.js host script to $HostFinalPath"
    
    # Update host path for manifest to use batch file
    $HostPathForManifest = $BatchPath
} else {
    # Packaged executable
    $HostExeSource = Join-Path $ParentDir "dist" "browser-pilot-host.exe"
    
    if (-Not (Test-Path $HostExeSource)) {
        Write-Error "Could not find host executable at $HostExeSource"
        exit 1
    }
    
    # Copy executable
    Copy-Item -Path $HostExeSource -Destination $HostExePath -Force
    Write-Host "Installed host executable to $HostExePath"
    
    # Update host path for manifest
    $HostPathForManifest = $HostExePath
}

# Load manifest template
if (-Not (Test-Path $ManifestTemplate)) {
    Write-Error "Could not find manifest template at $ManifestTemplate"
    exit 1
}

$Manifest = Get-Content $ManifestTemplate | ConvertFrom-Json

# Update manifest properties
$Manifest.path = $HostPathForManifest
$Manifest.allowed_origins = @("chrome-extension://$ExtensionId/")

# Convert to JSON
$ManifestJson = $Manifest | ConvertTo-Json

# Register in Windows Registry
$RegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"

# Create registry key
if (-Not (Test-Path $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
}

# Create temporary manifest file
$TempManifestPath = Join-Path $InstallDir "$HostName.json"
$ManifestJson | Out-File -FilePath $TempManifestPath -Encoding utf8

# Set registry default value to manifest path
Set-ItemProperty -Path $RegistryPath -Name "(Default)" -Value $TempManifestPath
Write-Host "Registered native messaging host in Windows Registry"

# Verify installation
if ((Test-Path $HostPathForManifest) -and (Test-Path $TempManifestPath) -and (Test-Path $RegistryPath)) {
    Write-Host "Installation successful!" -ForegroundColor Green
    Write-Host "Native messaging host installed at: $HostPathForManifest"
    Write-Host "Manifest installed at: $TempManifestPath"
    Write-Host "Registered in registry at: $RegistryPath"
} else {
    Write-Error "Installation failed. Please check the logs above."
    exit 1
}

exit 0