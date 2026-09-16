// Russian texts for contract diagnostics. The core returns only codes, paths and
// numeric details; every sentence a person reads is composed here.
import { formatNumber as n } from "./format.js";

const TEXTS = {
  E_SCHEMA_VERSION: () => "Файл другой версии формата: эта версия генератора понимает schemaVersion 1 и 2.",
  E_SCHEMA_VALUE: ({ rule, minimum, maximum }) => {
    if (rule === "numberRange") return `Нужно число от ${n(minimum)} до ${n(maximum)}.`;
    if (rule === "integerRange") return `Нужно целое число от ${minimum} до ${maximum}.`;
    if (rule === "additionalProperty") return "Лишнее поле, в формате его нет.";
    if (rule === "required") return "Не хватает обязательного поля.";
    return "Значение не подходит формату.";
  },
  E_RIM_NO_INTERIOR: ({ rimInnerRadius }) =>
    `Венец слишком толстый для такого числа зубьев: внутри не остаётся места (внутренний радиус ${n(rimInnerRadius)} мм).`,
  E_HUB_WALL: ({ wall, minimum }) =>
    `Стенка втулки вокруг отверстия в самом тонком месте ${n(wall)} мм, нужно не меньше ${n(minimum)} мм. Увеличьте диаметр втулки или уменьшите отверстие.`,
  E_BORE_FLAT: ({ minimum, maximum }) =>
    `Размер по лыске должен быть больше половины диаметра (${n(minimum)} мм) и меньше диаметра (${n(maximum)} мм): иначе лыска срезает ось или не касается отверстия.`,
  E_BORE_KEY: ({ maximum }) =>
    `Паз должен быть уже отверстия: ширина паза — меньше ${n(maximum)} мм.`,
  E_RADIAL_ORDER:({ span, minimum, maxHubDiameter }) =>
    `Между втулкой и венцом ${n(span)} мм, нужно не меньше ${n(minimum)} мм. ` +
    (maxHubDiameter > 0
      ? `Диаметр втулки — не больше ${n(maxHubDiameter)} мм, или возьмите больше зубьев либо тоньше венец.`
      : "Возьмите больше зубьев или тоньше венец."),
  E_WEB_AXIAL_RANGE: ({ webLowerZ, webUpperZ, rimLowerZ, rimUpperZ }) =>
    `Полотно выходит за зубчатую часть: оно занимает ${n(webLowerZ)}…${n(webUpperZ)} мм по высоте, а венец — ${n(rimLowerZ)}…${n(rimUpperZ)} мм.`,
  E_SPOKE_FILLET: ({ maxByWidth, maxBySpan }) => maxBySpan === undefined
    ? `Радиус скругления — не больше половины ширины спицы, ${n(maxByWidth)} мм.`
    : `Радиус скругления — не больше ${n(Math.min(maxByWidth, maxBySpan))} мм: он ограничен половиной ширины спицы (${n(maxByWidth)} мм) ` +
      `и половиной промежутка между втулкой и венцом (${n(maxBySpan)} мм).`,
  E_SPOKE_OVERLAP: ({ required, available }) =>
    `Спицы со скруглениями не помещаются у втулки: каждой нужно ${n(required)} мм по окружности втулки, а есть ${n(available)} мм. ` +
    "Уменьшите число спиц, их ширину или скругления либо увеличьте втулку.",
  W_THIN_FEATURE: ({ value, recommended }) =>
    `Тоньше ${n(recommended)} мм (сейчас ${n(value)} мм): модель построится, но проверьте, пропечатается ли такая стенка.`,
  W_EXPERIMENTAL_PROFILE: () =>
    "Профиль зубьев экспериментальный: шаг и наружный диаметр сверены с каталогом, форма канавки подтверждается только пробной печатью.",
  E_MESH_COMPLEXITY: () => "Слишком подробная сетка. Увеличьте допуск хорды.",
  E_SELF_INTERSECTION: () => "Контур спиц или окон получился самопересекающимся. Измените параметры спиц или допуск хорды.",
  E_DEGENERATE_TRIANGLE: () => "При построении получился вырожденный треугольник.",
  E_NON_MANIFOLD: () => "Построенная поверхность не замкнута.",
  E_BUILD_INTERNAL: () => "Внутренняя ошибка построения."
};

export function diagnosticText(diagnostic) {
  const text = TEXTS[diagnostic.code];
  return text ? text(diagnostic.details ?? {}) : diagnostic.code;
}

/** Warnings of phase "print" are advice, everything else with severity error blocks building. */
export function diagnosticKind(diagnostic) {
  if (diagnostic.severity === "error") return "error";
  return diagnostic.phase === "print" ? "advice" : "warning";
}
