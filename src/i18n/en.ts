import type de from './de'

type Messages<T> = { [K in keyof T]: T[K] extends string ? string : Messages<T[K]> }

const en: Messages<typeof de> = {
  app: {
    title: 'GP Labs',
  },
  nav: {
    home: 'Home',
    playground: 'Playground',
    kernels: 'Kernel Lab',
    datalab: 'Data Lab',
    label: 'Tools',
  },
  lang: {
    toggle: 'Switch language',
  },
  notice: {
    invalidUrl: 'The address contains invalid values. Showing the default view instead.',
    dismiss: 'Dismiss notice',
  },
  home: {
    placeholder: 'Pick a tool above.',
  },
  ref: {
    badge: 'Textbook ch. {chapter} · Notebook code {code}',
    badgeNoCode: 'Textbook ch. {chapter}',
  },
  status: {
    loading: 'Computing …',
    empty: 'No data available.',
    error: 'Error:',
  },
  param: {
    none: 'This kernel has no adjustable parameters.',
    sigma: 'Signal strength σ',
    ell: 'Length scale ℓ{index}',
    alpha: 'Shape α',
    period: 'Period',
    sigma0: 'Spread σ₀',
    c: 'Constant c',
    offset: 'Offset',
    degree: 'Degree',
    p: 'Exponent p',
    l1: 'Length scale left ℓ₁',
    l2: 'Length scale right ℓ₂',
    w: 'Transition width w',
    x0: 'Transition location x₀',
    sigmaN: 'Noise σₙ',
  },
}

export default en
