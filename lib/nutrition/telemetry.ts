// Lightweight structured diagnostics for the nutrition provider pipeline.
// Emits single-line JSON under [nutrition-diag] prefix — filterable from Vercel logs.
// Never logs credentials, tokens, user IDs, or raw API payloads.

export type ProviderStatus =
  | 'ok'
  | 'empty'          // no results returned (food genuinely not found)
  | 'timeout'        // AbortController fired
  | 'auth_fail'      // missing or invalid credentials
  | 'ip_restricted'  // FatSecret Error 21
  | 'rate_limited'   // HTTP 429
  | 'http_error'     // 4xx/5xx other than 429
  | 'parse_error'    // response shape unexpected

export type ConversionStatus =
  | 'ok'
  | 'portion_not_found'
  | 'unit_unknown'
  | 'unit_incompatible'
  | 'density_unavailable'
  | 'enrichment_failed'

export interface ProviderSearchEvent {
  kind: 'provider_search'
  provider: string
  query: string       // truncated to 80 chars, no PII
  status: ProviderStatus
  resultCount: number
  latencyMs: number
  httpStatus?: number
  errorCode?: number  // provider-level error code (e.g. 21 = FatSecret IP restriction)
}

export interface ProviderDetailEvent {
  kind: 'provider_detail'
  provider: string
  status: ProviderStatus
  latencyMs: number
  httpStatus?: number
  errorCode?: number
}

export interface MatchSelectedEvent {
  kind: 'match_selected'
  query: string       // truncated to 80 chars
  provider: string
  foodName: string    // truncated to 60 chars
  score: number
  confidence: string
  qualityGateRejects: number
  totalCandidates: number
}

export interface MatchNoResultEvent {
  kind: 'match_no_result'
  query: string       // truncated to 80 chars
  reason: 'all_empty' | 'quality_gate' | 'low_score'
  qualityGateRejects: number
  totalBeforeGate: number
}

export interface ConversionEvent {
  kind: 'conversion'
  status: ConversionStatus
  step?: string
  conversionSource?: string
  errorCode?: string
}

export interface EnrichmentEvent {
  kind: 'enrichment'
  provider: string
  status: 'ok' | 'fail' | 'timeout'
  latencyMs: number
}

export type DiagnosticEvent =
  | ProviderSearchEvent
  | ProviderDetailEvent
  | MatchSelectedEvent
  | MatchNoResultEvent
  | ConversionEvent
  | EnrichmentEvent

export function emit(event: DiagnosticEvent): void {
  try {
    console.log(`[nutrition-diag] ${JSON.stringify(event)}`)
  } catch {
    // telemetry must never throw
  }
}
