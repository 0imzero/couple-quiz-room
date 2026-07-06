import type { Config, Context } from "@netlify/functions";

type Score = {
  title: string;
  score: number | null;
  paired: number;
};

type Payload = {
  participants: Array<{ side: "male" | "female"; nickname: string }>;
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

const providerDefaults = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    model: "qwen-plus",
  },
};

function getEnv(name: string) {
  const netlifyEnv = (globalThis as { Netlify?: { env?: { get(name: string): string | undefined } } }).Netlify;
  return netlifyEnv?.env?.get(name) ?? process.env[name];
}

function fallbackReport(payload: Payload): Report {
  const scored = payload.scores.filter((score) => score.score !== null);
  const average = scored.length
    ? Math.round(scored.reduce((sum, score) => sum + (score.score ?? 0), 0) / scored.length)
    : null;
  const weakest = scored.slice().sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
  const strongest = scored.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];

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

  const payload = (await req.json()) as Payload;
  const provider = (getEnv("AI_PROVIDER") ?? "deepseek").toLowerCase();
  const apiKey = getEnv("AI_API_KEY");
  const baseUrl =
    getEnv("AI_BASE_URL") ??
    providerDefaults[provider as keyof typeof providerDefaults]?.baseUrl ??
    providerDefaults.deepseek.baseUrl;
  const model =
    getEnv("AI_MODEL") ??
    providerDefaults[provider as keyof typeof providerDefaults]?.model ??
    providerDefaults.deepseek.model;

  if (!apiKey) {
    return Response.json(fallbackReport(payload));
  }

  const prompt = {
    role: "user",
    content: [
      "你是一个成熟、克制、务实的情侣同居沟通分析助手。",
      "请基于双方 1-5 分态度、备注和分区得分，输出精简但完整的中文评价。",
      "1=完全 no，2=偏 no，3=无所谓，4=偏 yes，5=完全 yes。",
      "不要制造焦虑，不要下定论说适不适合，只指出高一致区、风险区和建议沟通的问题。",
      "只返回 JSON，结构必须是：",
      '{"summary":"一句话总评","sections":[{"title":"分区名","score":80,"comment":"一句话"}],"full":"完整评价，200-500 字"}',
      JSON.stringify({
        participants: payload.participants,
        scores: payload.scores,
        answers: compactAnswers(payload),
      }),
    ].join("\n"),
  };

  const response = await fetch(baseUrl, {
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
          content: "你只输出可解析 JSON，不输出 Markdown，不输出额外解释。",
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

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    return Response.json({ error: "AI provider returned an empty response" }, { status: 502 });
  }

  return Response.json(extractJson(content));
};

export const config: Config = {
  path: "/api/analyze",
  method: ["POST"],
};
