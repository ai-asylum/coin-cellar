// 2-player co-op over WebRTC (PeerJS public broker, no server of ours).
// Host-authoritative: the host simulates customers, enemies and the shared
// wallet; the guest mirrors them and sends intents (hits, pickups, sales).
// The dream team split: one keeps shop while the other delves.
import { Peer } from "peerjs";

const PREFIX = "coincellar-";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class Coop {
  constructor(game) {
    this.game = game;
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.isGuest = false;
    this.connected = false;
    this.code = null;
    this._idc = 0;
    this._sendT = 0;
    this._dirtyEnemies = new Set();
    this._dirtyCustomers = new Set();
    this.onStatus = () => {};
  }

  newId() {
    return (this.isGuest ? "g" : "h") + this._idc++;
  }

  host() {
    this.code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
    this._destroyPeer();
    this.peer = new Peer(PREFIX + this.code.toLowerCase());
    this.peer.on("open", () => this.onStatus(`Room code: ${this.code} — waiting…`));
    this.peer.on("error", (e) => this.onStatus("net error: " + e.type));
    this.peer.on("connection", (conn) => {
      if (this.conn) return conn.close();
      this.conn = conn;
      this.isHost = true;
      conn.on("open", () => {
        this.connected = true;
        this.onStatus(`Partner joined!`);
        this.game.onPeerJoined();
      });
      conn.on("data", (d) => this._onMessage(d));
      conn.on("close", () => this._onClose());
    });
    return this.code;
  }

  join(code) {
    this._destroyPeer();
    this.code = code.toUpperCase();
    this.peer = new Peer();
    this.onStatus("Connecting…");
    this.peer.on("error", (e) => this.onStatus("net error: " + e.type));
    this.peer.on("open", () => {
      const conn = this.peer.connect(PREFIX + this.code.toLowerCase(), { reliable: true });
      this.conn = conn;
      conn.on("open", () => {
        this.isGuest = true;
        this.connected = true;
        this.onStatus("Connected!");
        this.game.onJoinedHost();
      });
      conn.on("data", (d) => this._onMessage(d));
      conn.on("close", () => this._onClose());
    });
  }

  _onClose() {
    this.connected = false;
    this.conn = null;
    this.onStatus("Partner left.");
    this.game.onPeerLeft();
    this.isHost = false;
    this.isGuest = false;
  }

  _destroyPeer() {
    if (this.peer) this.peer.destroy();
    this.peer = null;
    this.conn = null;
    this.connected = false;
  }

  send(obj) {
    if (this.connected && this.conn?.open) this.conn.send(obj);
  }

  trackEnemy(e) {
    if (this.connected && this.isHost) this._dirtyEnemies.add(e);
  }

  trackCustomer(c) {
    if (this.connected && this.isHost) this._dirtyCustomers.add(c);
  }

  update(dt) {
    if (!this.connected) return;
    this._sendT -= dt;
    if (this._sendT > 0) return;
    this._sendT = 0.09; // ~11 Hz

    const g = this.game;
    const p = g.player;
    this.send({
      t: "p",
      x: r2(p.position.x), z: r2(p.position.z), h: r2(p.heading),
      area: g.playerArea,
      atk: p.animator.attackT >= 0 ? 1 : 0,
      dead: p.dead ? 1 : 0,
    });

    if (this.isHost) {
      if (this._dirtyEnemies.size) {
        const list = [];
        for (const e of this._dirtyEnemies)
          list.push([e.id, e.kind, e.seed, e.tier, r2(e.creature.position.x), r2(e.creature.position.z), r2(e.creature.heading), e.hp]);
        this._dirtyEnemies.clear();
        this.send({ t: "eSnap", list });
      }
      if (this._dirtyCustomers.size) {
        const list = [];
        for (const c of this._dirtyCustomers)
          list.push([c.id, c.seed, r2(c.creature.position.x), r2(c.creature.position.z), r2(c.creature.heading), c.state]);
        this._dirtyCustomers.clear();
        this.send({ t: "cSnap", list });
      }
    }
  }

  _onMessage(msg) {
    try {
      this.game.onNetMessage(msg);
    } catch (err) {
      console.error("net msg failed", msg?.t, err);
    }
  }
}

function r2(x) {
  return Math.round(x * 100) / 100;
}
