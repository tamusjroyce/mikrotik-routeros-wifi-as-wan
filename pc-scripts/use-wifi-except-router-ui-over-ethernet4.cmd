@echo off
setlocal EnableExtensions

rem Configure Windows routing so normal internet traffic uses Wi-Fi,
rem while 192.168.88.1, including http://192.168.88.1, uses Ethernet 4.
rem Run this script as Administrator.

set "WIFI_ALIAS=Wi-Fi"
set "ETH_ALIAS=Ethernet 4"
set "ROUTER_IP=192.168.88.1"
set "WIFI_METRIC=5"
set "ETH_METRIC=50"

net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo This script must be run as Administrator.
    echo Right-click it and choose "Run as administrator".
    exit /b 1
)

echo.
echo Configuring adapter metrics...
netsh interface ipv4 set interface name="%WIFI_ALIAS%" metric=%WIFI_METRIC% >nul
if errorlevel 1 (
    echo Failed to set metric for "%WIFI_ALIAS%".
    echo Check the Wi-Fi adapter name with: netsh interface ipv4 show interfaces
    exit /b 1
)

netsh interface ipv4 set interface name="%ETH_ALIAS%" metric=%ETH_METRIC% >nul
if errorlevel 1 (
    echo Failed to set metric for "%ETH_ALIAS%".
    echo Check the Ethernet adapter name with: netsh interface ipv4 show interfaces
    exit /b 1
)

echo Finding interface index for "%ETH_ALIAS%"...
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-NetAdapter -Name '%ETH_ALIAS%' -ErrorAction Stop).ifIndex"`) do set "ETH_IFINDEX=%%I"

if not defined ETH_IFINDEX (
    echo Could not find interface index for "%ETH_ALIAS%".
    exit /b 1
)

echo Removing any old persistent host route for %ROUTER_IP%...
route delete %ROUTER_IP% >nul 2>&1

echo Adding persistent host route for %ROUTER_IP% over "%ETH_ALIAS%"...
route -p add %ROUTER_IP% mask 255.255.255.255 0.0.0.0 metric 1 if %ETH_IFINDEX%
if errorlevel 1 (
    echo Failed to add persistent host route for %ROUTER_IP%.
    exit /b 1
)

echo.
echo Done.
echo Default internet traffic should prefer "%WIFI_ALIAS%".
echo Traffic to http://%ROUTER_IP% should use "%ETH_ALIAS%" on Network 2.
echo.
echo Current route for %ROUTER_IP%:
route print %ROUTER_IP%

endlocal
