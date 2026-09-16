// Part kinds, form groups and fields of the pulley contract v3.
//
// Everything about a field that the contract already defines (limits, defaults,
// integer or not) is read from the JSON Schema through `schema`; this file adds
// only presentation: group, label, drawing symbol, hint and applicability. A label
// or hint may be a function of the description when its meaning depends on it.
// `schema: [def, property]` points at $defs[def].properties[property].

export const KINDS = [
  { id: "timingPulley", title: "Шкив GT2", text: "Зубчатый шкив под ремень GT2 с шагом 2 мм.", experimental: true },
  { id: "idlerPulley", title: "Гладкий шкив", text: "Ролик без зубьев: натяжитель или обводной ролик ремня." }
];

export function kindOf(description) {
  return KINDS.find(({ id }) => id === description?.kind) ?? KINDS[0];
}

const isIdler = (description) => description?.kind === "idlerPulley";

/** Words for the rim of the kind: a toothed rim ("венец", "зубчатая часть") or a smooth one ("обод"). */
function rimWords(description) {
  return isIdler(description)
    ? { body: "обод", bodyOf: "обода", part: "обод", partOf: "обода", surface: "поверхности обода" }
    : { body: "венец", bodyOf: "венца", part: "зубчатая часть", partOf: "зубчатой части", surface: "вершин зубьев" };
}

export const GROUPS = [
  { id: "presets", title: "Варианты" },
  { id: "rim", title: (description) => isIdler(description) ? "Ремень и обод" : "Ремень и зубья" },
  { id: "flanges", title: "Фланцы" },
  { id: "web", title: "Полотно и спицы" },
  { id: "hub", title: "Втулка" },
  { id: "bore", title: "Отверстие под вал" },
  { id: "generation", title: "Точность модели" }
];

export function groupTitle(group, description) {
  return typeof group.title === "function" ? group.title(description) : group.title;
}

const isSpokes = (description) => description.web?.type === "spokes";
const hasBore = (...shapes) => (description) => shapes.includes(description.bore?.shape);
const hasFlange = (side) => (description) => Boolean(description.flanges?.[side]);

export const FIELDS = [
  {
    path: "/rim/toothCount", group: "rim", schema: ["timingRim", "toothCount"], applies: (description) => !isIdler(description),
    label: "Число зубьев", symbol: "N",
    hint: "Число канавок под зубья ремня GT2 с шагом 2 мм. Делительный диаметр равен 2N/π."
  },
  {
    path: "/rim/outerDiameter", group: "rim", schema: ["idlerRim", "outerDiameter"], applies: isIdler,
    label: "Диаметр обода", symbol: "D", unit: "мм",
    hint: "Гладкая цилиндрическая поверхность, по которой идёт ремень."
  },
  {
    path: "/rim/width", group: "rim", schema: ["rimPlacement", "width"],
    label: (description) => isIdler(description) ? "Ширина обода" : "Ширина зубчатой части", symbol: "W", unit: "мм",
    hint: "Обычно на 0,5–1 мм шире ремня. Фланцы и выступы втулки в неё не входят."
  },
  {
    path: "/rim/radialThickness", group: "rim", schema: ["rimPlacement", "radialThickness"],
    label: (description) => `Толщина ${rimWords(description).bodyOf}`, symbol: "T_r", unit: "мм",
    hint: (description) => isIdler(description)
      ? "Кольцо материала под поверхностью обода, внутрь до полотна или спиц."
      : "Кольцо материала под зубьями: от дна канавок внутрь до полотна или спиц."
  },
  {
    path: "/flanges/lower", group: "flanges", kind: "toggle",
    label: "Нижний фланец", hint: (description) => `Бортик под ${isIdler(description) ? "ободом" : "зубчатой частью"}, не даёт ремню соскочить вниз.`
  },
  {
    path: "/flanges/lower/axialThickness", group: "flanges", schema: ["flange", "axialThickness"], applies: hasFlange("lower"),
    label: "Толщина нижнего фланца", symbol: "T_f−", unit: "мм",
    hint: (description) => `Вдоль оси, вниз от нижнего торца ${rimWords(description).partOf}.`
  },
  {
    path: "/flanges/lower/radialExtension", group: "flanges", schema: ["flange", "radialExtension"], applies: hasFlange("lower"),
    label: "Выступ нижнего фланца", symbol: "E_f−", unit: "мм",
    hint: (description) => `На сколько фланец выше ${rimWords(description).surface}.`
  },
  {
    path: "/flanges/upper", group: "flanges", kind: "toggle",
    label: "Верхний фланец",
    hint: (description) => isIdler(description)
      ? "Бортик над ободом. При печати он нависает над ободом."
      : "Бортик над зубчатой частью. При печати он нависает над зубьями."
  },
  {
    path: "/flanges/upper/axialThickness", group: "flanges", schema: ["flange", "axialThickness"], applies: hasFlange("upper"),
    label: "Толщина верхнего фланца", symbol: "T_f+", unit: "мм",
    hint: (description) => `Вдоль оси, вверх от верхнего торца ${rimWords(description).partOf}.`
  },
  {
    path: "/flanges/upper/radialExtension", group: "flanges", schema: ["flange", "radialExtension"], applies: hasFlange("upper"),
    label: "Выступ верхнего фланца", symbol: "E_f+", unit: "мм",
    hint: (description) => `На сколько фланец выше ${rimWords(description).surface}.`
  },
  {
    path: "/web/type", group: "web", kind: "choice",
    label: (description) => `Соединение ${rimWords(description).bodyOf} и втулки`,
    options: [{ value: "solid", label: "Сплошное полотно" }, { value: "spokes", label: "Спицы" }],
    hint: "Сплошной диск или прямые спицы со скруглениями."
  },
  {
    path: "/web/axialThickness", group: "web", schema: ["webPlacement", "axialThickness"],
    label: (description) => isSpokes(description) ? "Толщина спиц" : "Толщина полотна", symbol: "T_w", unit: "мм",
    hint: (description) => `Вдоль оси. Равная ширине ${rimWords(description).partOf} толщина даёт сплошное тело.`
  },
  {
    path: "/web/axialOffset", group: "web", schema: ["webPlacement", "axialOffset"],
    label: (description) => isSpokes(description) ? "Смещение спиц" : "Смещение полотна", symbol: "Δz", unit: "мм",
    hint: (description) => `Средняя плоскость полотна относительно середины ${rimWords(description).partOf}, плюс — вверх. ` +
      `Полотно не должно выходить за торцы ${rimWords(description).bodyOf}.`
  },
  {
    path: "/web/count", group: "web", schema: ["spokeWeb", "count"], applies: isSpokes,
    label: "Число спиц", symbol: "N_s",
    hint: "Спицы расположены равномерно. Две спицы не поддерживаются."
  },
  {
    path: "/web/width", group: "web", schema: ["spokeWeb", "width"], applies: isSpokes,
    label: "Ширина спицы", symbol: "B_s", unit: "мм",
    hint: "Поперёк спицы, на прямом участке между скруглениями."
  },
  {
    path: "/web/filletRadius", group: "web", schema: ["spokeWeb", "filletRadius"], applies: isSpokes,
    label: "Радиус скруглений", symbol: "R_f", unit: "мм",
    hint: "Плавный переход спицы во втулку и в венец. Не больше половины ширины спицы."
  },
  {
    path: "/hub/outerDiameter", group: "hub", schema: ["hub", "outerDiameter"],
    label: "Диаметр втулки", symbol: "D_h", unit: "мм",
    hint: "Наружный диаметр цилиндрической втулки вокруг отверстия."
  },
  {
    path: "/hub/lowerExtension", group: "hub", schema: ["hub", "lowerExtension"],
    label: "Выступ втулки вниз", symbol: "L_h−", unit: "мм",
    hint: (description) => `Ниже нижнего торца ${rimWords(description).partOf}. Ноль — вровень.`
  },
  {
    path: "/hub/upperExtension", group: "hub", schema: ["hub", "upperExtension"],
    label: "Выступ втулки вверх", symbol: "L_h+", unit: "мм",
    hint: (description) => `Выше верхнего торца ${rimWords(description).partOf}. Ноль — вровень.`
  },
  {
    path: "/bore/shape", group: "bore", kind: "choice",
    label: "Форма отверстия",
    options: [
      { value: "round", label: "Круглое" },
      { value: "polygon", label: "Многоугольное" },
      { value: "dFlat", label: "D-образное" },
      { value: "keyed", label: "Со шпоночным пазом" }
    ],
    hint: "Сквозное отверстие под вал. Лыска, паз и одна грань многоугольника на чертеже смотрят вправо."
  },
  {
    path: "/bore/diameter", group: "bore", schema: ["borePlacement", "diameter"],
    label: (description) => description.bore?.shape === "polygon" ? "Диаметр описанной окружности" : "Диаметр отверстия", symbol: "d", unit: "мм",
    hint: (description) => description.bore?.shape === "polygon"
      ? "Окружность проходит через все вершины. При чётном числе граней это размер между противоположными углами."
      : "Зазор закладывайте сами: напечатанное отверстие обычно выходит меньше."
  },
  {
    path: "/bore/sides", group: "bore", schema: ["borePlacement", "sides"], applies: hasBore("polygon"),
    label: "Число граней", symbol: "n",
    hint: "Правильный многоугольник: 4 — квадрат, 6 — шестигранник."
  },
  {
    path: "/bore/flatDistance", group: "bore", schema: ["borePlacement", "flatDistance"], applies: hasBore("dFlat"),
    label: "Размер по лыске", symbol: "s", unit: "мм",
    hint: "От лыски до противоположной стороны отверстия. Больше половины диаметра и меньше диаметра."
  },
  {
    path: "/bore/keyWidth", group: "bore", schema: ["borePlacement", "keyWidth"], applies: hasBore("keyed"),
    label: "Ширина паза", symbol: "b", unit: "мм",
    hint: "Ширина шпонки плюс зазор. Меньше диаметра отверстия."
  },
  {
    path: "/bore/keyDepth", group: "bore", schema: ["borePlacement", "keyDepth"], applies: hasBore("keyed"),
    label: "Глубина паза", symbol: "t", unit: "мм",
    hint: "От окружности отверстия до дна паза, по оси паза. В таблицах шпонок это глубина паза во втулке t₂."
  },
  {
    path: "/generation/maxChordError", group: "generation", schema: ["generation", "maxChordError"],
    label: "Допуск хорды", symbol: "ε", unit: "мм",
    hint: "На сколько отрезки сетки могут отходить от точной окружности. Меньше — глаже и тяжелее файл. Это настройка сетки, а не размер детали."
  }
];

export const FIELD_BY_PATH = new Map(FIELDS.map((field) => [field.path, field]));

export function fieldLabel(field, description) {
  return typeof field.label === "function" ? field.label(description) : field.label;
}

export function fieldHint(field, description) {
  return typeof field.hint === "function" ? field.hint(description) : field.hint;
}

export function isApplicable(field, description) {
  return field.applies ? field.applies(description) : true;
}

export function fieldsOf(group, description) {
  return FIELDS.filter((field) => field.group === group && isApplicable(field, description));
}

/** Limits and defaults of a numeric field, straight from the JSON Schema. */
export function fieldSchema(schema, field) {
  const [definition, property] = field.schema;
  const node = schema.$defs[definition].properties[property];
  return { minimum: node.minimum, maximum: node.maximum, integer: node.type === "integer", default: node.default };
}

/** Group of a diagnostic path: the field itself or the closest field above it. */
export function groupOfPath(path) {
  for (let candidate = path; candidate; candidate = candidate.slice(0, candidate.lastIndexOf("/"))) {
    const field = FIELD_BY_PATH.get(candidate);
    if (field) return field.group;
  }
  return path.startsWith("/rim") ? "rim" : null;
}
