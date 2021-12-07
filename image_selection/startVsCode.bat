@echo off
REM set QGIS_PLUGINPATH=%~dp0
REM CMD /C ""%ProgramFiles%\QGIS 3.16.13\OSGeo4W.bat" "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe""
REM CALL "%ProgramFiles%\QGIS 3.16.13\OSGeo4W.bat" echo success
REM SET PATH=%PYTHONHOME%;%PATH%
CALL "%ProgramFiles%\QGIS 3.16.14\bin\python-qgis-ltr.bat" --version
start "VS Code" /B "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" %*
