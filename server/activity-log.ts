/**
 * Activity Log Service
 * 
 * In-memory buffer for backend events that can be viewed in the ContextViewer.
 * Provides visibility into what's happening: parser actions, engine commands,
 * LLM calls, AI decisions, etc.
 */

// =============================================================================
// TYPES
// =============================================================================

export type ActivityType =
    | 'parser'      // Player action parsing
    | 'engine'      // Combat engine actions
    | 'roll'        // Dice rolls
    | 'damage'      // Damage dealt
    | 'death'       // Entity died
    | 'ai'          // Enemy AI decisions
    | 'llm'         // LLM calls
    | 'narrator'    // Narrative generation
    | 'system'      // System events (combat start/end)
    | 'error';      // Errors

export interface ActivityLogEntry {
    id: string;
    timestamp: number;
    sessionId: number;
    type: ActivityType;
    message: string;
    details?: Record<string, unknown>;
}

// =============================================================================
// IN-MEMORY BUFFER
// =============================================================================

const MAX_ENTRIES_PER_SESSION = 100;
const sessionLogs: Map<number, ActivityLogEntry[]> = new Map();

let globalIdCounter = 0;

function generateId(): string {
    return `act_${Date.now()}_${++globalIdCounter}`;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Log an activity event
 */
export function logActivity(
    sessionId: number,
    type: ActivityType,
    message: string,
    details?: Record<string, unknown>
): void {
    const entry: ActivityLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        sessionId,
        type,
        message,
        details,
    };

    // Get or create session log
    let logs = sessionLogs.get(sessionId);
    if (!logs) {
        logs = [];
        sessionLogs.set(sessionId, logs);
    }

    // Add entry
    logs.push(entry);

    // Trim to max size (keep most recent)
    if (logs.length > MAX_ENTRIES_PER_SESSION) {
        logs.shift();
    }

    // Also log to console for server visibility
    const icon = getTypeIcon(type);
    console.log(`[Activity] ${icon} [Session ${sessionId}] ${message}`);
}

/**
 * Get activity log for a session
 */
export function getActivityLog(sessionId: number, limit: number = 50): ActivityLogEntry[] {
    const logs = sessionLogs.get(sessionId) || [];
    // Return most recent entries
    return logs.slice(-limit).reverse();
}

/**
 * Clear activity log for a session
 */
export function clearActivityLog(sessionId: number): void {
    sessionLogs.delete(sessionId);
}

/**
 * Clear all activity logs (e.g., on server restart)
 */
export function clearAllActivityLogs(): void {
    sessionLogs.clear();
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getTypeIcon(type: ActivityType): string {
    const icons: Record<ActivityType, string> = {
        parser: '🎯',
        engine: '⚔️',
        roll: '🎲',
        damage: '💥',
        death: '💀',
        ai: '🤖',
        llm: '🧠',
        narrator: '🎭',
        system: '📢',
        error: '❌',
    };
    return icons[type] || '📌';
}

// =============================================================================
// CONVENIENCE LOGGERS
// =============================================================================

export const activity = {
    parser: (sessionId: number, message: string, details?: Record<string, unknown>) =>
        logActivity(sessionId, 'parser', message, details),

    engine: (sessionId: number, message: string, details?: Record<string, unknown>) =>
        logActivity(sessionId, 'engine', message, details),

    roll: (sessionId: number, message: string, details?: Record<string, unknown>) =>
        logActivity(sessionId, 'roll', message, details),

    damage: (sessionId: number, message: string, details?: Record<string, unknown>) =>
        logActivity(sessionId, 'damage', message, details),

    death: (sessionId: number, message: string, details?: Record<string, unknown>) =>
        logActivity(sessionId, 'death', message, details),

    ai: (sessionId: number, message: string, details?: Record<string, unknown>) =>
        logActivity(sessionId, 'ai', message, details),

    llm: (sessionId: number, message: string, details?: Record<string, unknown>) =>
        logActivity(sessionId, 'llm', message, details),

    narrator: (sessionId: number, message: string, details?: Record<string, unknown>) =>
        logActivity(sessionId, 'narrator', message, details),

    system: (sessionId: number, message: string, details?: Record<string, unknown>) =>
        logActivity(sessionId, 'system', message, details),

    error: (sessionId: number, message: string, details?: Record<string, unknown>) =>
        logActivity(sessionId, 'error', message, details),
};
