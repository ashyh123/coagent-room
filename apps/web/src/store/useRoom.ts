import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyRoomEvent,
  CardSpec,
  createInitialRoomState,
  MessageMeta,
  reduceRoomEvents,
  RoomEvent,
  RoomState,
  WsClientMessage,
  WsServerMessageSchema,
} from "@coagent/protocol";
import { loadCachedEvents, saveCachedEvents } from "./idb.js";

export interface SessionInfo {
  roomId: string;
  roomName: string;
  memberId: string;
  sessionToken: string;
  minConfirmations: number;
}

export function useRoom(session: SessionInfo | null) {
  const [state, setState] = useState<RoomState | null>(null);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastSeqRef = useRef(0);

  const send = useCallback((msg: WsClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!session) {
      setState(null);
      setEvents([]);
      setConnected(false);
      return;
    }

    let cancelled = false;
    let reconnectTimer: number | undefined;

    const init = async () => {
      const cached = await loadCachedEvents(session.roomId);
      if (cancelled) return;
      if (cached.length > 0) {
        lastSeqRef.current = cached[cached.length - 1].seq;
        setEvents(cached);
        setState(reduceRoomEvents(session.roomId, session.roomName, cached, session.minConfirmations));
      } else {
        lastSeqRef.current = 0;
        setEvents([]);
        setState(createInitialRoomState(session.roomId, session.roomName, session.minConfirmations));
      }

      const connect = () => {
        if (cancelled) return;
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${proto}//${window.location.host}/ws?token=${encodeURIComponent(session.sessionToken)}`);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          setLastError(null);
          ws.send(JSON.stringify({ type: "sync_from", afterSeq: lastSeqRef.current }));
        };

        ws.onmessage = (ev) => {
          try {
            const parsed = WsServerMessageSchema.parse(JSON.parse(String(ev.data)));
            if (parsed.type === "events_batch") {
              if (parsed.events.length === 0) return;
              void saveCachedEvents(parsed.events);
              lastSeqRef.current = Math.max(
                lastSeqRef.current,
                parsed.events[parsed.events.length - 1].seq,
              );
              setEvents((prev) => {
                const seen = new Set(prev.map((e) => e.seq));
                const merged = [...prev, ...parsed.events.filter((e) => !seen.has(e.seq))].sort(
                  (a, b) => a.seq - b.seq,
                );
                return merged;
              });
              setState((prev) => {
                let next =
                  prev ??
                  createInitialRoomState(session.roomId, session.roomName, session.minConfirmations);
                for (const evt of parsed.events) {
                  next = applyRoomEvent(next, evt);
                }
                return next;
              });
            } else if (parsed.type === "event") {
              void saveCachedEvents([parsed.event]);
              lastSeqRef.current = Math.max(lastSeqRef.current, parsed.event.seq);
              setEvents((prev) =>
                prev.some((e) => e.seq === parsed.event.seq) ? prev : [...prev, parsed.event],
              );
              setState((prev) => {
                const base =
                  prev ??
                  createInitialRoomState(session.roomId, session.roomName, session.minConfirmations);
                return applyRoomEvent(base, parsed.event);
              });
            } else if (parsed.type === "error") {
              setLastError(parsed.message);
            }
          } catch {
            // ignore
          }
        };

        ws.onclose = () => {
          setConnected(false);
          if (!cancelled) {
            reconnectTimer = window.setTimeout(connect, 1500);
          }
        };
      };

      connect();
    };

    void init();

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [session]);

  return {
    state,
    events,
    connected,
    lastError,
    postMessage: (
      text: string,
      options?: { mentions?: string[]; refCardId?: string; meta?: MessageMeta },
    ) =>
      send({
        type: "post_message",
        text,
        mentions: options?.mentions ?? [],
        refCardId: options?.refCardId,
        meta: options?.meta,
      }),
    createCard: (spec: CardSpec) => send({ type: "create_card", spec }),
    updateCard: (cardId: string, spec: CardSpec) => send({ type: "update_card", cardId, spec }),
    confirmCard: (cardId: string, versionHash: string) =>
      send({ type: "confirm_card", cardId, versionHash }),
    reviewCard: (cardId: string, outputId: string, decision: "accepted" | "changes_requested") =>
      send({ type: "review_card", cardId, outputId, decision }),
    stopAgent: (agentId: string, reason?: string) => send({ type: "stop_agent", agentId, reason }),
  };
}
