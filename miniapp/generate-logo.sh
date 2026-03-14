#!/bin/bash
# Smainer Logo - Simple PNG Generator using ImageMagick

echo "🎨 Generating Smainer Logo - 512x512 PNG"

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick not found. Installing..."
    sudo apt update && sudo apt install -y imagemagick
fi

# Convert SVG to PNG
echo "📸 Converting SVG to PNG..."
convert -background transparent smainer-logo.svg -resize 512x512 smainer-logo-512x512.png

# Check if file was created
if [ -f "smainer-logo-512x512.png" ]; then
    echo "✅ Success! Logo saved as: smainer-logo-512x512.png"
    echo "📏 File size: $(du -h smainer-logo-512x512.png | cut -f1)"
    echo ""
    echo "📱 Next steps for @BotFather:"
    echo "1. Open @BotFather on Telegram"
    echo "2. Send: /newapp"
    echo "3. Select: @smainer_ai_bot"
    echo "4. Upload: smainer-logo-512x512.png"
    echo "5. URL: https://smainer-miniapp.vercel.app"
else
    echo "❌ Failed to generate PNG. Try the HTML generator instead:"
    echo "   Open logo-generator.html in your browser"
fi