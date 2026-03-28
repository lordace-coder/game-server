/**
 * Global Session Manager
 * Prevents users from being in multiple games simultaneously
 */

interface UserSession {
  userId: string;
  gameType: "aviator" | "pipshot";
  wsId: string; // WebSocket identifier
  joinedAt: number;
}

class SessionManager {
   activeSessions: Map<string, UserSession> = new Map(); // userId -> session

  /**
   * Register a user joining a game
   * Returns true if successful, false if user already in another game
   */
  registerUser(
    userId: string,
    gameType: "aviator" | "pipshot",
    wsId: string,
  ): boolean {
    if (this.activeSessions.has(userId)) {
      const existing = this.activeSessions.get(userId)!;
      console.warn(
        `[SessionManager] User ${userId} already in ${existing.gameType} game`,
      );
      return false;
    }

    this.activeSessions.set(userId, {
      userId,
      gameType,
      wsId,
      joinedAt: Date.now(),
    });

    console.log(`[SessionManager] User ${userId} joined ${gameType} game`);
    return true;
  }

  /**
   * Unregister a user leaving a game
   */
  unregisterUser(userId: string): void {
    if (this.activeSessions.has(userId)) {
      const session = this.activeSessions.get(userId)!;
      this.activeSessions.delete(userId);
      console.log(
        `[SessionManager] User ${userId} left ${session.gameType} game`,
      );
    }
  }

  /**
   * Check if user is in any game
   */
  isUserInGame(userId: string): boolean {
    return this.activeSessions.has(userId);
  }

  /**
   * Get user's current session (if any)
   */
  getUserSession(userId: string): UserSession | undefined {
    return this.activeSessions.get(userId);
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): UserSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Clear all sessions (for shutdown)
   */
  clearAll(): void {
    this.activeSessions.clear();
    console.log("[SessionManager] All sessions cleared");
  }
}

// Export singleton instance
export const sessionManager = new SessionManager();
