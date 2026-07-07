// 2-player co-op over WebRTC (PeerJS public broker, no server of ours).
// Host-authoritative: the host simulates customers, enemies and the shared
// wallet; the guest mirrors them and sends intents (hits, pickups, sales).
// The dream team split: one keeps shop while the other delves.
//
// Presence is name-based: each player registers a peer under their own name so
// friends can reach them directly. From the shop you invite a friend, who — if
// they aren't down in the cellar — can accept and teleport into your world.
import { Peer } from "peerjs";

const PREFIX = "coincellar-friend-";

// Peer IDs must be broker-safe, so fold a display name down to bare
// alphanumerics. Two players sharing a slug will collide on the broker.
export function slugName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export class Coop {
  constructor(game) {
    this.game = game;
    this.peer = null; // our named presence peer, alive while we're online
    this.conn = null; // the active game connection (once in a session)
    this.isHost = false;
    this.isGuest = false;
    this.connected = false;
    this.name = null; // our display name
    this._slug = null;
    this._incoming = null; // a friend's pending tp invite: { conn, from }
    this._outName = null; // who we last reached out to invite
    this._idc = 0;
    this._sendT = 0;
    this._dirtyEnemies = new Set();
    this._dirtyCustomers = new Set();
    this.onStatus = () => {};
  }

  newId() {
    return (this.isGuest ? "g" : "h") + this._idc++;
  }

  get online() {
    return !!this.peer && !this.peer.destroyed;
  }

  // Register ourselves on the broker under `name` so friends can reach us.
  goOnline(name) {
    const slug = slugName(name);
    if (!slug) return;
    this.name = name;
    if (this.online && this._slug === slug) return; // already listening as this name
    this._slug = slug;
    this._destroyPeer();
    this.peer = new Peer(PREFIX + slug);
    this.peer.on("open", () => this.onStatus(`Online as ${name}`));
    this.peer.on("error", (e) => this.onStatus("net error: " + e.type));
    this.peer.on("connection", (conn) => {
      conn.on("open", () => this._bind(conn, "in"));
    });
  }

  // Reach out to a friend and offer them a teleport into our shop. We become
  // the host; they become the guest once they accept.
  invite(name) {
    if (!this.online) return this.onStatus("Go online first.");
    if (this.connected) return this.onStatus("You're already playing with a friend.");
    this._outName = name;
    this.onStatus(`Inviting ${name}…`);
    const conn = this.peer.connect(PREFIX + slugName(name), { reliable: true });
    conn.on("open", () => {
      conn.send({ t: "tpInvite", from: this.name });
      this._bind(conn, "out");
    });
    conn.on("error", () => this.onStatus(`Couldn't reach ${name} — are they online?`));
  }

  hasInvite() {
    return !!this._incoming;
  }

  // Guest side: accept a friend's teleport invite. Only allowed above ground —
  // you can't yank someone out of a live dungeon run.
  acceptInvite() {
    const inc = this._incoming;
    if (!inc) return false;
    if (this.game.playerArea === "dungeon") {
      this.onStatus("You can't teleport while delving.");
      return false;
    }
    this._incoming = null;
    this.conn = inc.conn;
    this.isGuest = true;
    this.isHost = false;
    this.connected = true;
    try { inc.conn.send({ t: "tpAccept" }); } catch {}
    this.game.onJoinedHost();
    return true;
  }

  declineInvite() {
    const inc = this._incoming;
    if (!inc) return;
    this._incoming = null;
    try {
      inc.conn.send({ t: "tpDecline" });
      inc.conn.close();
    } catch {}
  }

  // Leave the current session but stay online for future invites.
  leave() {
    if (this.conn) {
      try { this.conn.close(); } catch {}
    }
    if (this.connected) this._onClose();
  }

  // Route a connection's traffic. During the handshake we watch for the
  // tp invite/accept/decline messages; once a session is live everything on
  // the active connection flows to the game.
  _bind(conn, role) {
    conn.on("data", (d) => this._route(conn, role, d));
    conn.on("close", () => { if (this.conn === conn) this._onClose(); });
    conn.on("error", () => {});
  }

  _route(conn, role, d) {
    if (this.connected && conn === this.conn) return this._onMessage(d);
    if (!d || typeof d !== "object") return;
    if (role === "in" && d.t === "tpInvite") {
      if (this.connected) {
        try { conn.send({ t: "tpDecline" }); conn.close(); } catch {}
        return;
      }
      this._incoming = { conn, from: d.from || "A friend" };
      this.game.onTpInvite(this._incoming.from);
    } else if (role === "out" && d.t === "tpAccept") {
      this._finishHost(conn);
    } else if (role === "out" && d.t === "tpDecline") {
      this.onStatus(`${this._outName || "Your friend"} declined.`);
      if (conn !== this.conn) { try { conn.close(); } catch {} }
    }
  }

  _finishHost(conn) {
    if (this.connected) return;
    this.conn = conn;
    this.isHost = true;
    this.isGuest = false;
    this.connected = true;
    this.game.onPeerJoined();
  }

  _onClose() {
    this.connected = false;
    this.conn = null;
    this.onStatus("Your friend left.");
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
      // which dungeon floor we're standing on (-1 above ground) so the partner
      // can hide/ignore us when we're off exploring a different floor
      fl: g.playerArea === "dungeon" ? g.dungeon.floor : -1,
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
