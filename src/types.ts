export type Side = "male" | "female";

export type Section = {
  id: string;
  title: string;
  shortTitle: string;
  color: string;
  questionIds: number[];
};

export type Question = {
  id: number;
  sectionId: string;
  text: string;
};

export type Participant = {
  id: string;
  room_id: string;
  side: Side;
  nickname: string;
  client_token: string;
  submitted_at?: string | null;
  updated_at?: string;
};

export type Room = {
  id: string;
  code: string;
  created_at?: string;
};

export type Answer = {
  id?: string;
  room_id: string;
  participant_id: string;
  side: Side;
  question_id: number;
  value: number;
  note: string;
  updated_at?: string;
};

export type Session = {
  room: Room;
  participant: Participant;
};

export type SectionScore = {
  sectionId: string;
  title: string;
  selfAnswered: number;
  partnerAnswered: number;
  paired: number;
  score: number | null;
  selfAverage: number | null;
  partnerAverage: number | null;
};
