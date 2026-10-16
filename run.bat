@echo off
echo =======================================================
echo          KHOI DONG SMART LIBRARY (CLIENT ^& SERVER)
echo =======================================================
echo.

echo Kiem tra thu vien Server...
if not exist "server\node_modules" (
    echo Chua co thu vien Server. Dang cai dat tu dong bang npm install...
    cd server
    call npm install
    cd ..
) else (
    echo Thu vien Server da ton tai. Bo qua cai dat.
)

echo.
echo Kiem tra thu vien Client...
if not exist "client\node_modules" (
    echo Chua co thu vien Client. Dang cai dat tu dong bang npm install...
    cd client
    call npm install
    cd ..
) else (
    echo Thu vien Client da ton tai. Bo qua cai dat.
)

echo.
echo [1/2] Dang khoi dong Server (Backend)...
start "Smart Library Backend" cmd /k "cd server && npm run dev"

echo [2/2] Dang khoi dong Client (Frontend)...
start "Smart Library Frontend" cmd /k "cd client && npm run dev"

echo.
echo Dang doi 3 giay de may chu khoi dong, sau do se tu dong mo trinh duyet...
timeout /t 3 /nobreak >nul
start http://localhost:5173/

echo.
echo Da mo thanh cong 2 cua so chay du an va trinh duyet!
echo Luu y: De tat he thong, ban chi can tat 2 cua so mau den moi mo len la duoc.
pause
