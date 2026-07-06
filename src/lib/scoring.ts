import { questions, sections } from "../data/questions";
import type { Answer, SectionScore, Side } from "../types";

export function getAnswerMap(answers: Answer[], side: Side) {
  return new Map(
    answers.filter((answer) => answer.side === side).map((answer) => [answer.question_id, answer]),
  );
}

export function getPartnerSide(side: Side): Side {
  return side === "male" ? "female" : "male";
}

export function scorePair(selfValue: number, partnerValue: number) {
  if (selfValue === 3 || partnerValue === 3) return 100;
  return Math.max(0, 100 - Math.abs(selfValue - partnerValue) * 25);
}

export function computeSectionScores(answers: Answer[], selfSide: Side): SectionScore[] {
  const self = getAnswerMap(answers, selfSide);
  const partner = getAnswerMap(answers, getPartnerSide(selfSide));

  return sections.map((section) => {
    const selfValues = section.questionIds
      .map((questionId) => self.get(questionId)?.value)
      .filter((value): value is number => typeof value === "number");
    const partnerValues = section.questionIds
      .map((questionId) => partner.get(questionId)?.value)
      .filter((value): value is number => typeof value === "number");
    const pairedScores = section.questionIds
      .map((questionId) => {
        const selfValue = self.get(questionId)?.value;
        const partnerValue = partner.get(questionId)?.value;
        if (typeof selfValue !== "number" || typeof partnerValue !== "number") return null;
        return scorePair(selfValue, partnerValue);
      })
      .filter((value): value is number => value !== null);

    const average = (values: number[]) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const score = pairedScores.length
      ? Math.round(pairedScores.reduce((sum, value) => sum + value, 0) / pairedScores.length)
      : null;

    return {
      sectionId: section.id,
      title: section.shortTitle,
      selfAnswered: selfValues.length,
      partnerAnswered: partnerValues.length,
      paired: pairedScores.length,
      score,
      selfAverage: average(selfValues),
      partnerAverage: average(partnerValues),
    };
  });
}

export function summarizeProgress(answers: Answer[]) {
  const total = questions.length;
  const maleAnswered = new Set(answers.filter((answer) => answer.side === "male").map((answer) => answer.question_id))
    .size;
  const femaleAnswered = new Set(
    answers.filter((answer) => answer.side === "female").map((answer) => answer.question_id),
  ).size;

  return {
    total,
    maleAnswered,
    femaleAnswered,
    paired: questions.filter(
      (question) =>
        answers.some((answer) => answer.side === "male" && answer.question_id === question.id) &&
        answers.some((answer) => answer.side === "female" && answer.question_id === question.id),
    ).length,
  };
}
