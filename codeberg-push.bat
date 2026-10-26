@echo off
rem codeberg-push.bat "commit message" - runs codeberg-push.sh in Git Bash (see that file).
setlocal
set "SH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%SH%" set "SH=bash"
"%SH%" "%~dp0codeberg-push.sh" %*
exit /b %ERRORLEVEL%
