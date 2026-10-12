// Manages in-flight search requests so that:
//   1. A superseded request's AbortController is cancelled when a new search starts.
//   2. Callers can check whether their request is still the current one before
//      committing state updates, preventing stale results from overwriting newer ones.

export const SEARCH_MIN_LENGTH = 2

export function isSearchable(query: string): boolean {
  return query.trim().length >= SEARCH_MIN_LENGTH
}

export class FoodSearchController {
  private abortController: AbortController | null = null
  private seq = 0

  // Call at the start of each new search. Aborts any prior in-flight request and
  // returns a fresh AbortSignal + a sequence number the caller can use for staleness checks.
  begin(): { signal: AbortSignal; seq: number } {
    this.abortController?.abort()
    this.abortController = new AbortController()
    this.seq += 1
    return { signal: this.abortController.signal, seq: this.seq }
  }

  // Returns true only if `seq` matches the most-recently issued sequence number.
  // A false return means a newer search has started — discard this response.
  isCurrent(seq: number): boolean {
    return seq === this.seq
  }

  // Cancel any in-flight request without starting a new one (e.g. on unmount).
  cancel(): void {
    this.abortController?.abort()
  }
}
