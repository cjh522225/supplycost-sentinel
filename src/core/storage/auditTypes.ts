import type { FetchLog, RotationLog, ValidationLog } from '../../shared/types'

export interface AuditFile {
  fetchLogs: FetchLog[]
  rotationLogs: RotationLog[]
  validationLogs: ValidationLog[]
}

export function emptyAudit(): AuditFile {
  return { fetchLogs: [], rotationLogs: [], validationLogs: [] }
}

export const EMPTY_AUDIT: AuditFile = emptyAudit()
