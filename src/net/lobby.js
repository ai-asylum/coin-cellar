// The shared-world layer: Supabase Realtime presence + position broadcast.
// Unlike the PeerJS co-op (2 players, shared economy, host authority), the
// lobby is purely social — everyone standing in the same zone (the cellar, or
// one of its dungeon holes) sees everyone else's avatar move in realtime.
// No gameplay state crosses this wire: enemies, loot and gold stay local.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://irhxoslymcxbeendjcuj.supabase.co";
const SUPABASE_KEY = "sb_publishable_PBgqankkoWQ5KOCApXMjNg_eEP6nvty";
const SEND_HZ = 8; // position broadcast rate (client throttle is HZ+2/s)

export class Lobby {
  constructor(game) {
    this.game = game;
    this.client = null; // created lazily on first join
    this.channel = null;
    this.zone = null;
    // per-session identity: presence key + the id stamped on our broadcasts
    this.id = Math.random().toString(36).slice(2, 10);
    this.players = new Map(); // id -> {id, name, buf, floor, dead, atk, wasAtk}
    this._sendT = 0;
    this.onPlayersChanged = () => {};
  }

  _ensureClient() {
    if (!this.client)
      this.client = createClient(SUPABASE_URL, SUPABASE_KEY, {
        realtime: { params: { eventsPerSecond: SEND_HZ + 2 } },
      });
    return this.client;
  }

  // Join a zone ("cellar" or "hole:<day>:<k>"), leaving whichever we were in.
  join(zone) {
    if (this.zone === zone) return;
    this.leave();
    this.zone = zone;
    const ch = this._ensureClient().channel(`coincellar:${zone}`, {
      config: { presence: { key: this.id }, broadcast: { self: false } },
    });
    this.channel = ch;
    ch.on("presence", { event: "sync" }, () => {
      if (this.channel !== ch) return;
      const present = ch.presenceState(); // { key: [metas] }
      for (const [key, metas] of Object.entries(present)) {
        if (key === this.id) continue;
        const pl = this._player(key);
        pl.name = metas[0]?.name || pl.name;
      }
      for (const key of [...this.players.keys()])
        if (!present[key]) this.players.delete(key);
      this.onPlayersChanged();
    });
    ch.on("broadcast", { event: "p" }, ({ payload: m }) => {
      if (this.channel !== ch || !m || m.id === this.id) return;
      const pl = this._player(m.id);
      if (m.f !== pl.floor) pl.buf.length = 0; // floor change is a teleport: snap
      pl.buf.push({ t: performance.now() / 1000, x: m.x, z: m.z, h: m.h });
      if (pl.buf.length > 12) pl.buf.shift();
      pl.floor = m.f;
      pl.dead = !!m.dead;
      pl.atk = !!m.atk;
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED" && this.channel === ch)
        ch.track({ name: this.game.playerName || "a wanderer" });
    });
  }

  leave() {
    if (this.channel) {
      const ch = this.channel;
      this.channel = null;
      try { ch.unsubscribe(); } catch {}
    }
    this.zone = null;
    this.players.clear();
    this.onPlayersChanged();
  }

  _player(id) {
    let pl = this.players.get(id);
    if (!pl) {
      pl = { id, name: "", buf: [], floor: 0, dead: false, atk: false };
      this.players.set(id, pl);
      this.onPlayersChanged();
    }
    return pl;
  }

  get count() {
    return this.players.size;
  }

  update(dt) {
    if (!this.channel || this.channel.state !== "joined") return;
    this._sendT -= dt;
    if (this._sendT > 0) return;
    this._sendT = 1 / SEND_HZ;
    const g = this.game;
    const p = g.player.position;
    this.channel.send({
      type: "broadcast",
      event: "p",
      payload: {
        id: this.id,
        x: r2(p.x), z: r2(p.z), h: r2(g.player.heading),
        f: g.playerArea === "dungeon" ? g.dungeon.floor : 0,
        atk: g.player.animator.attackT >= 0 ? 1 : 0,
        dead: g._respawnT >= 0 ? 1 : 0,
      },
    });
  }
}

function r2(x) {
  return Math.round(x * 100) / 100;
}
