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
        // F52 표현 팔레트(설계 §6) — text-ink-*·bg-mark-* 유틸로 사용.
        ink: {
          red: 'var(--ink-red)',
          orange: 'var(--ink-orange)',
          yellow: 'var(--ink-yellow)',
          green: 'var(--ink-green)',
          blue: 'var(--ink-blue)',
          purple: 'var(--ink-purple)',
          gray: 'var(--ink-gray)',
        },
        mark: {
          red: 'var(--mark-red)',
          orange: 'var(--mark-orange)',
          yellow: 'var(--mark-yellow)',
          green: 'var(--mark-green)',
          blue: 'var(--mark-blue)',
          purple: 'var(--mark-purple)',
          gray: 'var(--mark-gray)',
        },
        // F53 문서 배경 틴트(설계 §6, S28) — bg-docbg-* 유틸. mark와 이름 체계는 공유하되 값은
        // 분리된 --doc-bg-* 토큰을 가리킨다.
        docbg: {
          red: 'var(--doc-bg-red)',
          orange: 'var(--doc-bg-orange)',
          yellow: 'var(--doc-bg-yellow)',
          green: 'var(--doc-bg-green)',
          blue: 'var(--doc-bg-blue)',
          purple: 'var(--doc-bg-purple)',
          gray: 'var(--doc-bg-gray)',
        },
      },
    },
  },
  plugins: [],
}
