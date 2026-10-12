export type GpErrorCode =
  | 'NotPositiveDefinite'
  | 'InvalidInput'
  | 'OptimizerFailed'
  | 'CsvParseError'

export class GpError extends Error {
  code: GpErrorCode
  details?: Record<string, unknown>

  constructor(code: GpErrorCode, details?: Record<string, unknown>, message?: string) {
    super(message ?? code)
    this.name = 'GpError'
    this.code = code
    this.details = details
  }
}
