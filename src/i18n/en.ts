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
}

export default en
