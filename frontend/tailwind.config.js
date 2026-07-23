/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        border: 'var(--border)',
        primary: 'var(--text)',
        muted: 'var(--text-muted)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        'on-accent': 'var(--on-accent)',
        correct: 'var(--correct)',
        wrong: 'var(--wrong)',
        warning: 'var(--warning)',
        heat1: 'var(--heat-1)',
        heat2: 'var(--heat-2)',
        heat3: 'var(--heat-3)',
        heat4: 'var(--heat-4)',
        heat5: 'var(--heat-5)',
      },
    },
  },
  plugins: [],
}
