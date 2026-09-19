// Gears — (c) 2026 Ivan Polyacov, Elastic License 2.0, see LICENSE
// Part kinds, form groups and fields of the pulley contract v5.
//
// Everything about a field that the contract already defines (limits, defaults,
// integer or not) is read from the JSON Schema through `schema`; this file adds
// only presentation: group, label, drawing symbol, hint and applicability. A label
// or hint may be a function of the description when its meaning depends on it.
// `schema: [def, property]` points at $defs[def].properties[property].

export const KINDS = [
  { id: "timingPulley", title: "Шкив GT2", text: "Зубчатый шкив под ремень GT2 с шагом 2 мм.", experimental: true },
  { id: "idlerPulley", title: "Гладкий шкив", text: "Ролик без зубьев: натяжитель или обводной ролик ремня." },
  { id: "gear", title: "Шестерня", text: "Эвольвентные зубья: прямые, косые или шевронные. Шестерни одной пары должны иметь одинаковые модуль, угол давления и угол наклона зуба." }
];

export function kindOf(description) {
  return KINDS.find(({ id }) => id === description?.kind) ?? KINDS[0];
}

const isIdler = (description) => description?.kind === "idlerPulley";
const isGear = (description) => description?.kind === "gear";
const isInclined = (description) => isGear(description) && description.rim?.helix !== "none";

/** Words for the rim of the kind: a toothed rim ("венец", "зубчатая часть") or a smooth one ("обод"). */
function rimWords(description) {
  if (isIdler(description)) return { body: "обод", bodyOf: "обода", part: "обод", partOf: "обода", surface: "поверхности обода" };
  if (isGear(description)) return { body: "венец", bodyOf: "венца", part: "венец", partOf: "венца", surface: "вершин зубьев" };
  return { body: "венец", bodyOf: "венца", part: "зубчатая часть", partOf: "зубчатой части", surface: "вершин зубьев" };
}

export const GROUPS = [
  { id: "presets", title: "Варианты" },
  { id: "rim", title: (description) => isIdler(description) ? "Ремень и обод" : isGear(description) ? "Зубья" : "Ремень и зубья" },
  // flanges past the tooth tips would stop the mating gear
  { id: "flanges", title: "Фланцы", applies: (description) => !isGear(description) },
  { id: "web", title: "Полотно и спицы" },
  { id: "hub", title: "Втулка" },
  { id: "bore", title: "Отверстие под вал" },
  { id: "generation", title: "Точность модели" }
];

/** Groups of the kind, the variants page included. */
export function groupsOf(description) {
  return GROUPS.filter((group) => !group.applies || group.applies(description));
}

export function groupTitle(group, description) {
  return typeof group.title === "function" ? group.title(description) : group.title;
}

const isSpokes = (description) => description.web?.type === "spokes";
const hasWeb = (description) => description.web?.type !== "none";
const hasBore = (...shapes) => (description) => shapes.includes(description.bore?.shape);
const hasFlange = (side) => (description) => Boolean(description.flanges?.[side]);

/** The faces of the part in words: flange far faces, or rim ends where there is no flange. */
function faceWords(description, side) {
  const end = `${side === "lower" ? "нижнего" : "верхнего"} торца ${rimWords(description).partOf}`;
  return isGear(description) ? end : `${side === "lower" ? "нижнего" : "верхнего"} фланца, а без него — ${end}`;
}

export const FIELDS = [
  {
    path: "/rim/module", group: "rim", schema: ["gearRim", "module"], applies: isGear,
    label: "Модуль", symbol: "m", unit: "мм",
    hint: (description) => isInclined(description)
      ? "Размер зуба поперёк зуба (нормальный модуль): высота зуба и его толщина те же, что у прямозубой шестерни этого модуля, а делительный диаметр больше в 1/cos β раз, mN/cos β. Шестерни одной пары должны иметь одинаковый модуль."
      : "Размер зуба: шаг по делительной окружности равен πm, делительный диаметр — mN. Шестерни одной пары должны иметь одинаковый модуль."
  },
  {
    path: "/rim/toothCount", group: "rim", schema: (description) => [isGear(description) ? "gearRim" : "timingRim", "toothCount"],
    applies: (description) => !isIdler(description),
    label: "Число зубьев", symbol: "N",
    hint: (description) => isGear(description)
      ? "Передаточное число пары равно отношению чисел зубьев."
      : "Число канавок под зубья ремня GT2 с шагом 2 мм. Делительный диаметр равен 2N/π."
  },
  {
    path: "/rim/pressureAngle", group: "rim", schema: ["gearRim", "pressureAngle"], applies: isGear,
    label: "Угол давления", symbol: "α", unit: "°",
    hint: (description) => "Наклон боковых сторон зуба в точке на делительной окружности. Стандарт — 20°; у пары он должен совпадать." +
      (isInclined(description) ? " У косого зуба угол задан поперёк зуба; в торцевом сечении на чертеже он больше." : "")
  },
  {
    path: "/rim/profileShift", group: "rim", schema: ["gearRim", "profileShift"], applies: isGear,
    label: "Коэффициент смещения", symbol: "x",
    hint: "Сдвигает зуб наружу на xm: он становится толще у основания и острее у вершины. Положительное смещение убирает подрезание у шестерни с малым числом зубьев."
  },
  {
    path: "/rim/backlash", group: "rim", schema: ["gearRim", "backlash"], applies: isGear,
    label: "Утонение зуба", symbol: "j", unit: "мм",
    hint: "На столько зуб тоньше расчётного по делительной окружности, поровну с каждой стороны. Зазор в паре равен сумме утонений обеих шестерён; для печати обычно 0,1–0,2 мм."
  },
  {
    path: "/rim/helix", group: "rim", kind: "choice", applies: isGear,
    label: "Зубья",
    options: [{ value: "none", label: "Прямые" }, { value: "helical", label: "Косые" }, { value: "herringbone", label: "Шеврон" }],
    hint: "Косые зубья входят в зацепление плавнее и тише прямых, но давят на вал вдоль оси. " +
      "Шеврон — две косые половины навстречу друг другу, осевые силы гасятся. Направление наклона задаёт знак угла."
  },
  {
    path: "/rim/helixAngle", group: "rim", schema: ["gearRim", "helixAngle"], applies: isInclined,
    label: "Угол наклона зуба", symbol: "β", unit: "°",
    hint: "Между зубом и осью на делительном цилиндре. Плюс — правые зубья: поднимаются против часовой стрелки, как правая резьба; минус — левые. У шеврона знак относится к нижней половине. " +
      "У пары величина одна, знаки разные: +20 работает с −20. Шеврон с противоположным знаком — та же деталь, перевёрнутая. Обычно 15–30°, у шеврона до 45°; больше угол — плавнее ход и больше осевая сила."
  },
  {
    path: "/rim/outerDiameter", group: "rim", schema: ["idlerRim", "outerDiameter"], applies: isIdler,
    label: "Диаметр обода", symbol: "D", unit: "мм",
    hint: "Гладкая цилиндрическая поверхность, по которой идёт ремень."
  },
  {
    path: "/rim/width", group: "rim", schema: ["rimPlacement", "width"],
    label: (description) => isIdler(description) ? "Ширина обода" : isGear(description) ? "Ширина венца" : "Ширина зубчатой части", symbol: "W", unit: "мм",
    hint: (description) => isGear(description)
      ? "Длина зуба вдоль оси. Выступы втулки в неё не входят."
      : "Обычно на 0,5–1 мм шире ремня. Фланцы и выступы втулки в неё не входят."
  },
  {
    path: "/rim/radialThickness", group: "rim", schema: ["rimPlacement", "radialThickness"], applies: hasWeb,
    // a radial size: "width" and "thickness" are both read as the size along the axis
    label: (description) => isIdler(description) ? "Стенка обода" : isGear(description) ? "Обод под зубьями" : "Обод под канавками", symbol: "T_r", unit: "мм",
    hint: (description) => isIdler(description)
      ? "Кольцо материала под поверхностью обода, по радиусу внутрь до полотна или спиц."
      : `Кольцо материала под ${isGear(description) ? "зубьями" : "канавками"}: по радиусу от ${isGear(description) ? "окружности впадин" : "дна канавок"} внутрь до полотна или спиц.`
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
    options: [{ value: "solid", label: "Сплошное" }, { value: "spokes", label: "Спицы" }, { value: "none", label: "Без полотна" }],
    hint: (description) => `Сплошной диск, прямые спицы со скруглениями или ничего: без полотна ${isIdler(description) ? "обод" : isGear(description) ? "зубья идут" : "зубчатая часть идёт"} прямо от втулки, как у маленькой шестерни на валу.`
  },
  {
    path: "/web/thinning", group: "web", schema: ["webPlacement", "thinning"], applies: hasWeb,
    label: (description) => isSpokes(description) ? "Утонение спиц" : "Утонение полотна", symbol: "t_w", unit: "мм",
    hint: (description) => isGear(description)
      ? "На сколько полотно тоньше венца. Ноль — сплошное тело во всю ширину."
      : "На сколько полотно тоньше детали вместе с фланцами. Ноль — полотно во всю высоту, заподлицо с фланцами."
  },
  {
    path: "/web/alignment", group: "web", kind: "choice", applies: hasWeb,
    label: (description) => isSpokes(description) ? "Спицы прижаты" : "Полотно прижато",
    options: [{ value: "lower", label: "К низу" }, { value: "center", label: "По центру" }, { value: "upper", label: "К верху" }],
    hint: "К низу — плоское основание для печати: полотно лежит в одной плоскости с нижним фланцем или торцом и втулкой."
  },
  {
    path: "/web/axialOffset", group: "web", schema: ["webPlacement", "axialOffset"], applies: hasWeb,
    label: (description) => isSpokes(description) ? "Сдвиг спиц" : "Сдвиг полотна", symbol: "Δz", unit: "мм",
    hint: "От выбранного положения, плюс — вверх. Обычно ноль; полотно не может выходить за низ и верх детали."
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
    hint: (description) => `Плавный переход спицы во втулку и в ${rimWords(description).body}. Не больше половины ширины спицы.`
  },
  {
    path: "/hub/outerDiameter", group: "hub", schema: ["hub", "outerDiameter"],
    label: "Диаметр втулки", symbol: "D_h", unit: "мм",
    hint: "Наружный диаметр цилиндрической втулки вокруг отверстия."
  },
  {
    path: "/hub/lowerExtension", group: "hub", schema: ["hub", "lowerExtension"],
    label: "Выступ втулки вниз", symbol: "L_h−", unit: "мм",
    hint: (description) => `Ниже ${faceWords(description, "lower")}. Ноль — вровень, минус — втулка короче.`
  },
  {
    path: "/hub/upperExtension", group: "hub", schema: ["hub", "upperExtension"],
    label: "Выступ втулки вверх", symbol: "L_h+", unit: "мм",
    hint: (description) => `Выше ${faceWords(description, "upper")}. Ноль — вровень, минус — втулка короче.`
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

/** Limits and defaults of a numeric field, straight from the JSON Schema; they may depend on the kind. */
export function fieldSchema(schema, field, description) {
  const [definition, property] = typeof field.schema === "function" ? field.schema(description) : field.schema;
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
