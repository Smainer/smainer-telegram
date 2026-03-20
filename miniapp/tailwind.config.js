/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Monaco', 'Cascadia Code', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          hover: "hsl(var(--accent-hover))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        error: {
          DEFAULT: "hsl(var(--error))",
          foreground: "hsl(var(--error-foreground))",
        },
        // Premium dark luxury color palette
        "void": "#09090B",
        "elevated": "#111111", 
        "interactive": "#1A1A1A",
        "surface-accent": "#262626",
        "champagne": {
          DEFAULT: "#B5A082",
          muted: "#8A7563",
          50: "#F9F7F4",
          100: "#F0EDE7", 
          200: "#DDD6C9",
          300: "#C4B396",
          400: "#B5A082",
          500: "#A18F6E",
          600: "#8A7563",
          700: "#6B5B4A",
          800: "#4C4136",
          900: "#2D2622",
        },
        "cyan-bright": "#22D3EE",
        "cyan-muted": "#0891B2",
        // Telegram theme color aliases
        tg: {
          bg: "var(--tg-theme-bg-color, var(--surface-void))",
          text: "var(--tg-theme-text-color, var(--text-primary))",
          "text-hint": "var(--tg-theme-hint-color, var(--text-muted))",
          link: "var(--tg-theme-link-color, var(--champagne))",
          button: "var(--tg-theme-button-color, var(--champagne))",
          "button-text": "var(--tg-theme-button-text-color, #000000)",
          "secondary-bg": "var(--tg-theme-secondary-bg-color, var(--surface-elevated))",
        },
        // CSS variable aliases for components
        "surface-void": "var(--surface-void)",
        "surface-elevated": "var(--surface-elevated)",
        "surface-interactive": "var(--surface-interactive)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",
        "text-disabled": "var(--text-disabled)",
        "border-subtle": "var(--border-subtle)",
        "border-interactive": "var(--border-interactive)",
        "border-active": "var(--border-active)",
      },
      backdropBlur: {
        'xs': '2px',
        'sm': '4px',
        'md': '8px', 
        'lg': '12px',
        'xl': '16px',
        '2xl': '24px',
        '3xl': '32px',
      },
      dropShadow: {
        'champagne': '0 0 20px rgba(181, 160, 130, 0.25)',
        'champagne-lg': '0 0 30px rgba(181, 160, 130, 0.4)',
        'success': '0 0 20px rgba(16, 185, 129, 0.25)',
        'cyan': '0 0 20px rgba(34, 211, 238, 0.25)',
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { transform: "translateY(10px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 5px rgba(181, 160, 130, 0.5)" },
          "50%": { boxShadow: "0 0 20px rgba(181, 160, 130, 0.8)" },
        },
        "breathe": {
          "0%, 100%": { transform: "scale(1)", opacity: "0.6" },
          "50%": { transform: "scale(1.3)", opacity: "1" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        }
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out", 
        "fade-in": "fade-in 0.3s ease-out",
        "slide-up": "slide-up 0.3s ease-out",
        "glow-pulse": "glow-pulse 2s ease-in-out infinite",
        "breathe": "breathe 2s ease-in-out infinite",
        "shimmer": "shimmer 2s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}