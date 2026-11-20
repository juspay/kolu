import {
  type AskAnswer,
  type AskField,
  type ConductorAskRow,
  YES_NO,
} from "kolu-common/conductor";

export interface AskRecordLine {
  readonly key: string;
  readonly question: string;
  readonly answer: string | null;
}

const JOIN = " · ";

export const askQuestions = (row: ConductorAskRow): ReadonlyArray<AskField> =>
  row.ask.fields.filter((field) => field.attachedTo === null);

const fieldsCarryTheQuestion = (row: ConductorAskRow): boolean => {
  const questions = askQuestions(row);
  return (
    questions.length > 0 && questions.every((field) => field.label !== null)
  );
};

export const askLead = (row: ConductorAskRow): string | null =>
  fieldsCarryTheQuestion(row) ? null : row.text;

const questionText = (
  row: ConductorAskRow,
  field: AskField,
  questions: ReadonlyArray<AskField>,
): string => {
  if (field.label !== null) return field.label;
  return questions.length === 1 ? row.text : field.key;
};

const valueText = (field: AskField, value: string): string => {
  const choice = field.choices.find((one) => one.value === value);
  if (choice !== undefined) return choice.label;
  if (field.kind === "boolean") {
    if (value === YES_NO.yes) return "Yes";
    if (value === YES_NO.no) return "No";
  }
  return value;
};

const valuesFor = (
  answers: ReadonlyArray<AskAnswer>,
  key: string,
): ReadonlyArray<string> =>
  answers.filter((answer) => answer.key === key).flatMap((one) => one.values);

export const askRecord = (
  row: ConductorAskRow,
): ReadonlyArray<AskRecordLine> => {
  const answers = row.ask.outcome?.answers ?? [];
  const questions = askQuestions(row);
  return questions.map((field) => {
    const other = row.ask.fields.find((one) => one.attachedTo === field.key);
    const values = [
      ...valuesFor(answers, field.key).map((value) => valueText(field, value)),
      ...(other === undefined
        ? []
        : valuesFor(answers, other.key).map((value) =>
            valueText(other, value),
          )),
    ];
    return {
      key: field.key,
      question: questionText(row, field, questions),
      answer: values.length === 0 ? null : values.join(JOIN),
    };
  });
};
