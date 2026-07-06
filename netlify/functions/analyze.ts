import type { Context } from "@netlify/functions";

type Score = {
  title: string;
  score: number | null;
  paired: number;
};

type AnalysisMode = "self" | "partner" | "couple";

type Payload = {
  mode?: AnalysisMode;
  participants: Array<{ side: "male" | "female"; nickname: string; submitted_at?: string | null }>;
  answers: Array<{ side: "male" | "female"; question_id: number; value: number; note: string }>;
  questions: Array<{ id: number; sectionId: string; text: string }>;
  scores: Score[];
  selfSide: "male" | "female";
};

type Report = {
  summary: string;
  sections: Array<{ title: string; score: number | null; comment: string }>;
  full: string;
};

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-pro";

const ANALYSIS_PROMPT_LINES = [
  "你是一个成熟、克制、务实的情侣同居沟通分析助手。",
  "请基于双方 1-5 分态度、备注和分区得分，输出精简但完整的中文评价。",
  "评分语义：1=完全 no，2=偏 no，3=无所谓/都可以，4=偏 yes，5=完全 yes。",
  "重要规则：只要任意一方在某题选择 3，就代表这题对他/她没有强边界，不应被解读成冲突。",
  "不要制造焦虑，不要下定论说适不适合，只指出高一致区、风险区和建议沟通的问题。",
  "请把备注看得比数字更重要：备注里出现条件、边界、例外时，要用温和语言总结。",
  "只返回 JSON，结构必须是：",
  "\u5982\u679c mode=self\uff0c\u53ea\u5206\u6790\u7528\u6237\u81ea\u5df1\u7684\u751f\u6d3b\u504f\u597d\u3001\u5f3a\u8fb9\u754c\u548c\u53ef\u6c9f\u901a\u70b9\uff0c\u4e0d\u8bc4\u4ef7\u5bf9\u65b9\u3002",
  "\u5982\u679c mode=partner\uff0c\u53ea\u5206\u6790\u5bf9\u65b9\u7b54\u6848\u5448\u73b0\u51fa\u7684\u504f\u597d\u548c\u8fb9\u754c\uff0c\u4e0d\u66ff\u7528\u6237\u505a\u4ef7\u503c\u5224\u65ad\u3002",
  "\u5982\u679c mode=couple\uff0c\u5206\u6790\u53cc\u65b9\u4e00\u81f4\u533a\u3001\u6f5c\u5728\u51b2\u7a81\u533a\u548c\u6700\u503c\u5f97\u5750\u4e0b\u6765\u804a\u7684\u9898\u76ee\u3002",
  '{"summary":"一句话总评","sections":[{"title":"分区名","score":80,"comment":"一句话"}],"full":"完整评价，200-500 字"}',
];

function getEnv(name: string) {
  const netlifyEnv = (globalThis as { Netlify?: { env?: { get(name: string): string | undefined } } }).Netlify;
  return netlifyEnv?.env?.get(name) ?? process.env[name];
}

function fallbackReport(payload: Payload): Report {
  const mode = payload.mode ?? "couple";
  const scored = payload.scores.filter((score) => score.score !== null);
  const average = scored.length
    ? Math.round(scored.reduce((sum, score) => sum + (score.score ?? 0), 0) / scored.length)
    : null;
  const weakest = scored.slice().sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
  const strongest = scored.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];

  if (mode !== "couple") {
    const answered = payload.answers.length;
    return {
      summary: mode === "self" ? "\u5df2\u751f\u6210\u4f60\u7684\u4e2a\u4eba\u504f\u597d\u6982\u89c8\u3002" : "\u5df2\u751f\u6210\u5bf9\u65b9\u7684\u504f\u597d\u6982\u89c8\u3002",
      sections: [],
      full: `\u5df2\u6574\u7406 ${answered} \u6761\u56de\u7b54\u3002\u8bf7\u91cd\u70b9\u770b\u5176\u4e2d\u7684\u5b8c\u5168 no / \u5b8c\u5168 yes\uff0c\u5b83\u4eec\u901a\u5e38\u4ee3\u8868\u66f4\u660e\u786e\u7684\u8fb9\u754c\uff1b\u9009\u62e9\u65e0\u6240\u8c13\u7684\u9898\u76ee\u66f4\u9002\u5408\u89c6\u4e3a\u5f39\u6027\u7a7a\u95f4\u3002`,
    };
  }

  return {
    summary: average === null ? "还需要双方多回答一些问题。" : `当前整体匹配度约 ${average} 分。`,
    sections: payload.scores.map((score) => ({
      title: score.title,
      score: score.score,
      comment:
        score.score === null
          ? "双方共同作答数量还不够。"
          : score.score >= 80
            ? "这个分区态度比较接近。"
            : score.score >= 55
              ? "这个分区有一些差异，适合继续聊边界。"
              : "这个分区差异明显，建议逐题确认可接受条件。",
    })),
    full:
      average === null
        ? "当前共同作答数量不足，建议先让双方至少完成同一分区，再生成完整评价。"
        : `你们已经能看到初步差异。最顺的部分是「${strongest?.title ?? "暂无"}」，最需要沟通的是「${
            weakest?.title ?? "暂无"
          }」。建议不要只看分数，优先打开低分题目的备注，把“不能接受”和“可以妥协的条件”分别写清楚。`,
  };
}

function compactAnswers(payload: Payload) {
  const male = payload.participants.find((participant) => participant.side === "male")?.nickname ?? "男生";
  const female = payload.participants.find((participant) => participant.side === "female")?.nickname ?? "女生";

  return payload.questions.map((question) => {
    const maleAnswer = payload.answers.find(
      (answer) => answer.side === "male" && answer.question_id === question.id,
    );
    const femaleAnswer = payload.answers.find(
      (answer) => answer.side === "female" && answer.question_id === question.id,
    );
    return {
      id: question.id,
      question: question.text,
      male: maleAnswer ? { name: male, value: maleAnswer.value, note: maleAnswer.note } : null,
      female: femaleAnswer ? { name: female, value: femaleAnswer.value, note: femaleAnswer.note } : null,
    };
  });
}

function extractJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("模型没有返回 JSON");
  return JSON.parse(raw.slice(start, end + 1)) as Report;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const payload = (await req.json()) as Payload;
    const apiKey = getEnv("AI_API_KEY");
    const model = DEFAULT_MODEL;

    if (!apiKey) {
      return Response.json(fallbackReport(payload));
    }

    const prompt = {
      role: "user",
      content: [
        ...ANALYSIS_PROMPT_LINES,
        JSON.stringify({
          mode: payload.mode ?? "couple",
          participants: payload.participants,
          scores: payload.scores,
          answers: compactAnswers(payload),
        }),
      ].join("\n"),
    };

    const response = await fetch(DEEPSEEK_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "\u4f60\u53ea\u8f93\u51fa\u53ef\u89e3\u6790 JSON\uff0c\u4e0d\u8f93\u51fa Markdown\uff0c\u4e0d\u8f93\u51fa\u989d\u5916\u89e3\u91ca\u3002",
          },
          prompt,
        ],
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return Response.json({ error: `AI provider error: ${text.slice(0, 500)}` }, { status: 502 });
    }

    const text = await response.text();
    let data: { choices?: Array<{ message?: { content?: string } }> };
    try {
      data = JSON.parse(text);
    } catch {
      return Response.json({ error: "AI provider did not return JSON." }, { status: 502 });
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return Response.json({ error: "AI provider returned an empty response" }, { status: 502 });
    }

    return Response.json(extractJson(content));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "AI \u5206\u6790\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002" },
      { status: 500 },
    );
  }
};
