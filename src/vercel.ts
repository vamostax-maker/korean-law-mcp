/**
 * Vercel serverless entry (added in the vamostax-maker fork).
 *
 * Reuses the upstream Express app built by startHTTPServer() (stateless
 * Streamable HTTP, same security middleware) but captures it instead of
 * binding a port, so Vercel can invoke it per request.
 */
import express from "express"
import type { IncomingMessage, ServerResponse } from "node:http"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js"
import { LawApiClient } from "./lib/api-client.js"
import { registerTools } from "./tool-registry.js"
import { startHTTPServer } from "./server/http-server.js"
import { readExecutionLimits, type ExecutionLimits } from "./lib/execution-limits.js"
import { VERSION } from "./version.js"
import { SERVER_INSTRUCTIONS } from "./lib/tool-profiles.js"

const LAW_OC = process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY || ""
const apiClient = new LawApiClient({ apiKey: LAW_OC })
const jsonSchemaValidator = new AjvJsonSchemaValidator()

function createServer(executionLimits: ExecutionLimits = readExecutionLimits()): Server {
  const s = new Server(
    { name: "korean-law", version: VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS, jsonSchemaValidator }
  )
  registerTools(s, apiClient, executionLimits)
  return s
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let captured: Handler | undefined
const appProto = (express as unknown as { application: { listen: unknown } }).application
const originalListen = appProto.listen
appProto.listen = function (this: Handler, ...args: unknown[]) {
  captured = this
  const cb = args.find((a) => typeof a === "function") as (() => void) | undefined
  if (cb) cb()
  return { close: (done?: () => void) => { if (done) done() }, closeIdleConnections: () => {} }
}

const ready: Promise<void> = startHTTPServer(createServer, 8000).finally(() => {
  appProto.listen = originalListen
})

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await ready
  if (!captured) throw new Error("Express app was not initialised")
  captured(req, res)
}
