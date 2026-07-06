import {
  ClipboardList,
  Copy,
  HeartHandshake,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { answerLabels, questions, sections } from "./data/questions";
import {
  clearSession,
  createLocalRoom,
  getLocalAnswers,
  getLocalParticipants,
  getLocalRoomByCode,
  loadSession,
  saveSession,
  submitLocalParticipant,
  upsertLocalAnswer,
  upsertLocalParticipant,
} from "./lib/localStore";
import { computeSectionScores, getAnswerMap, getPartnerSide, summarizeProgress } from "./lib/scoring";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import type { Answer, Participant, Room, Section, SectionScore, Session, Side } from "./types";

const referenceImages: Record<string, string> = {
  sleep: "/reference/sleep.png",
  chores: "/reference/chores.png",
  bathroom: "/reference/bathroom.png",
  food: "/reference/food.png",
  life: "/reference/life.png",
};

type ReportResult = {
  summary: string;
  sections: Array<{ title: string; score: number | null; comment: string }>;
  full: string;
};

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function sideLabel(side: Side) {
  return side === "male" ? "男生 side" : "女生 side";
}

function selfAnswersForSection(section: Section, answerMap: Map<number, Answer>) {
  return section.questionIds.filter((questionId) => answerMap.has(questionId)).length;
}

function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [activeSectionId, setActiveSectionId] = useState(sections[0].id);
  const [openNotes, setOpenNotes] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReportResult | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0];
  const selfSide = session?.participant.side ?? "male";
  const partnerSide = getPartnerSide(selfSide);
  const selfAnswers = getAnswerMap(answers, selfSide);
  const partnerAnswers = getAnswerMap(answers, partnerSide);
  const progress = summarizeProgress(answers);
  const selfParticipant = participants.find((participant) => participant.side === selfSide) ?? session?.participant;
  const partnerParticipant = participants.find((participant) => participant.side === partnerSide);
  const selfSubmitted = Boolean(selfParticipant?.submitted_at);
  const partnerSubmitted = Boolean(partnerParticipant?.submitted_at);
  const canRevealPartner = selfSubmitted && partnerSubmitted;
  const visibleAnswers = canRevealPartner ? answers : answers.filter((answer) => answer.side === selfSide);
  const scores = canRevealPartner ? computeSectionScores(visibleAnswers, selfSide) : [];
  const selfAnsweredCount = selfSide === "male" ? progress.maleAnswered : progress.femaleAnswered;
  const canSubmit = selfAnsweredCount === questions.length;

  const overallScore = useMemo(() => {
    const available = scores.filter((score) => score.score !== null);
    if (!canRevealPartner || !available.length) return null;
    return Math.round(available.reduce((sum, score) => sum + (score.score ?? 0), 0) / available.length);
  }, [canRevealPartner, scores]);

  useEffect(() => {
    if (!session) return;
    void loadRoomState(session.room.id);

    if (!supabase) return;
    const client = supabase;
    const channel = client
      .channel(`couple-room-${session.room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "couple_answers", filter: `room_id=eq.${session.room.id}` },
        () => void loadRoomState(session.room.id),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "couple_participants", filter: `room_id=eq.${session.room.id}` },
        () => void loadRoomState(session.room.id),
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [session?.room.id]);

  async function loadRoomState(roomId: string) {
    if (!supabase) {
      setParticipants(getLocalParticipants(roomId));
      setAnswers(getLocalAnswers(roomId));
      return;
    }

    const [{ data: participantRows, error: participantError }, { data: answerRows, error: answerError }] =
      await Promise.all([
        supabase.from("couple_participants").select("*").eq("room_id", roomId),
        supabase.from("couple_answers").select("*").eq("room_id", roomId),
      ]);

    if (participantError || answerError) {
      setNotice(participantError?.message ?? answerError?.message ?? "同步失败");
      return;
    }

    setParticipants((participantRows ?? []) as Participant[]);
    setAnswers((answerRows ?? []) as Answer[]);
  }

  async function upsertParticipant(room: Room, side: Side, nickname: string) {
    if (!supabase) return upsertLocalParticipant(room, side, nickname);

    const { data: existing, error: selectError } = await supabase
      .from("couple_participants")
      .select("*")
      .eq("room_id", room.id)
      .eq("side", side)
      .maybeSingle();

    if (selectError) throw new Error(selectError.message);
    if (existing) {
      const participant = existing as Participant;
      if (participant.nickname.trim() !== nickname.trim()) {
        throw new Error(`${sideLabel(side)} 已由「${participant.nickname}」使用，不能换名字登录。`);
      }
      return participant;
    }

    const { data, error } = await supabase
      .from("couple_participants")
      .insert({ room_id: room.id, side, nickname, client_token: crypto.randomUUID() })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as Participant;
  }

  async function createRoom(side: Side, nickname: string) {
    setLoading(true);
    setNotice("");
    try {
      const code = generateRoomCode();
      const room = supabase ? await createSupabaseRoom(code) : createLocalRoom(code);
      const participant = await upsertParticipant(room, side, nickname.trim());
      const next = { room, participant };
      saveSession(next);
      setSession(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建房间失败");
    } finally {
      setLoading(false);
    }
  }

  async function createSupabaseRoom(code: string): Promise<Room> {
    if (!supabase) throw new Error("Supabase 未配置");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const nextCode = attempt === 0 ? code : generateRoomCode();
      const { data, error } = await supabase.from("couple_rooms").insert({ code: nextCode }).select().single();
      if (!error && data) return data as Room;
      if (!error?.message.includes("duplicate")) throw new Error(error?.message ?? "房间创建失败");
    }
    throw new Error("房间码生成失败，请重试");
  }

  async function joinRoom(codeInput: string, side: Side, nickname: string) {
    setLoading(true);
    setNotice("");
    try {
      const code = normalizeCode(codeInput);
      if (code.length < 4) throw new Error("请输入有效的邀请码");

      const room = supabase ? await findSupabaseRoom(code) : getLocalRoomByCode(code);
      if (!room) throw new Error("没有找到这个房间码");

      const participant = await upsertParticipant(room, side, nickname.trim());
      const next = { room, participant };
      saveSession(next);
      setSession(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "加入房间失败");
    } finally {
      setLoading(false);
    }
  }

  async function findSupabaseRoom(code: string) {
    if (!supabase) return null;
    const { data, error } = await supabase.from("couple_rooms").select("*").eq("code", code).maybeSingle();
    if (error) throw new Error(error.message);
    return data as Room | null;
  }

  async function saveAnswer(questionId: number, patch: { value?: number; note?: string }) {
    if (!session) return;
    const existing = selfAnswers.get(questionId);
    const next: Answer = {
      ...existing,
      room_id: session.room.id,
      participant_id: session.participant.id,
      side: selfSide,
      question_id: questionId,
      value: patch.value ?? existing?.value ?? 3,
      note: patch.note ?? existing?.note ?? "",
    };

    setAnswers((current) => [
      ...current.filter(
        (answer) => !(answer.participant_id === next.participant_id && answer.question_id === next.question_id),
      ),
      next,
    ]);

    if (!supabase) {
      upsertLocalAnswer(next);
      setAnswers(getLocalAnswers(session.room.id));
      return;
    }

    const { data, error } = await supabase
      .from("couple_answers")
      .upsert(next, { onConflict: "participant_id,question_id" })
      .select()
      .single();

    if (error) {
      setNotice(error.message);
      return;
    }

    setAnswers((current) => [
      ...current.filter(
        (answer) => !(answer.participant_id === next.participant_id && answer.question_id === next.question_id),
      ),
      data as Answer,
    ]);
  }

  async function submitMyAnswers() {
    if (!session) return;
    if (!canSubmit) {
      setNotice(`你还有 ${questions.length - selfAnsweredCount} 题没答完，答完 50 题后才能提交。`);
      return;
    }

    if (!supabase) {
      const submitted = submitLocalParticipant(session.participant.id);
      if (submitted) {
        const next = { ...session, participant: submitted };
        saveSession(next);
        setSession(next);
      }
      await loadRoomState(session.room.id);
      setNotice("已提交。双方都提交后就能看到匹配度和对方备注。");
      return;
    }

    const { data, error } = await supabase
      .from("couple_participants")
      .update({ submitted_at: new Date().toISOString() })
      .eq("id", session.participant.id)
      .select()
      .single();

    if (error) {
      setNotice(error.message);
      return;
    }

    const next = { ...session, participant: data as Participant };
    saveSession(next);
    setSession(next);
    await loadRoomState(session.room.id);
    setNotice("已提交。双方都提交后就能看到匹配度和对方备注。");
  }

  function leaveRoom() {
    clearSession();
    setSession(null);
    setParticipants([]);
    setAnswers([]);
    setReport(null);
    setNotice("");
  }

  async function copyRoomCode() {
    if (!session) return;
    await navigator.clipboard.writeText(session.room.code);
    setNotice("邀请码已复制");
  }

  async function requestReport() {
    if (!session) return;
    if (!canRevealPartner) {
      setNotice("双方都提交后才能生成完整评价。");
      return;
    }
    setReportLoading(true);
    setNotice("");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: session.room,
          participants,
          answers: visibleAnswers,
          questions,
          scores,
          selfSide,
        }),
      });
      const payload = (await response.json()) as ReportResult | { error: string };
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "评价生成失败");
      setReport(payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "评价生成失败");
    } finally {
      setReportLoading(false);
    }
  }

  if (!session) {
    return <EntryScreen loading={loading} notice={notice} onCreate={createRoom} onJoin={joinRoom} />;
  }

  return (
    <main className="app-shell">
      <aside className="left-rail">
        <div className="brand-block">
          <div className="brand-mark">
            <HeartHandshake size={22} />
          </div>
          <div>
            <p className="eyebrow">Couple room</p>
            <h1>同居前的 50 个小问题</h1>
          </div>
        </div>

        <div className="room-card">
          <div>
            <span>房间码</span>
            <strong>{session.room.code}</strong>
          </div>
          <button className="icon-button" type="button" onClick={copyRoomCode} aria-label="复制房间码">
            <Copy size={18} />
          </button>
        </div>

        {!isSupabaseConfigured && (
          <div className="soft-alert">当前是本地预览模式。填入 Supabase 环境变量并部署后，数据会按提交状态展示。</div>
        )}

        <PartnerStatus
          self={selfParticipant}
          partner={partnerParticipant}
          progress={progress}
          selfSide={selfSide}
          selfSubmitted={selfSubmitted}
          partnerSubmitted={partnerSubmitted}
        />

        <button className="primary-button wide submit-button" type="button" disabled={!canSubmit} onClick={submitMyAnswers}>
          <Send size={16} />
          {selfSubmitted ? "重新提交当前答案" : "提交我的答案"}
        </button>
        {!canSubmit && <p className="helper-text">已答 {selfAnsweredCount}/50，答完后才能提交。</p>}

        <nav className="section-nav" aria-label="问答分区">
          {sections.map((section) => {
            const score = scores.find((item) => item.sectionId === section.id);
            const answered = selfAnswersForSection(section, selfAnswers);
            return (
              <button
                key={section.id}
                className={section.id === activeSection.id ? "section-pill active" : "section-pill"}
                type="button"
                style={{ "--section-color": section.color } as React.CSSProperties}
                onClick={() => setActiveSectionId(section.id)}
              >
                <span>{section.shortTitle}</span>
                <small>
                  {answered}/10 · {canRevealPartner ? (score?.score ?? "--") : "提交后"}
                </small>
              </button>
            );
          })}
        </nav>

        <button className="ghost-button" type="button" onClick={leaveRoom}>
          <RefreshCw size={16} />
          切换房间
        </button>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">现在身份：{sideLabel(selfSide)}</p>
            <h2>{activeSection.title}</h2>
          </div>
          <div className="overall-score">
            <span>匹配度</span>
            <strong>{canRevealPartner ? (overallScore ?? "--") : "--"}</strong>
          </div>
        </header>

        <div className="progress-ribbons" aria-label="双方答题进度">
          <Ribbon label="男生" value={progress.maleAnswered} total={progress.total} color="#4f8cff" />
          <Ribbon label="女生" value={progress.femaleAnswered} total={progress.total} color="#ff6e8f" />
        </div>

        {!canRevealPartner && (
          <div className="soft-alert">双方都完成 50 题并提交后，才会显示对方答案、备注、匹配度和 AI 评价。</div>
        )}
        {notice && <div className="notice">{notice}</div>}

        <div className="content-grid">
          <div className="question-list">
            {questions
              .filter((question) => question.sectionId === activeSection.id)
              .map((question) => {
                const answer = selfAnswers.get(question.id);
                const partnerAnswer = canRevealPartner ? partnerAnswers.get(question.id) : undefined;
                const isNoteOpen = openNotes.has(question.id);
                return (
                  <QuestionCard
                    key={question.id}
                    questionId={question.id}
                    questionText={question.text}
                    answer={answer}
                    partnerAnswer={partnerAnswer}
                    noteOpen={isNoteOpen}
                    revealPartner={canRevealPartner}
                    onToggleNote={() =>
                      setOpenNotes((current) => {
                        const next = new Set(current);
                        if (next.has(question.id)) next.delete(question.id);
                        else next.add(question.id);
                        return next;
                      })
                    }
                    onValueChange={(value) => void saveAnswer(question.id, { value })}
                    onNoteChange={(note) => void saveAnswer(question.id, { note })}
                  />
                );
              })}
          </div>

          <aside className="insight-panel">
            <div className="reference-frame">
              <img src={referenceImages[activeSection.id]} alt={`${activeSection.shortTitle} 原始题图`} />
            </div>

            <section className="score-board">
              <div className="panel-heading">
                <ClipboardList size={18} />
                <h3>分区得分</h3>
              </div>
              {canRevealPartner ? (
                scores.map((score) => <ScoreLine key={score.sectionId} score={score} />)
              ) : (
                <p className="muted-copy">提交前只显示双方进度，不显示匹配度。</p>
              )}
            </section>

            <section className="report-box">
              <div className="panel-heading">
                <Sparkles size={18} />
                <h3>完整评价</h3>
              </div>
              <button className="primary-button wide" type="button" onClick={requestReport} disabled={reportLoading || !canRevealPartner}>
                {reportLoading ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
                生成评价
              </button>
              {report && (
                <div className="report-content">
                  <strong>{report.summary}</strong>
                  <p>{report.full}</p>
                </div>
              )}
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function QuestionCard({
  questionId,
  questionText,
  answer,
  partnerAnswer,
  noteOpen,
  revealPartner,
  onToggleNote,
  onValueChange,
  onNoteChange,
}: {
  questionId: number;
  questionText: string;
  answer?: Answer;
  partnerAnswer?: Answer;
  noteOpen: boolean;
  revealPartner: boolean;
  onToggleNote: () => void;
  onValueChange: (value: number) => void;
  onNoteChange: (note: string) => void;
}) {
  const [noteDraft, setNoteDraft] = useState(answer?.note ?? "");
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) setNoteDraft(answer?.note ?? "");
  }, [answer?.note, isFocused]);

  useEffect(() => {
    if (!isFocused) return;
    const timer = window.setTimeout(() => onNoteChange(noteDraft), 600);
    return () => window.clearTimeout(timer);
  }, [isFocused, noteDraft]);

  return (
    <article className="question-card">
      <div className="question-topline">
        <span className="question-number">{String(questionId).padStart(2, "0")}</span>
        <p>{questionText}</p>
      </div>

      <div className="slider-row">
        <input
          aria-label={`${questionText} 答案`}
          min={1}
          max={5}
          step={1}
          type="range"
          value={answer?.value ?? 3}
          onChange={(event) => onValueChange(Number(event.currentTarget.value))}
        />
        <strong>{answerLabels[(answer?.value ?? 3) - 1]}</strong>
      </div>

      <div className="answer-meta">
        <span>对方：{revealPartner ? (partnerAnswer ? answerLabels[partnerAnswer.value - 1] : "未作答") : "已答状态提交后可见"}</span>
        <button type="button" className={answer?.note ? "note-toggle filled" : "note-toggle"} onClick={onToggleNote}>
          <MessageSquareText size={16} />
          备注
        </button>
      </div>

      {noteOpen && (
        <textarea
          rows={3}
          placeholder="补充你的边界、原因或可接受条件"
          value={noteDraft}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setIsFocused(false);
            onNoteChange(noteDraft);
          }}
          onChange={(event) => setNoteDraft(event.currentTarget.value)}
        />
      )}

      {revealPartner && partnerAnswer?.note && <div className="partner-note">对方备注：{partnerAnswer.note}</div>}
    </article>
  );
}

function ScoreLine({ score }: { score: SectionScore }) {
  return (
    <div className="score-line">
      <span>{score.title}</span>
      <meter min={0} max={100} value={score.score ?? 0} />
      <strong>{score.score ?? "--"}</strong>
    </div>
  );
}

function EntryScreen({
  loading,
  notice,
  onCreate,
  onJoin,
}: {
  loading: boolean;
  notice: string;
  onCreate: (side: Side, nickname: string) => Promise<void>;
  onJoin: (code: string, side: Side, nickname: string) => Promise<void>;
}) {
  const [side, setSide] = useState<Side>("female");
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const canSubmit = nickname.trim().length > 0 && !loading;

  return (
    <main className="entry-screen">
      <section className="entry-copy">
        <p className="eyebrow">Shared home agreement</p>
        <h1>同居前的细节，先认真聊一次。</h1>
        <p>50 个问题，5 档态度。双方提交前只展示进度；提交后再查看分区差异，并生成一份 AI 评价。</p>
        <div className="mini-gallery" aria-label="题目分区预览">
          {sections.map((section) => (
            <img key={section.id} src={referenceImages[section.id]} alt={`${section.shortTitle} 分区预览`} />
          ))}
        </div>
      </section>

      <section className="entry-panel">
        <div className="panel-heading">
          <UsersRound size={20} />
          <h2>进入答题房间</h2>
        </div>

        <label>
          选择你的 side
          <div className="segmented">
            <button className={side === "female" ? "selected" : ""} type="button" onClick={() => setSide("female")}>
              女生
            </button>
            <button className={side === "male" ? "selected" : ""} type="button" onClick={() => setSide("male")}>
              男生
            </button>
          </div>
        </label>

        <label>
          昵称
          <input value={nickname} placeholder="例如：小林" onChange={(event) => setNickname(event.target.value)} />
        </label>

        <button className="primary-button" disabled={!canSubmit} type="button" onClick={() => onCreate(side, nickname)}>
          {loading ? <Loader2 className="spin" size={17} /> : <HeartHandshake size={17} />}
          创建新房间
        </button>

        <div className="join-row">
          <input
            value={roomCode}
            placeholder="输入对方的邀请码"
            onChange={(event) => setRoomCode(normalizeCode(event.target.value))}
          />
          <button disabled={!canSubmit || roomCode.length < 4} type="button" onClick={() => onJoin(roomCode, side, nickname)}>
            加入
          </button>
        </div>

        {notice && <div className="notice">{notice}</div>}
        {!isSupabaseConfigured && <div className="soft-alert">未检测到 Supabase 配置；当前创建的是本地预览房间。</div>}
      </section>
    </main>
  );
}

function PartnerStatus({
  self,
  partner,
  progress,
  selfSide,
  selfSubmitted,
  partnerSubmitted,
}: {
  self?: Participant;
  partner?: Participant;
  progress: ReturnType<typeof summarizeProgress>;
  selfSide: Side;
  selfSubmitted: boolean;
  partnerSubmitted: boolean;
}) {
  const selfDone = selfSide === "male" ? progress.maleAnswered : progress.femaleAnswered;
  const partnerDone = selfSide === "male" ? progress.femaleAnswered : progress.maleAnswered;

  return (
    <div className="partner-card">
      <div className="person-row">
        <UserRound size={18} />
        <div>
          <span>{self?.nickname ?? "我"}</span>
          <small>
            {sideLabel(selfSide)} · {selfDone}/50 · {selfSubmitted ? "已提交" : "未提交"}
          </small>
        </div>
      </div>
      <div className="person-row muted">
        <UserRound size={18} />
        <div>
          <span>{partner?.nickname ?? "等待对方加入"}</span>
          <small>
            {sideLabel(getPartnerSide(selfSide))} · {partnerDone}/50 · {partnerSubmitted ? "已提交" : "未提交"}
          </small>
        </div>
      </div>
      <div className="paired-count">双方都提交后显示具体差异</div>
    </div>
  );
}

function Ribbon({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const percent = Math.round((value / total) * 100);
  return (
    <div className="ribbon">
      <span>{label}</span>
      <div className="ribbon-track">
        <div style={{ width: `${percent}%`, background: color }} />
      </div>
      <strong>{percent}%</strong>
    </div>
  );
}

export default App;
