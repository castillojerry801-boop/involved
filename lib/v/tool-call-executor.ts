/**
 * Guarantee layer for multi-call tool execution.
 *
 * Processes an array of tool calls from a single assistant message, guaranteeing
 * exactly one ToolCallResponse per call before the next model request. Handler
 * errors — including JSON.parse failures on arguments, provider timeouts, and
 * uncaught exceptions — are caught and returned as structured error content.
 *
 * Authorization and integrity errors surface as tool-level error responses, NOT
 * as successful operations. Callers must inspect response content for error status.
 * The model then tells the user what failed; no data is written or mutated on error.
 */

export interface ToolCallRequest {
  id: string
  name: string
  arguments: string // raw JSON string exactly as received from the model
}

export interface ToolCallResponse {
  tool_call_id: string
  content: string
}

// Handler receives the call name and already-parsed arguments.
// JSON.parse failures are caught at this layer, not delegated to the handler.
export type ToolHandler = (name: string, args: unknown) => Promise<string>

export async function executeToolCalls(
  calls: ToolCallRequest[],
  handler: ToolHandler,
): Promise<ToolCallResponse[]> {
  const responses: ToolCallResponse[] = []
  for (const call of calls) {
    let content: string = JSON.stringify({ status: 'error', message: 'Tool execution failed unexpectedly.' })
    try {
      const args = JSON.parse(call.arguments) as unknown
      content = await handler(call.name, args)
    } catch (err) {
      // Catches: JSON.parse failures (malformed arguments), handler exceptions
      // (provider timeouts, unexpected throws), and authorization errors that
      // propagate past the handler's own try/catch. Always produces a structured
      // error response — never leaves the call_id without a response.
      const msg = err instanceof Error ? err.message : 'Unexpected error'
      console.error('[V-tool-uncaught]', { toolName: call.name, error: msg })
      content = JSON.stringify({ status: 'error', message: 'Tool execution failed. Please try again.' })
    }
    responses.push({ tool_call_id: call.id, content })
  }
  return responses
}
