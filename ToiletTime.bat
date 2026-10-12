@echo off
setlocal
title ToiletTime
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

:menu
cls
echo.
echo   ==============================
echo     ToiletTime
echo   ==============================
echo.
echo   1  Start the app on my iPhone       (phone on the same Wi-Fi)
echo   2  Start the app on any network     (uses the online server)
echo   3  Update ToiletTime to the newest version
echo   4  Install or repair                (first-time setup)
echo   5  Connect accounts                 (paste your Supabase keys)
echo   6  Sign in to Expo
echo   7  Open the website on this PC
echo   8  Show the commands, to type them myself
echo   9  Put a ToiletTime shortcut on my Desktop
echo   10 See reported reviews             (moderation)
echo   0  Exit
echo.
set "choice="
set /p "choice=  Type a number and press Enter: "
if "%choice%"=="1" goto phone
if "%choice%"=="2" goto online
if "%choice%"=="3" goto update
if "%choice%"=="4" goto setup
if "%choice%"=="5" goto configure
if "%choice%"=="6" goto expologin
if "%choice%"=="7" goto website
if "%choice%"=="8" goto commands
if "%choice%"=="9" goto shortcut
if "%choice%"=="10" goto moderate
if "%choice%"=="0" goto end
goto menu

:phone
call :ensuresetup
cls
echo.
echo   Starting ToiletTime...
echo.
echo   When the QR code appears, scan it with your iPhone Camera
echo   and tap "Open in Expo Go". Your iPhone must be on the same Wi-Fi.
echo.
echo   To stop: press Ctrl+C, then type N and press Enter to come back to this menu.
echo.
call npm run phone
pause
goto menu

:online
call :ensuresetup
cls
echo.
echo   Starting ToiletTime with the online server...
echo   Your iPhone can be on any Wi-Fi or on cellular data.
echo   If it asks to install @expo/ngrok, type Y and press Enter.
echo.
echo   To stop: press Ctrl+C, then type N and press Enter to come back to this menu.
echo.
call npm run phone:online
pause
goto menu

:update
cls
echo.
echo   Updating ToiletTime in a new window...
echo   When it says "Updated!", close that window and double-click ToiletTime.bat again.
echo.
rem The update replaces this file, so run it in a separate window and close this one.
rem The new window starts in this folder, so no path is needed.
start "Updating ToiletTime" cmd /k node scripts\update.js
goto end

:setup
cls
echo.
echo   Installing what ToiletTime needs. This can take a few minutes...
echo.
call npm run setup
echo.
echo   Done.
pause
goto menu

:configure
cls
echo.
echo   Connect ToiletTime to your Supabase project (accounts, sign-in and emails).
echo   Have your Supabase project open in your browser: Project Settings, then API Keys.
echo   Paste each value with a right-click, then press Enter.
echo.
call npm run configure
pause
goto menu

:moderate
cls
call npm run moderate
echo.
echo   To delete a review, copy its ID and run:   npm run moderate -- delete ID
echo   To keep it and clear its reports:          npm run moderate -- restore ID
echo   (Option 8 explains how to open a command window here.)
echo.
pause
goto menu

:expologin
cls
echo.
echo   Sign in with your Expo account (the same one you use in Expo Go).
echo.
pushd mobile
call npx expo login
popd
pause
goto menu

:website
call :ensuresetup
cls
echo.
echo   The website is opening in your browser at http://localhost:3000
echo   To stop: press Ctrl+C, then type N and press Enter to come back to this menu.
echo.
start "" http://localhost:3000
call npm start
pause
goto menu

:commands
cls
echo.
echo   You can type these yourself in a black window opened in this folder:
echo   (click the address bar in this folder, type cmd and press Enter)
echo.
echo   npm run setup          Install what ToiletTime needs (first time, or after problems)
echo   npm run phone          Start the app for your iPhone on the same Wi-Fi
echo   npm run phone:online   Start the app using the online server, any network
echo   npm run update         Download and install the newest version
echo   npm run configure      Connect accounts by saving your Supabase keys
echo   npm run moderate       See reported reviews (add: -- delete ID, or -- restore ID)
echo   npm start              Start only the website, at http://localhost:3000
echo   npm test               Run the server's automatic checks
echo.
echo   To stop anything that's running, press Ctrl+C.
echo.
pause
goto menu

:shortcut
set "TT_BAT=%~f0"
set "TT_DIR=%~dp0"
powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\ToiletTime.lnk'); $s.TargetPath = $env:TT_BAT; $s.WorkingDirectory = $env:TT_DIR; $s.Description = 'Start or update ToiletTime'; $s.Save()"
if errorlevel 1 goto shortcutfailed
echo.
echo   Added a ToiletTime shortcut to your Desktop.
echo.
pause
goto menu

:shortcutfailed
echo.
echo   Couldn't create the shortcut. You can right-click ToiletTime.bat and choose
echo   "Send to" then "Desktop (create shortcut)" instead.
echo.
pause
goto menu

:ensuresetup
if exist "node_modules\" if exist "mobile\node_modules\" exit /b 0
echo.
echo   First time here: installing what ToiletTime needs. This can take a few minutes...
echo.
call npm run setup
exit /b 0

:nonode
echo.
echo   Node.js isn't installed on this PC yet.
echo   Your browser will open nodejs.org: download the LTS version, install it,
echo   then double-click ToiletTime.bat again.
echo.
start "" https://nodejs.org
pause
goto end

:end
endlocal
