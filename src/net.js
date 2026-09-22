import Peer from "peerjs";
import { roomCode } from "./rng.js";

const PREFIX = "stickroyale-";

export class Net {
  constructor() {
    this.peer = null;
    this.code = "";
    this.role = null;
    this.conns = new Map();
    this.hostConn = null;
    this.handlers = new Map();
    this.localPeerId = "";
  }

  on(type, fn) {
    this.handlers.set(type, fn);
  }

  _emit(msg, from) {
    const fn = this.handlers.get(msg.t);
    if (fn) fn(msg, from);
  }

  _wire(conn, id) {
    conn.on("data", (msg) => {
      if (msg && msg.t) this._emit(msg, id);
    });
    conn.on("close", () => {
      this.conns.delete(id);
      this._emit({ t: "left", id }, id);
    });
  }

  async host() {
    this.role = "host";
    for (let i = 0; i < 6; i++) {
      const code = roomCode();
      try {
        await this._open(`${PREFIX}${code}`);
        this.code = code;
        this.peer.on("connection", (conn) => {
          conn.on("open", () => {
            const id = conn.peer;
            this.conns.set(id, conn);
            this._wire(conn, id);
            this._emit({ t: "joined", id }, id);
          });
        });
        return code;
      } catch {
        this.destroy();
      }
    }
    throw new Error("Could not open a room. Try again.");
  }

  async join(code) {
    this.role = "client";
    const clean = code.trim().toUpperCase();
    await this._open();
    const conn = this.peer.connect(`${PREFIX}${clean}`, { reliable: true });
    this.hostConn = conn;
    this._wire(conn, "host");
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Host not found. Check the code.")), 8000);
      conn.on("open", () => {
        clearTimeout(t);
        resolve();
      });
      conn.on("error", (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
    this.code = clean;
    return clean;
  }

  _open(id) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(id, {
        debug: 0,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        },
      });
      this.peer = peer;
      peer.on("open", (pid) => {
        this.localPeerId = pid;
        resolve(pid);
      });
      peer.on("error", (err) => reject(err));
    });
  }

  sendToHost(msg) {
    if (this.hostConn?.open) this.hostConn.send(msg);
  }

  sendTo(id, msg) {
    const c = this.conns.get(id);
    if (c?.open) c.send(msg);
  }

  broadcast(msg) {
    for (const c of this.conns.values()) {
      if (c.open) c.send(msg);
    }
  }

  destroy() {
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    if (this.hostConn) this.hostConn.close();
    this.hostConn = null;
    if (this.peer) this.peer.destroy();
    this.peer = null;
  }
}
