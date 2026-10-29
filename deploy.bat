@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo    SMART LIBRARY 4.0 - WINDOWS DOCKER DEPLOY SCRIPT
echo ========================================================

REM 1. Kiem tra Docker CLI co duoc cai dat hay chua
where docker >nul 2>nul
if errorlevel 1 (
    echo.
    echo [LOI] May tinh cua ban chua cai dat Docker!
    echo Vui long tai va cai dat Docker Desktop tai: https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

REM 2. Kiem tra xem Docker Desktop (Docker Daemon) co dang bat khong
echo [Kiem tra] Kiem tra ket noi den Docker Engine...
docker info >nul 2>nul
if errorlevel 1 (
    echo.
    echo [THONG BAO] Docker Desktop chua duoc bat hoac chua khoi dong xong!
    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        echo [INFO] Dang tu dong mo Docker Desktop cho ban...
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
        echo Dang cho Docker Engine khoi dong (co the mat khoang 30-60 giay)...
        
        set /a retry=0
        :wait_docker
        timeout /t 5 /nobreak >nul
        docker info >nul 2>nul
        if errorlevel 1 (
            set /a retry+=1
            if !retry! lss 18 (
                echo    ... dang cho Docker Engine san sang (lan !retry!/18) ...
                goto wait_docker
            ) else (
                echo.
                echo [LOI] Docker Desktop mat qua nhieu thoi gian de khoi dong.
                echo Vui long kiem tra Docker Desktop tren man hinh, doi bieu tuong Docker chuyen sang mau xanh (Engine running) roi chay lai file nay!
                echo.
                pause
                exit /b 1
            )
        )
    ) else (
        echo.
        echo Vui long mo ung dung Docker Desktop tren may tinh cua ban, doi Docker khoi dong xong roi chay lai file deploy.bat nay!
        echo.
        pause
        exit /b 1
    )
)

echo [OK] Docker Engine dang hoat dong tot!

REM 3. Kiem tra file .env
if not exist .env (
    echo.
    echo [INFO] .env chua ton tai. Dang tao tu .env.example...
    copy .env.example .env >nul
    echo [OK] Da tao file .env thanh cong.
)

REM 4. Build va khoi chay cac container
echo.
echo [1/3] Dang build cac Docker image (Backend, Frontend Nginx, MySQL)...
docker compose build
if errorlevel 1 (
    echo.
    echo [LOI] Build Docker images that bai! Vui long kiem tra chi tiet loi o tren.
    pause
    exit /b 1
)

echo.
echo [2/3] Dang khoi chay cac container trong che do chay ngam...
docker compose down --remove-orphans >nul 2>nul
docker compose up -d
if errorlevel 1 (
    echo.
    echo [LOI] Khong the khoi dong cac container! (Co the bi trung port 80, 5000 hoac 3306 voi ung dung khac).
    pause
    exit /b 1
)

echo.
echo [3/3] Dang kiem tra trang thai cac container...
docker compose ps

echo.
echo ========================================================
echo   HE THONG THU VIEN THONG MINH DANG CHAY TREN DOCKER!
echo   Frontend Web : http://localhost:8088
echo   Backend API  : http://localhost:5001/api (hoac qua reverse proxy http://localhost:8088/api)
echo.
echo   - Xem log truc tiep : docker compose logs -f
echo   - Dung he thong      : docker compose down
echo ========================================================
pause
