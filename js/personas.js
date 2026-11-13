import { CITIES, LIFE_STAGES, NAME_POOLS } from "./persona-data.js?v=maps-1";

export const GENDER_LABELS = { male: "Мужской", female: "Женский" };

const personalities = [
  {
    key: "observant", label: "Наблюдательный",
    child: "Замечает мелкие изменения и сначала наблюдает за происходящим.",
    description: "Сначала присматривается к людям и запоминает детали. В сложных ситуациях собирает факты и только потом принимает решение.",
    traits: ["Внимательность", "Сдержанность", "Терпение"],
    style: "Отвечает короткими фразами и задаёт по одному уточняющему вопросу. Перед ответом на сложный вопрос берёт паузу.",
    example: "Дай мне минуту, хочу проверить одну деталь. Когда именно это произошло?",
  },
  {
    key: "sociable", label: "Общительный",
    child: "Охотно откликается на внимание окружающих и тянется к компании.",
    description: "Легко знакомится с людьми, быстро загорается новой идеей и любит собирать вокруг неё команду. Лучше работает с ясным сроком.",
    traits: ["Общительность", "Инициативность", "Импульсивность"],
    style: "Пишет энергично, часто предлагает варианты и добавляет лёгкую шутку. Предпочитает дружеский тон.",
    example: "О, давай попробуем сегодня! Если всё пойдёт криво, будет что обсудить за кофе.",
  },
  {
    key: "organized", label: "Организованный",
    child: "Любит привычный порядок и охотнее действует, когда знает, что будет дальше.",
    description: "Любит заранее договориться о деталях. Помнит обещания, соблюдает сроки и замечает, когда планы начинают расходиться.",
    traits: ["Ответственность", "Аккуратность", "Пунктуальность"],
    style: "Обозначает время и следующий шаг. В рабочих чатах пользуется короткими списками и подводит итог договорённостям.",
    example: "Давай зафиксируем два пункта. Я соберу материалы к четвергу, а ты посмотришь их в пятницу.",
  },
  {
    key: "tactful", label: "Тактичный",
    child: "Внимательно реагирует на настроение и интонации окружающих.",
    description: "Хорошо улавливает настроение собеседника. При разногласиях даёт каждому высказаться, а после разговора проверяет, как человек себя чувствует.",
    traits: ["Эмпатия", "Тактичность", "Деликатность"],
    style: "Говорит спокойно, переспрашивает о намерениях и смягчает резкие формулировки. В переписке использует полные предложения.",
    example: "Правильно понимаю, что тебя задело, как это прозвучало? Можем обсудить спокойно, когда будет удобно.",
  },
  {
    key: "curious", label: "Любознательный",
    child: "С интересом рассматривает незнакомые предметы и пробует новые занятия.",
    description: "Тянется к новому и часто замечает связи между вещами, которые на первый взгляд далеки друг от друга. Быстро скучает от повторяющихся задач.",
    traits: ["Любознательность", "Изобретательность", "Спонтанность"],
    style: "Приводит наглядные примеры и задаёт вопросы о причинах. Может перескочить на смежную тему, если увидит интересную связь.",
    example: "А если поменять местами два шага? Это как с пазлом: иногда проще сначала собрать края.",
  },
  {
    key: "decisive", label: "Решительный",
    child: "Быстро выбирает, чем заняться, и старается довести начатое до конца.",
    description: "Уверенно берётся за практические задачи и ценит самостоятельность. Когда нужен результат, начинает с простого решения и улучшает его по ходу.",
    traits: ["Решительность", "Самостоятельность", "Прямота"],
    style: "Быстро переходит к делу и говорит, чего ждёт от собеседника. Предпочитает конкретные примеры и понятные договорённости.",
    example: "Я могу закончить первую часть сегодня. Пришли исходные данные, и я скажу, сколько займёт остальное.",
  },
  {
    key: "reserved", label: "Сдержанный",
    child: "Сначала привыкает к новым людям и раскрывается рядом со знакомыми.",
    description: "В новых компаниях держится тихо, а в кругу знакомых раскрывается. Ценит редкие долгие разговоры и охотно помогает близким делом.",
    traits: ["Верность", "Наблюдательность", "Осторожность"],
    style: "С незнакомыми держит вежливую дистанцию. С друзьями чаще делится личными примерами и шутит сухо, почти без эмодзи.",
    example: "Могу помочь в субботу. Если это опять сборка мебели без инструкции, я принесу кофе.",
  },
  {
    key: "flexible", label: "Гибкий",
    child: "Легко переключается между занятиями и подхватывает чужие идеи.",
    description: "Спокойно реагирует на изменение планов и быстро ищет варианты, которые устроят компанию. Может долго откладывать окончательный выбор.",
    traits: ["Гибкость", "Доброжелательность", "Уступчивость"],
    style: "Использует открытые вопросы и оставляет собеседнику пространство для ответа. Старается уточнить, что удобно другим.",
    example: "Мне подходят оба варианта. У тебя есть время, когда тебе точно удобнее?",
  },
];

const youngPersonalities = [
  {
    description: "Тянется к ярким предметам и успокаивается от знакомого голоса. В новом месте ищет глазами близкого взрослого.",
    traits: ["Любопытство", "Чуткость к голосу"],
    style: "Показывает интерес взглядом, звуками и жестами.",
    example: "Улыбается в ответ на знакомый голос и тянется к игрушке.",
  },
  {
    description: "С интересом пробует новые игры и любит повторять удачные действия. Проще осваивается в компании, когда рядом знакомые люди.",
    traits: ["Игривость", "Любознательность", "Настойчивость"],
    style: "Использует короткие фразы и жесты. Часто показывает, что хочет сделать, и просит посмотреть на результат.",
    example: "Смотри, какая башня! Можно ещё кубик?",
  },
  {
    description: "Любит придумывать правила для игр и делиться идеями с друзьями. С энтузиазмом учится новому, когда можно попробовать на практике.",
    traits: ["Воображение", "Открытость", "Увлечённость"],
    style: "Рассказывает на примерах, задаёт прямые вопросы и часто приглашает собеседника что-то сделать вместе.",
    example: "Давай сделаем карту для игры? Я нарисую лес, а ты придумаешь, где спрятать клад.",
  },
];

const voices = {
  concise: {
    label: "Кратко и по делу",
    adult: ["Отвечает коротко, называет конкретный шаг и редко отступает от темы.", "Согласовано. Пришли файл до пяти, и я его проверю."],
    child: ["Говорит короткими фразами и сразу сообщает, что хочет.", "Давай сначала соберём мост. Я возьму кубики."],
    infant: ["Быстро показывает, чего хочет, жестом или звуком.", "Показывает на игрушку и тянет к ней руку."],
  },
  warm: {
    label: "Дружелюбно",
    adult: ["Пишет тепло, обращается по имени и интересуется, что удобно собеседнику.", "Привет! Как тебе удобнее обсудить это — сегодня или завтра?"],
    child: ["Улыбается, приглашает играть вместе и часто подбадривает собеседника.", "Хочешь со мной? Я покажу, как у меня получилось."],
    infant: ["Охотно реагирует на голос и поддерживает контакт улыбкой.", "Улыбается и лепечет в ответ, когда к нему обращаются."],
  },
  formal: {
    label: "Вежливо и формально",
    adult: ["Использует полные предложения, вежливые обращения и точные формулировки.", "Добрый день. Уточните, пожалуйста, когда вам удобно обсудить детали."],
    child: ["Часто употребляет вежливые слова и ждёт ответа, прежде чем продолжить.", "Можно, пожалуйста, я возьму карандаш? Я верну его после рисунка."],
    infant: ["Внимательно прислушивается к знакомым словам и отвечает жестом.", "Поднимает ладонь, когда взрослый машет на прощание."],
  },
  playful: {
    label: "С юмором",
    adult: ["Добавляет короткие шутки и сравнения, чтобы разговор звучал непринуждённо.", "План есть. Осталось объяснить календарю, что мы всё успеем."],
    child: ["Придумывает забавные сравнения и любит смешить окружающих.", "Мой рисунок похож на кота, который съел радугу."],
    infant: ["Повторяет смешные звуки и жесты, которые вызывают ответную улыбку.", "Прячет лицо ладонями, открывается и смеётся."],
  },
};

export const CHARACTER_OPTIONS = personalities.map(({ key, label }) => [key, label]);
export const VOICE_OPTIONS = Object.entries(voices).map(([key, voice]) => [key, voice.label]);
export const NAME_OPTIONS = Object.entries(NAME_POOLS).map(([key, pool]) => [key, pool.label]);

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function customField(value, length) {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}

function fullName(pool, gender, options) {
  const first = customField(options.firstName, 59) || pick(pool[gender]);
  const surname = pick(pool.surnames);
  const last = customField(options.lastName, 59) || (gender === "female" && pool.femaleSurname ? pool.femaleSurname(surname) : surname);
  const patronymic = pool.patronymics ? pick(pool.patronymics)[gender === "male" ? 0 : 1] : "";
  const middle = customField(options.middleName, 59) || patronymic;
  return [first, middle, last].filter(Boolean).join(" ");
}

function background(age, gender, options) {
  const stage = LIFE_STAGES.find(({ before }) => age < before);
  const endings = gender === "female" ? { a: "а", la: "ла", sa: "ась" } : { a: "", la: "", sa: "ся" };
  const beginning = pick(stage.beginnings).replace(/\{(a|la|sa)\}/g, (_, ending) => endings[ending]);
  const [interest, current] = pick(stage.activities);
  return {
    occupation: customField(options.occupation, 100) || pick(stage.occupations),
    interest,
    backstory: `${beginning}\n\n${current}`,
  };
}

export function generatePersona(min, max, locale, options = {}) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 120 || min > max) {
    throw new Error("Укажите целые числа от 0 до 120 и проверьте порядок границ.");
  }
  const age = min + Math.floor(Math.random() * (max - min + 1));
  const gender = Object.hasOwn(GENDER_LABELS, options.gender) ? options.gender : pick(Object.keys(GENDER_LABELS));
  const defaultRegion = locale === "ru" ? "russia" : locale === "en" ? "europe" : "ukraine";
  const cities = Object.hasOwn(CITIES, options.region) ? CITIES[options.region] : CITIES[defaultRegion];
  const { city, country, locale: cityLocale } = cities.find(item => item.id === options.city) ?? pick(cities);
  const namePool = Object.hasOwn(NAME_POOLS, locale) ? NAME_POOLS[locale] : NAME_POOLS[cityLocale];
  const selected = personalities.find(character => character.key === options.character);
  const youth = age < 3 ? youngPersonalities[0] : age < 7 ? youngPersonalities[1] : age < 13 ? youngPersonalities[2] : null;
  const personality = youth ?? selected ?? pick(personalities);
  const description = youth && selected ? `${youth.description} ${selected.child}` : personality.description;
  const traits = youth && selected ? [...new Set([...youth.traits, selected.traits[0]])] : personality.traits;
  const voice = Object.hasOwn(voices, options.voice) ? voices[options.voice] : null;
  const [style, example] = voice ? voice[age < 3 ? "infant" : age < 13 ? "child" : "adult"] : [personality.style, personality.example];
  return {
    id: crypto.randomUUID(),
    name: fullName(namePool, gender, options),
    age, gender, description, traits, style, example,
    city, country,
    ...background(age, gender, options),
    createdAt: new Date().toISOString(),
    mailboxId: null,
  };
}
