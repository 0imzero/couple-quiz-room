import type { Answer, Participant, Room, Session, Side } from "../types";

const LOCAL_ROOM_KEY = "couple-quiz-local-room";
const LOCAL_SESSION_KEY = "couple-quiz-session";
const LOCAL_ANSWERS_KEY = "couple-quiz-local-answers";
const LOCAL_PARTICIPANTS_KEY = "couple-quiz-local-participants";

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function saveSession(session: Session) {
  writeJson(LOCAL_SESSION_KEY, session);
}

export function loadSession() {
  return readJson<Session | null>(LOCAL_SESSION_KEY, null);
}

export function clearSession() {
  localStorage.removeItem(LOCAL_SESSION_KEY);
}

export function createLocalRoom(code: string): Room {
  const room = { id: crypto.randomUUID(), code };
  writeJson(LOCAL_ROOM_KEY, room);
  return room;
}

export function getLocalRoomByCode(code: string) {
  const room = readJson<Room | null>(LOCAL_ROOM_KEY, null);
  return room?.code === code ? room : null;
}

export function upsertLocalParticipant(room: Room, side: Side, nickname: string): Participant {
  const participants = readJson<Participant[]>(LOCAL_PARTICIPANTS_KEY, []);
  const existing = participants.find((participant) => participant.room_id === room.id && participant.side === side);
  if (existing && existing.nickname.trim() !== nickname.trim()) {
    throw new Error(`${side === "male" ? "\u7537\u751f" : "\u5973\u751f"} side \u5df2\u6709\u4eba\u4f7f\u7528\u3002\u8bf7\u786e\u8ba4\u4f60\u9009\u62e9\u4e86\u81ea\u5df1\u7684 side\uff0c\u6216\u8054\u7cfb\u5bf9\u65b9\u91cd\u65b0\u786e\u8ba4\u623f\u95f4\u3002`);
  }
  const participant: Participant = existing
    ? { ...existing, nickname, updated_at: new Date().toISOString() }
    : {
        id: crypto.randomUUID(),
        room_id: room.id,
        side,
        nickname,
        client_token: crypto.randomUUID(),
        submitted_at: null,
        updated_at: new Date().toISOString(),
      };
  writeJson(LOCAL_PARTICIPANTS_KEY, [
    ...participants.filter((item) => item.id !== participant.id),
    participant,
  ]);
  return participant;
}

export function submitLocalParticipant(participantId: string) {
  const participants = readJson<Participant[]>(LOCAL_PARTICIPANTS_KEY, []);
  const participant = participants.find((item) => item.id === participantId);
  if (!participant) return null;
  const submitted = { ...participant, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  writeJson(LOCAL_PARTICIPANTS_KEY, [...participants.filter((item) => item.id !== participantId), submitted]);
  return submitted;
}

export function getLocalParticipants(roomId: string) {
  return readJson<Participant[]>(LOCAL_PARTICIPANTS_KEY, []).filter((participant) => participant.room_id === roomId);
}

export function getLocalAnswers(roomId: string) {
  return readJson<Answer[]>(LOCAL_ANSWERS_KEY, []).filter((answer) => answer.room_id === roomId);
}

export function upsertLocalAnswer(next: Answer) {
  const answers = readJson<Answer[]>(LOCAL_ANSWERS_KEY, []);
  const withId = {
    ...next,
    id: next.id ?? crypto.randomUUID(),
    updated_at: new Date().toISOString(),
  };
  writeJson(LOCAL_ANSWERS_KEY, [
    ...answers.filter(
      (answer) =>
        !(answer.participant_id === withId.participant_id && answer.question_id === withId.question_id),
    ),
    withId,
  ]);
  return withId;
}
