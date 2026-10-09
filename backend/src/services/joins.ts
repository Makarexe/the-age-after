const JOIN_TTL_MS = 30_000;

interface PendingJoin {
  userId: string;
  username: string;
  ip: string;
  expiresAt: number;
}

/** serverId → who called /join. Lives in memory for 30 s, as in the Yggdrasil spec. */
export class JoinStore {
  private readonly joins = new Map<string, PendingJoin>();

  add(serverId: string, userId: string, username: string, ip: string): void {
    this.sweep();
    this.joins.set(serverId, { userId, username, ip, expiresAt: Date.now() + JOIN_TTL_MS });
  }

  get(serverId: string): PendingJoin | undefined {
    const join = this.joins.get(serverId);
    if (!join) return undefined;
    if (join.expiresAt <= Date.now()) {
      this.joins.delete(serverId);
      return undefined;
    }
    return join;
  }

  private sweep(): void {
    if (this.joins.size < 1000) return;
    const now = Date.now();
    for (const [key, join] of this.joins) if (join.expiresAt <= now) this.joins.delete(key);
  }
}
