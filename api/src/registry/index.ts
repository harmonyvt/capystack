// The registry every request, chat call and MCP call goes through (docs/CONTRACT.md section 4). Add an area's ops here;
// each area keeps its ops in ops/<area>.ts. The order is the order of openapi.json and of the chat's tool list.
import { AUTH_OPS } from "./ops/auth";
import { CHAT_OPS } from "./ops/chat";
import { JOB_OPS } from "./ops/jobs";
import { KEY_OPS } from "./ops/keys";
import { MCP_OPS } from "./ops/mcp";
import { NOTE_OPS } from "./ops/notes";
import { PUSH_OPS } from "./ops/push";
import { SYNC_OPS } from "./ops/sync";
import { SYSTEM_OPS } from "./ops/system";
import { Registry } from "./registry";

export const REGISTRY = new Registry([...SYSTEM_OPS, ...AUTH_OPS, ...KEY_OPS, ...NOTE_OPS, ...SYNC_OPS, ...CHAT_OPS, ...PUSH_OPS, ...JOB_OPS, ...MCP_OPS]);

export { defineOp, ok, OpError, type Op, type OpContext, type OpReply } from "./op";
export { Registry } from "./registry";
export { handleRequest } from "./http";
