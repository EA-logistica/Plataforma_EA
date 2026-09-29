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

rem Reinicio desde la plataforma: el boton "Reiniciar ahora" (logistica,
rem admin) cierra el servidor con codigo 3 y esta ventana lo vuelve a
rem levantar con el codigo nuevo. Cualquier otro cierre termina aqui.
set PLANSA_SUPERVISADO=1
:arrancar
node server.js
if %errorlevel%==3 (
  echo.
  echo   Reiniciando para aplicar la actualizacion...
  echo.
  goto arrancar
)

echo.
echo El servidor se detuvo.
pause
