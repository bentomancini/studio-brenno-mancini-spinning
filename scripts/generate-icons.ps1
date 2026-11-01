Add-Type -AssemblyName System.Drawing

$publicDir = "c:\studio-brenno-mancini-spinning\public"
if (!(Test-Path $publicDir)) {
    New-Item -ItemType Directory -Force -Path $publicDir | Out-Null
}

Copy-Item "c:\studio-brenno-mancini-spinning\src\app\icon.svg" "$publicDir\icon.svg" -Force

function Create-Studio-Icon([int]$dimension, [string]$destination) {
    $bitmap = New-Object System.Drawing.Bitmap($dimension, $dimension)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Fundo escuro (#171a18)
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(23, 26, 24))
    $graphics.FillRectangle($bgBrush, 0, 0, $dimension, $dimension)

    # Cor da cadência laranja terracota (#ff875f)
    $accentPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 135, 95), [float]($dimension * 0.065))
    $accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    $scale = [float]($dimension / 64.0)

    # Linha horizontal da base
    $graphics.DrawLine($accentPen, [float](12.0 * $scale), [float](45.0 * $scale), [float](52.0 * $scale), [float](45.0 * $scale))

    # Barra vertical esquerda
    $graphics.DrawLine($accentPen, [float](16.0 * $scale), [float](45.0 * $scale), [float](16.0 * $scale), [float](33.0 * $scale))

    # Barra vertical central (mais alta)
    $graphics.DrawLine($accentPen, [float](32.0 * $scale), [float](45.0 * $scale), [float](32.0 * $scale), [float](15.0 * $scale))

    # Barra vertical direita
    $graphics.DrawLine($accentPen, [float](48.0 * $scale), [float](45.0 * $scale), [float](48.0 * $scale), [float](33.0 * $scale))

    $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)

    $accentPen.Dispose()
    $bgBrush.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()

    Write-Host "Arquivo criado com sucesso: $destination"
}

Create-Studio-Icon 180 "$publicDir\apple-touch-icon.png"
Create-Studio-Icon 180 "$publicDir\apple-touch-icon-precomposed.png"
Create-Studio-Icon 192 "$publicDir\icon-192.png"
Create-Studio-Icon 512 "$publicDir\icon-512.png"
