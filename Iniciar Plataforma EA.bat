@echo off
setlocal
cd /d "%~dp0"

echo.
echo   Plataforma EA
echo   ===============
echo.

if not exist "node_modules" (
  echo Primera vez: instalando dependencias, un momento...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo No se pudo instalar. Revisa el mensaje de arriba.
    pause
    exit /b 1
  )
)

echo Iniciando el servidor...
echo Esta ventana muestra el registro del servidor: no la cierres mientras
echo trabajes. Para apagarlo, cierra la ventana o presiona Ctrl+C.
echo.

rem Abre el navegador solo, sin esperar a que el servidor termine de arrancar.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"

node server.js

echo.
echo El servidor se detuvo.
pause
