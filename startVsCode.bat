@echo off
CALL "%ProgramFiles%\QGIS 3.16.14\bin\python-qgis-ltr.bat" --version
start "VS Code" /B "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" image_selection %*
