// units/registry.js - the unit registry: kinds of quantities (length, area, volume, mass, temperature, speed, pressure,
// energy, power, data sizes, time), measurement systems (metric, US customary, British imperial), every unit with its
// affine conversion to the base unit of its kind (base = value * factor + offset), labels in English, Russian and
// Georgian, the unit a system button shows for a kind, the counterpart of a unit in another system, and conversion.
//
//   UNITS: { code: { kind, system, factor, offset, label: { en, ru, ka }, name: { en, ru, ka }, approx? } }
//   convert(v, from, to) -> number | null      null when the kinds differ, a unit is unknown or v is not a number
//   unitFor(kind, system) -> code              the unit a system shows for a kind ('area', 'us') -> 'sqft'
//   unitPeer(code, system) -> code             km -> mi, cm -> in, m2 -> sqft: the counterpart keeps the magnitude
//
// Rationale (from the portal this was ported from):
// - Codes are unique across kinds, so convert() needs no kind argument and can never convert by a wrong kind.
// - Conversion is affine, not a plain factor: without the offset 0 °C would silently become 0 °F. Tests check
//   temperatures away from zero for that reason.
// - A label is not a kind: "days" or "pcs" have a label but no kind and must never be converted; convert() answers
//   null instead of a plausible number.
// - The counterpart of a unit comes from the unit, not from the kind: a mileage of 150 000 km is 93 206 mi, not
//   492 125 984 ft. The preferred unit of a kind is only the fallback.
// - Currency is not here on purpose: exchange rates change over time, a square metre does not.
//
// Numeric model (read before touching a factor):
// - One hop through the base, never a pairwise table: N units need N factors, not N^2 entries that can disagree.
//   Cost: two roundings per conversion instead of one; with IEEE-754 doubles that is a relative error near 1e-16,
//   far below the two decimals the UI shows.
// - Factors are the legal definitions, not derived approximations: the international inch is exactly 0.0254 m
//   (1959), the avoirdupois pound exactly 0.45359237 kg, the US gallon exactly 231 in^3, the imperial gallon exactly
//   4.54609 l. Area / volume factors are the definition squared / cubed written out in full (0.3048^2 = 0.09290304),
//   so no unit inherits a rounded intermediate of another. Decimal literals are still not exact in binary (0.0254 has
//   no finite binary form), which is why test.js compares most conversions with a relative epsilon (near()).
// - Affine (value * factor + offset), not linear: only temperature needs an offset, but a separate code path for it
//   would be a second converter to keep in sync. offset 0 degenerates to the linear map; adding 0 is exact.
// - Absolute values only. convert() maps a temperature READING; a temperature DIFFERENCE (a rise of 10 °C is a rise
//   of 18 °F, not 50 °F) must use the factor alone. No caller needs intervals today; adding one means a separate
//   function, never an "ignore offset" flag threaded through callers.

export const KINDS = ['length', 'area', 'volume', 'mass', 'temperature', 'speed', 'pressure', 'energy', 'power', 'data', 'time'];

export const KIND_LABEL = {
  length: { en: 'Length', ru: 'Длина', ka: 'სიგრძე' },
  area: { en: 'Area', ru: 'Площадь', ka: 'ფართობი' },
  volume: { en: 'Volume', ru: 'Объём', ka: 'მოცულობა' },
  mass: { en: 'Mass', ru: 'Масса', ka: 'მასა' },
  temperature: { en: 'Temperature', ru: 'Температура', ka: 'ტემპერატურა' },
  speed: { en: 'Speed', ru: 'Скорость', ka: 'სიჩქარე' },
  pressure: { en: 'Pressure', ru: 'Давление', ka: 'წნევა' },
  energy: { en: 'Energy', ru: 'Энергия', ka: 'ენერგია' },
  power: { en: 'Power', ru: 'Мощность', ka: 'სიმძლავრე' },
  data: { en: 'Data size', ru: 'Объём данных', ka: 'მონაცემების ზომა' },
  time: { en: 'Time', ru: 'Время', ka: 'დრო' },
};

// Systems a page can switch between. Unit.system is one of these, 'customary' (shared by US and imperial: ft, lb,
// mph) or 'other' (nautical units, data, time, carats: valid in every system).
export const SYSTEMS = ['metric', 'us', 'imperial'];

export const SYSTEM_LABEL = {
  metric: { en: 'Metric', ru: 'Метрические', ka: 'მეტრული' },
  us: { en: 'US customary', ru: 'Американские', ka: 'ამერიკული' },
  imperial: { en: 'Imperial', ru: 'Имперские', ka: 'იმპერიული' },
};

// Base unit of every kind (named by list, not found by factor === 1).
export const BASE = {
  length: 'm', area: 'm2', volume: 'l', mass: 'kg', temperature: 'c', speed: 'kmh', pressure: 'pa', energy: 'j',
  power: 'w', data: 'byte', time: 's',
};

// u(code, kind, system, factor, [en, ru, ka] labels, [en, ru, ka] names, extra)
// Registration order is meaningful: `ord` records it and unitsOfKind() keeps it, so pickers and convertAll list
// units in source order (smallest first inside each system). Reordering lines reorders the UI.
// approx is spread in only when set, so exact units carry no `approx: false` noise in serialised registries.
const U = {};
const u = (code, kind, system, factor, label, name, extra = {}) => {
  U[code] = {
    code, kind, system, factor, offset: extra.offset || 0, ord: Object.keys(U).length,
    label: { en: label[0], ru: label[1], ka: label[2] },
    name: { en: name[0], ru: name[1], ka: name[2] },
    ...(extra.approx ? { approx: true } : {}),
  };
};

// --- length (base m) ---------------------------------------------------------------------------------------------
u('um', 'length', 'metric', 1e-6, ['µm', 'мкм', 'მკმ'], ['micrometre', 'микрометр', 'მიკრომეტრი']);
u('mm', 'length', 'metric', 0.001, ['mm', 'мм', 'მმ'], ['millimetre', 'миллиметр', 'მილიმეტრი']);
u('cm', 'length', 'metric', 0.01, ['cm', 'см', 'სმ'], ['centimetre', 'сантиметр', 'სანტიმეტრი']);
u('dm', 'length', 'metric', 0.1, ['dm', 'дм', 'დმ'], ['decimetre', 'дециметр', 'დეციმეტრი']);
u('m', 'length', 'metric', 1, ['m', 'м', 'მ'], ['metre', 'метр', 'მეტრი']);
u('km', 'length', 'metric', 1000, ['km', 'км', 'კმ'], ['kilometre', 'километр', 'კილომეტრი']);
u('in', 'length', 'customary', 0.0254, ['in', 'дюйм', 'დიუმი'], ['inch', 'дюйм', 'დიუმი']);
u('ft', 'length', 'customary', 0.3048, ['ft', 'фут', 'ფუტი'], ['foot', 'фут', 'ფუტი']);
u('yd', 'length', 'customary', 0.9144, ['yd', 'ярд', 'იარდი'], ['yard', 'ярд', 'იარდი']);
u('mi', 'length', 'customary', 1609.344, ['mi', 'миля', 'მილი'], ['mile', 'миля', 'მილი']);
u('nmi', 'length', 'other', 1852, ['nmi', 'мор. миля', 'საზღვ. მილი'], ['nautical mile', 'морская миля', 'საზღვაო მილი']);

// --- area (base m²). A sotka (100 m², an are) is the everyday unit of land plots in Georgia and Russia ------------
u('mm2', 'area', 'metric', 1e-6, ['mm²', 'мм²', 'მმ²'], ['square millimetre', 'квадратный миллиметр', 'კვადრატული მილიმეტრი']);
u('cm2', 'area', 'metric', 1e-4, ['cm²', 'см²', 'სმ²'], ['square centimetre', 'квадратный сантиметр', 'კვადრატული სანტიმეტრი']);
u('m2', 'area', 'metric', 1, ['m²', 'м²', 'მ²'], ['square metre', 'квадратный метр', 'კვადრატული მეტრი']);
u('sotka', 'area', 'metric', 100, ['are', 'сот.', 'სოტკა'], ['are (sotka)', 'сотка', 'სოტკა']);
u('ha', 'area', 'metric', 1e4, ['ha', 'га', 'ჰა'], ['hectare', 'гектар', 'ჰექტარი']);
u('km2', 'area', 'metric', 1e6, ['km²', 'км²', 'კმ²'], ['square kilometre', 'квадратный километр', 'კვადრატული კილომეტრი']);
u('sqin', 'area', 'customary', 0.00064516, ['sq in', 'кв. дюйм', 'კვ. დიუმი'], ['square inch', 'квадратный дюйм', 'კვადრატული დიუმი']);
u('sqft', 'area', 'customary', 0.09290304, ['sq ft', 'кв. фут', 'კვ. ფუტი'], ['square foot', 'квадратный фут', 'კვადრატული ფუტი']);
u('sqyd', 'area', 'customary', 0.83612736, ['sq yd', 'кв. ярд', 'კვ. იარდი'], ['square yard', 'квадратный ярд', 'კვადრატული იარდი']);
u('acre', 'area', 'customary', 4046.8564224, ['acre', 'акр', 'აკრი'], ['acre', 'акр', 'აკრი']);
u('sqmi', 'area', 'customary', 2589988.110336, ['sq mi', 'кв. миля', 'კვ. მილი'], ['square mile', 'квадратная миля', 'კვადრატული მილი']);

// --- volume (base litre). The gallon, pint, quart and fluid ounce differ between the US and the UK --------------
u('ml', 'volume', 'metric', 0.001, ['ml', 'мл', 'მლ'], ['millilitre', 'миллилитр', 'მილილიტრი']);
u('cm3', 'volume', 'metric', 0.001, ['cm³', 'см³', 'სმ³'], ['cubic centimetre', 'кубический сантиметр', 'კუბური სანტიმეტრი']);
u('cl', 'volume', 'metric', 0.01, ['cl', 'сл', 'სლ'], ['centilitre', 'сантилитр', 'სანტილიტრი']);
u('dl', 'volume', 'metric', 0.1, ['dl', 'дл', 'დლ'], ['decilitre', 'децилитр', 'დეცილიტრი']);
u('l', 'volume', 'metric', 1, ['l', 'л', 'ლ'], ['litre', 'литр', 'ლიტრი']);
u('m3', 'volume', 'metric', 1000, ['m³', 'м³', 'მ³'], ['cubic metre', 'кубический метр', 'კუბური მეტრი']);
u('tsp', 'volume', 'us', 0.00492892159375, ['tsp', 'ч. л.', 'ჩ. კ.'], ['teaspoon', 'чайная ложка', 'ჩაის კოვზი']);
u('tbsp', 'volume', 'us', 0.01478676478125, ['tbsp', 'ст. л.', 'ს. კ.'], ['tablespoon', 'столовая ложка', 'სუფრის კოვზი']);
u('floz', 'volume', 'us', 0.0295735295625, ['fl oz', 'жидк. унция', 'თხ. უნცია'], ['US fluid ounce', 'жидкая унция США', 'აშშ თხევადი უნცია']);
u('cup', 'volume', 'us', 0.2365882365, ['cup', 'чашка', 'ჭიქა'], ['US cup', 'чашка США', 'აშშ ჭიქა']);
u('pt', 'volume', 'us', 0.473176473, ['pt', 'пинта', 'პინტა'], ['US pint', 'пинта США', 'აშშ პინტა']);
u('qt', 'volume', 'us', 0.946352946, ['qt', 'кварта', 'კვარტა'], ['US quart', 'кварта США', 'აშშ კვარტა']);
u('gal', 'volume', 'us', 3.785411784, ['gal', 'галлон', 'გალონი'], ['US gallon', 'галлон США', 'აშშ გალონი']);
u('bbl', 'volume', 'us', 158.987294928, ['bbl', 'баррель', 'ბარელი'], ['oil barrel', 'нефтяной баррель', 'ნავთობის ბარელი']);
u('flozimp', 'volume', 'imperial', 0.0284130625, ['fl oz (UK)', 'жидк. унция (брит.)', 'თხ. უნცია (ბრიტ.)'], ['imperial fluid ounce', 'британская жидкая унция', 'ბრიტანული თხევადი უნცია']);
u('ptimp', 'volume', 'imperial', 0.56826125, ['pt (UK)', 'пинта (брит.)', 'პინტა (ბრიტ.)'], ['imperial pint', 'британская пинта', 'ბრიტანული პინტა']);
u('qtimp', 'volume', 'imperial', 1.1365225, ['qt (UK)', 'кварта (брит.)', 'კვარტა (ბრიტ.)'], ['imperial quart', 'британская кварта', 'ბრიტანული კვარტა']);
u('galimp', 'volume', 'imperial', 4.54609, ['gal (UK)', 'галлон (брит.)', 'გალონი (ბრიტ.)'], ['imperial gallon', 'британский галлон', 'ბრიტანული გალონი']);
u('in3', 'volume', 'customary', 0.016387064, ['cu in', 'куб. дюйм', 'კუბ. დიუმი'], ['cubic inch', 'кубический дюйм', 'კუბური დიუმი']);
u('ft3', 'volume', 'customary', 28.316846592, ['cu ft', 'куб. фут', 'კუბ. ფუტი'], ['cubic foot', 'кубический фут', 'კუბური ფუტი']);
u('yd3', 'volume', 'customary', 764.554857984, ['cu yd', 'куб. ярд', 'კუბ. იარდი'], ['cubic yard', 'кубический ярд', 'კუბური იარდი']);

// --- mass (base kg) ----------------------------------------------------------------------------------------------
u('mg', 'mass', 'metric', 1e-6, ['mg', 'мг', 'მგ'], ['milligram', 'миллиграмм', 'მილიგრამი']);
u('g', 'mass', 'metric', 0.001, ['g', 'г', 'გ'], ['gram', 'грамм', 'გრამი']);
u('kg', 'mass', 'metric', 1, ['kg', 'кг', 'კგ'], ['kilogram', 'килограмм', 'კილოგრამი']);
u('t', 'mass', 'metric', 1000, ['t', 'т', 'ტ'], ['tonne', 'тонна', 'ტონა']);
u('ct', 'mass', 'other', 0.0002, ['ct', 'кар', 'კარ.'], ['carat', 'карат', 'კარატი']);
u('oz', 'mass', 'customary', 0.028349523125, ['oz', 'унция', 'უნცია'], ['ounce', 'унция', 'უნცია']);
u('ozt', 'mass', 'other', 0.0311034768, ['oz t', 'тр. унция', 'ტროის უნცია'], ['troy ounce', 'тройская унция', 'ტროის უნცია']);
u('lb', 'mass', 'customary', 0.45359237, ['lb', 'фунт', 'ფუნტი'], ['pound', 'фунт', 'ფუნტი']);
u('st', 'mass', 'imperial', 6.35029318, ['st', 'стоун', 'სტოუნი'], ['stone', 'стоун', 'სტოუნი']);
u('shton', 'mass', 'us', 907.18474, ['short ton', 'кор. тонна', 'მოკლე ტონა'], ['short ton', 'короткая тонна', 'მოკლე ტონა']);
u('lton', 'mass', 'imperial', 1016.0469088, ['long ton', 'дл. тонна', 'გრძელი ტონა'], ['long ton', 'длинная тонна', 'გრძელი ტონა']);

// --- temperature (base °C): the only kind with an offset ---------------------------------------------------------
// base = v * factor + offset, so each line solves "°C = ...": °C = (°F - 32) * 5/9 = °F * 5/9 - 160/9;
// °C = K - 273.15; °C = °R * 5/9 - 273.15 (Rankine: Fahrenheit-sized degrees counted from absolute zero).
// 5 / 9 and (-32 * 5) / 9 are left as expressions: the engine yields the nearest double of the exact quotient,
// which a hand-typed 0.5555... literal would only approximate.
u('c', 'temperature', 'metric', 1, ['°C', '°C', '°C'], ['degree Celsius', 'градус Цельсия', 'ცელსიუსის გრადუსი']);
u('f', 'temperature', 'customary', 5 / 9, ['°F', '°F', '°F'], ['degree Fahrenheit', 'градус Фаренгейта', 'ფარენჰაიტის გრადუსი'], { offset: (-32 * 5) / 9 });
u('k', 'temperature', 'metric', 1, ['K', 'К', 'K'], ['kelvin', 'кельвин', 'კელვინი'], { offset: -273.15 });
u('r', 'temperature', 'other', 5 / 9, ['°R', '°R', '°R'], ['degree Rankine', 'градус Ранкина', 'რენკინის გრადუსი'], { offset: -273.15 });

// --- speed (base km/h) -------------------------------------------------------------------------------------------
u('kmh', 'speed', 'metric', 1, ['km/h', 'км/ч', 'კმ/სთ'], ['kilometre per hour', 'километр в час', 'კილომეტრი საათში']);
u('mps', 'speed', 'metric', 3.6, ['m/s', 'м/с', 'მ/წმ'], ['metre per second', 'метр в секунду', 'მეტრი წამში']);
u('mph', 'speed', 'customary', 1.609344, ['mph', 'миль/ч', 'მილი/სთ'], ['mile per hour', 'миля в час', 'მილი საათში']);
u('fps', 'speed', 'customary', 1.09728, ['ft/s', 'фут/с', 'ფუტი/წმ'], ['foot per second', 'фут в секунду', 'ფუტი წამში']);
u('kn', 'speed', 'other', 1.852, ['kn', 'уз', 'კვანძი'], ['knot', 'узел', 'კვანძი']);

// --- pressure (base Pa) ------------------------------------------------------------------------------------------
u('pa', 'pressure', 'metric', 1, ['Pa', 'Па', 'პა'], ['pascal', 'паскаль', 'პასკალი']);
u('hpa', 'pressure', 'metric', 100, ['hPa', 'гПа', 'ჰპა'], ['hectopascal', 'гектопаскаль', 'ჰექტოპასკალი']);
u('kpa', 'pressure', 'metric', 1000, ['kPa', 'кПа', 'კპა'], ['kilopascal', 'килопаскаль', 'კილოპასკალი']);
u('mpa', 'pressure', 'metric', 1e6, ['MPa', 'МПа', 'მპა'], ['megapascal', 'мегапаскаль', 'მეგაპასკალი']);
u('mbar', 'pressure', 'metric', 100, ['mbar', 'мбар', 'მბარი'], ['millibar', 'миллибар', 'მილიბარი']);
u('bar', 'pressure', 'metric', 1e5, ['bar', 'бар', 'ბარი'], ['bar', 'бар', 'ბარი']);
u('atm', 'pressure', 'other', 101325, ['atm', 'атм', 'ატმ'], ['standard atmosphere', 'атмосфера', 'ატმოსფერო']);
u('at', 'pressure', 'other', 98066.5, ['at', 'кгс/см²', 'კგძ/სმ²'], ['technical atmosphere', 'техническая атмосфера', 'ტექნიკური ატმოსფერო']);
u('mmhg', 'pressure', 'other', 133.322387415, ['mmHg', 'мм рт. ст.', 'ვწყ. სვ. მმ'], ['millimetre of mercury', 'миллиметр ртутного столба', 'ვერცხლისწყლის სვეტის მილიმეტრი']);
u('psi', 'pressure', 'customary', 6894.757293168, ['psi', 'psi', 'psi'], ['pound per square inch', 'фунт на кв. дюйм', 'ფუნტი კვ. დიუმზე']);
u('inhg', 'pressure', 'customary', 3386.389, ['inHg', 'дюйм рт. ст.', 'ვწყ. სვ. დიუმი'], ['inch of mercury', 'дюйм ртутного столба', 'ვერცხლისწყლის სვეტის დიუმი']);

// --- energy (base J). kcal is the food "Calorie" on both sides of the Atlantic -------------------------------------
u('j', 'energy', 'metric', 1, ['J', 'Дж', 'ჯ'], ['joule', 'джоуль', 'ჯოული']);
u('kj', 'energy', 'metric', 1000, ['kJ', 'кДж', 'კჯ'], ['kilojoule', 'килоджоуль', 'კილოჯოული']);
u('mj', 'energy', 'metric', 1e6, ['MJ', 'МДж', 'მჯ'], ['megajoule', 'мегаджоуль', 'მეგაჯოული']);
u('wh', 'energy', 'metric', 3600, ['Wh', 'Вт·ч', 'ვტ·სთ'], ['watt-hour', 'ватт-час', 'ვატ-საათი']);
u('kwh', 'energy', 'metric', 3.6e6, ['kWh', 'кВт·ч', 'კვტ·სთ'], ['kilowatt-hour', 'киловатт-час', 'კილოვატ-საათი']);
u('cal', 'energy', 'other', 4.184, ['cal', 'кал', 'კალ'], ['calorie', 'калория', 'კალორია']);
u('kcal', 'energy', 'other', 4184, ['kcal', 'ккал', 'კკალ'], ['kilocalorie', 'килокалория', 'კილოკალორია']);
u('btu', 'energy', 'customary', 1055.05585262, ['BTU', 'БТЕ', 'BTU'], ['British thermal unit', 'британская тепловая единица', 'ბრიტანული სითბური ერთეული']);

// --- power (base W) ----------------------------------------------------------------------------------------------
u('w', 'power', 'metric', 1, ['W', 'Вт', 'ვტ'], ['watt', 'ватт', 'ვატი']);
u('kw', 'power', 'metric', 1000, ['kW', 'кВт', 'კვტ'], ['kilowatt', 'киловатт', 'კილოვატი']);
u('mw', 'power', 'metric', 1e6, ['MW', 'МВт', 'მვტ'], ['megawatt', 'мегаватт', 'მეგავატი']);
u('ps', 'power', 'metric', 735.49875, ['PS', 'л. с.', 'ცხ. ძ.'], ['metric horsepower', 'лошадиная сила', 'ცხენის ძალა']);
// hp = 550 ft*lbf/s through the exact foot, pound and standard gravity 9.80665 m/s^2. The literal has 17 significant
// digits, more than a double holds; the engine rounds it to the nearest double, which is harmless.
u('hp', 'power', 'customary', 745.69987158227022, ['hp', 'hp', 'hp'], ['mechanical horsepower', 'механическая л. с.', 'მექანიკური ცხენის ძალა']);

// --- data (base byte). kB, MB … are decimal (SI), KiB, MiB … binary (IEC) ----------------------------------------
// Every factor here is an integer below 2^53 or a power of two (bit = 0.125), hence an exact double: integer byte
// counts convert without rounding error, unlike every other kind.
u('bit', 'data', 'other', 0.125, ['bit', 'бит', 'ბიტი'], ['bit', 'бит', 'ბიტი']);
u('byte', 'data', 'other', 1, ['B', 'Б', 'ბ'], ['byte', 'байт', 'ბაიტი']);
u('kb', 'data', 'other', 1e3, ['kB', 'КБ', 'კბ'], ['kilobyte', 'килобайт', 'კილობაიტი']);
u('mb', 'data', 'other', 1e6, ['MB', 'МБ', 'მბ'], ['megabyte', 'мегабайт', 'მეგაბაიტი']);
u('gb', 'data', 'other', 1e9, ['GB', 'ГБ', 'გბ'], ['gigabyte', 'гигабайт', 'გიგაბაიტი']);
u('tb', 'data', 'other', 1e12, ['TB', 'ТБ', 'ტბ'], ['terabyte', 'терабайт', 'ტერაბაიტი']);
u('pb', 'data', 'other', 1e15, ['PB', 'ПБ', 'პბ'], ['petabyte', 'петабайт', 'პეტაბაიტი']);
u('kib', 'data', 'other', 1024, ['KiB', 'КиБ', 'KiB'], ['kibibyte', 'кибибайт', 'კიბიბაიტი']);
u('mib', 'data', 'other', 1024 ** 2, ['MiB', 'МиБ', 'MiB'], ['mebibyte', 'мебибайт', 'მებიბაიტი']);
u('gib', 'data', 'other', 1024 ** 3, ['GiB', 'ГиБ', 'GiB'], ['gibibyte', 'гибибайт', 'გიბიბაიტი']);
u('tib', 'data', 'other', 1024 ** 4, ['TiB', 'ТиБ', 'TiB'], ['tebibyte', 'тебибайт', 'ტებიბაიტი']);

// --- time (base s). The month and the year are Gregorian averages (approx) -----------------------------------------
// yr = 365.2425 d (the 400-year Gregorian cycle) = 31 556 952 s; mo = yr / 12 = 2 629 746 s. `approx` lets the UI
// flag them: a calendar month is 28 to 31 days, so these convert statistics, not date spans.
u('ms', 'time', 'other', 0.001, ['ms', 'мс', 'მწმ'], ['millisecond', 'миллисекунда', 'მილიწამი']);
u('s', 'time', 'other', 1, ['s', 'с', 'წმ'], ['second', 'секунда', 'წამი']);
u('min', 'time', 'other', 60, ['min', 'мин', 'წთ'], ['minute', 'минута', 'წუთი']);
u('h', 'time', 'other', 3600, ['h', 'ч', 'სთ'], ['hour', 'час', 'საათი']);
u('d', 'time', 'other', 86400, ['d', 'сут.', 'დღე'], ['day', 'сутки', 'დღე']);
u('wk', 'time', 'other', 604800, ['wk', 'нед.', 'კვ.'], ['week', 'неделя', 'კვირა']);
u('mo', 'time', 'other', 2629746, ['mo', 'мес.', 'თვე'], ['month', 'месяц', 'თვე'], { approx: true });
u('yr', 'time', 'other', 31556952, ['yr', 'г.', 'წ.'], ['year', 'год', 'წელი'], { approx: true });

export const UNITS = U;

// The unit a system button shows for a kind (named, not the "first unit of the system": orders change).
const PREFERRED = {
  length: { metric: 'm', us: 'ft', imperial: 'ft' },
  area: { metric: 'm2', us: 'sqft', imperial: 'sqft' },
  volume: { metric: 'l', us: 'gal', imperial: 'galimp' },
  mass: { metric: 'kg', us: 'lb', imperial: 'lb' },
  temperature: { metric: 'c', us: 'f', imperial: 'f' },
  speed: { metric: 'kmh', us: 'mph', imperial: 'mph' },
  pressure: { metric: 'bar', us: 'psi', imperial: 'psi' },
  energy: { metric: 'kj', us: 'btu', imperial: 'btu' },
  power: { metric: 'kw', us: 'hp', imperial: 'hp' },
  data: { metric: 'mb', us: 'mb', imperial: 'mb' },
  time: { metric: 's', us: 's', imperial: 's' },
};

// Counterparts of a unit in other systems: a string (the same for US and imperial) or { metric, us, imperial }.
const PEER = {
  mm: 'in', cm: 'in', dm: 'in', m: 'ft', km: 'mi', in: 'cm', ft: 'm', yd: 'm', mi: 'km', um: 'in',
  mm2: 'sqin', cm2: 'sqin', m2: 'sqft', sotka: 'sqft', ha: 'acre', km2: 'sqmi', sqin: 'cm2', sqft: 'm2', sqyd: 'm2', acre: 'ha', sqmi: 'km2',
  ml: { us: 'floz', imperial: 'flozimp' }, cm3: 'in3', cl: { us: 'floz', imperial: 'flozimp' }, dl: { us: 'cup', imperial: 'flozimp' },
  l: { us: 'gal', imperial: 'galimp' }, m3: 'ft3',
  tsp: { metric: 'ml', imperial: 'flozimp' }, tbsp: { metric: 'ml', imperial: 'flozimp' }, floz: { metric: 'ml', imperial: 'flozimp' },
  cup: { metric: 'ml', imperial: 'ptimp' }, pt: { metric: 'l', imperial: 'ptimp' }, qt: { metric: 'l', imperial: 'qtimp' },
  gal: { metric: 'l', imperial: 'galimp' }, bbl: { metric: 'l', imperial: 'galimp' },
  flozimp: { metric: 'ml', us: 'floz' }, ptimp: { metric: 'l', us: 'pt' }, qtimp: { metric: 'l', us: 'qt' }, galimp: { metric: 'l', us: 'gal' },
  in3: 'cm3', ft3: 'm3', yd3: 'm3',
  mg: 'oz', g: 'oz', kg: 'lb', t: { us: 'shton', imperial: 'lton' }, oz: 'g', lb: 'kg', st: { metric: 'kg', us: 'lb' },
  shton: { metric: 't', imperial: 'lton' }, lton: { metric: 't', us: 'shton' },
  c: 'f', k: 'f', f: 'c',
  kmh: 'mph', mps: 'fps', mph: 'kmh', fps: 'mps',
  pa: 'psi', hpa: 'inhg', mbar: 'inhg', kpa: 'psi', mpa: 'psi', bar: 'psi', psi: 'bar', inhg: 'hpa',
  j: 'btu', kj: 'btu', mj: 'btu', wh: 'btu', kwh: 'btu', btu: 'kj',
  w: 'hp', kw: 'hp', mw: 'hp', ps: 'hp', hp: 'kw',
};

export const isKind = (v) => KINDS.includes(String(v ?? ''));
export const isSystem = (v) => SYSTEMS.includes(String(v ?? ''));
// A kind from untrusted input: '' when it is not one ("not convertible"), never a guessed kind.
export const normalizeKind = (v) => (isKind(v) ? String(v) : '');
// A system from untrusted input; the default is metric.
export const normalizeSystem = (v) => (isSystem(v) ? String(v) : 'metric');

export const unit = (code) => (Object.prototype.hasOwnProperty.call(U, String(code ?? '')) ? U[String(code)] : null);
export const kindOf = (code) => unit(code)?.kind ?? '';
export const baseUnit = (kind) => BASE[kind] || '';

// Whether a unit is at home in a system: 'customary' units belong to US and imperial, 'other' units to every system.
export function inSystem(code, system) {
  const x = unit(code);
  if (!x) return false;
  const s = normalizeSystem(system);
  if (x.system === 'other' || x.system === s) return true;
  return x.system === 'customary' && (s === 'us' || s === 'imperial');
}

// Units of a kind in registry order (smallest first within a system); `system` keeps the units at home in it.
export function unitsOfKind(kind, system) {
  return Object.keys(U).filter((c) => U[c].kind === kind && (!system || inSystem(c, system)));
}

// The unit a system shows for a kind; '' for an unknown kind.
export const unitFor = (kind, system) => PREFERRED[kind]?.[normalizeSystem(system)] || '';

// The same quantity in another system: unitPeer('km', 'us') -> 'mi'; a unit at home in the system stays itself.
export function unitPeer(code, system) {
  const x = unit(code);
  if (!x) return '';
  const s = normalizeSystem(system);
  if (inSystem(code, s)) return String(code);
  const p = PEER[code];
  const peer = typeof p === 'string' ? p : p?.[s];
  if (peer && unit(peer)?.kind === x.kind && inSystem(peer, s)) return peer;
  return unitFor(x.kind, s);
}

// Label in a language with fallbacks: the language, English, the code.
export function unitLabel(code, lang = 'en') {
  const x = unit(code);
  if (!x) return '';
  return x.label[lang] || x.label.en || String(code);
}

export function unitName(code, lang = 'en') {
  const x = unit(code);
  if (!x) return '';
  return x.name[lang] || x.name.en || String(code);
}

export const kindLabel = (kind, lang = 'en') => KIND_LABEL[kind]?.[lang] || KIND_LABEL[kind]?.en || '';

// A number from input: numbers as they are, strings trimmed with a decimal comma accepted; '' / null -> NaN, not 0
// (Number('') is 0, and an empty field must not print as "0 m²").
// Deliberately cruder than parse.js parseNumber (which cannot be imported here: parse.js imports this module).
// Grammar: drop all whitespace (\s already covers U+00A0 and U+202F; the explicit characters only document intent),
// turn the FIRST comma into a point, then Number(). Results: "1 234,5" -> 1234.5; "1,234" -> 1.234 (decimal-comma
// reading); "1,234,567" and "1.234,5" -> NaN, refused rather than guessed. Number() also accepts "0x10" and
// "Infinity"; callers' Number.isFinite guards drop the latter. Use it for values already numeric or machine-written
// (storage, URL state); free text typed by people goes through parseNumber.
export function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  const s = String(v ?? '').trim().replace(/[\s  ]/g, '').replace(',', '.');
  return s === '' ? NaN : Number(s);
}

// value -> base unit of its kind (affine), null when unknown.
export function toBase(v, from) {
  const a = unit(from);
  const n = toNumber(v);
  if (!a || !Number.isFinite(n)) return null;
  return n * a.factor + a.offset;
}

// base unit of the kind -> value in `to`.
export function fromBase(v, to) {
  const b = unit(to);
  const n = toNumber(v);
  if (!b || !Number.isFinite(n)) return null;
  return (n - b.offset) / b.factor;
}

// Converts between units of one kind; null means "cannot convert" (different kinds, unknown unit, not a number).
// null, not NaN or 0: NaN propagates silently through arithmetic and 0 is a plausible answer; null forces a branch.
// a === b returns n untouched because the affine round trip (n * f + o - o) / f is not the identity in floating
// point. Otherwise one inlined expression: fromBase(toBase()) without parsing the intermediate a second time.
export function convert(v, from, to) {
  const a = unit(from), b = unit(to);
  if (!a || !b || a.kind !== b.kind) return null;
  const n = toNumber(v);
  if (!Number.isFinite(n)) return null;
  if (a === b) return n;
  return (n * a.factor + a.offset - b.offset) / b.factor;
}

// The affine map from one unit to another: to = from * factor + offset; null when not convertible.
export function conversionOf(from, to) {
  const a = unit(from), b = unit(to);
  if (!a || !b || a.kind !== b.kind) return null;
  // 15 significant digits = DBL_DIG, the most a double guarantees through decimal text: strips the division noise
  // so formulas print 1.8, leaves genuinely precise factors alone. Display only; convert() keeps full precision.
  const tidy = (v) => Number(v.toPrecision(15));  // 1 / (5 / 9) is 1.7999999999999998
  return { factor: tidy(a.factor / b.factor), offset: tidy((a.offset - b.offset) / b.factor) };
}
