import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyRoomEvent,
  CardSpec,
  createInitialRoomState,
  MessageMeta,
  reduceRoomEvents,
  RoomEvent,
  RoomState,
  TopicAnchor,
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

  const askPrivateAgent = useCallback(
    async (input: {
      question: string;
      quote?: string;
      activeCardId?: string;
      topicId?: string;
      model?: string;
    }): Promise<{ answer: string; source: "llm" | "local_context"; model?: string }> => {
      if (!session) {
        throw new Error("未加入房间，无法向私密助手提问");
      }
      const question = input.question.trim().slice(0, 2000);
      if (!question) {
        throw new Error("提问内容不能为空");
      }
      const payload: Record<string, string> = { question };
      if (input.quote?.trim()) payload.quote = input.quote.trim().slice(0, 1000);
      if (input.activeCardId?.trim()) payload.activeCardId = input.activeCardId.trim();
      if (input.topicId?.trim()) payload.topicId = input.topicId.trim();
      if (input.model?.trim()) payload.model = input.model.trim().slice(0, 100);

      const response = await fetch("/api/private-ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as {
        answer?: string;
        source?: "llm" | "local_context";
        model?: string;
        message?: string;
      };
      if (!response.ok || !data.answer) {
        throw new Error(data.message ?? `私密提问请求失败 (${response.status})`);
      }
      return {
        answer: data.answer,
        source: data.source === "llm" ? "llm" : "local_context",
        ...(data.model ? { model: data.model } : {}),
      };
    },
    [session],
  );

  return {
    state,
    events,
    connected,
    lastError,
    postMessage: (
      text: string,
      options?: { mentions?: string[]; refCardId?: string; meta?: MessageMeta; topicId?: string },
    ) =>
      send({
        type: "post_message",
        text,
        mentions: options?.mentions ?? [],
        refCardId: options?.refCardId,
        topicId: options?.topicId,
        meta: options?.meta,
      }),
    createTopic: (title: string, anchor?: TopicAnchor) =>
      send({
        type: "create_topic",
        title,
        anchor,
      }),
    createCard: (spec: CardSpec) => send({ type: "create_card", spec }),
    updateCard: (cardId: string, spec: CardSpec) => send({ type: "update_card", cardId, spec }),
    confirmCard: (cardId: string, versionHash: string) =>
      send({ type: "confirm_card", cardId, versionHash }),
    reviewCard: (cardId: string, outputId: string, decision: "accepted" | "changes_requested") =>
      send({ type: "review_card", cardId, outputId, decision }),
    stopAgent: (agentId: string, reason?: string) => send({ type: "stop_agent", agentId, reason }),
    askPrivateAgent,
  };
}
