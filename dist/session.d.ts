import type { AnanseConfig } from "./utils.js";
import type { Message, Session } from "./types.js";
export declare function createSession(config: AnanseConfig, personality: string | null, fileCount: number, name?: string): Session;
export declare function addMessage(session: Session, message: Message): Session;
export declare function saveSession(session: Session): Promise<void>;
export declare function loadSession(id: string): Promise<Session | null>;
export declare function loadSessionByName(name: string): Promise<Session | null>;
export declare function listSessions(): Promise<Session[]>;
export declare function listNamedSessions(): Promise<Session[]>;
//# sourceMappingURL=session.d.ts.map