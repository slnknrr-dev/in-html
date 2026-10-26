@echo off
rem github-push.bat "commit message" - runs github-push.sh in Git Bash (see that file).
setlocal
set "SH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%SH%" set "SH=bash"
"%SH%" "%~dp0github-push.sh" %*
exit /b %ERRORLEVEL%
