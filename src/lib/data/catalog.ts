/**
 * Marken- und Modellkatalog für den Schweizer Markt.
 *
 * Bewusst im Repository gepflegt statt von einem Marktplatz übernommen:
 * Modelllisten von AutoScout24 und Vergleichbaren sind deren Datenbestand und
 * durch die Nutzungsbedingungen geschützt. Für eine belastbare, lizenzierte
 * Quelle kommen Eurotax/Schwacke oder die Typengenehmigungsdaten des ASTRA in
 * Frage — siehe README, Abschnitt «Fahrzeugkatalog».
 *
 * Abgedeckt sind Modelle, die ab etwa 2012 in der Schweiz neu erhältlich
 * waren. Die Liste ist eine Eingabehilfe, keine Zwangsauswahl: das Formular
 * erlaubt weiterhin freie Eingaben für Modell und Version.
 */

export interface CatalogMake {
  name: string;
  models: string[];
}

export const CATALOG: CatalogMake[] = [
  {
    name: "VW",
    models: [
      "up!", "Polo", "Golf", "Golf Variant", "Golf Sportsvan", "Jetta", "Beetle", "Scirocco",
      "T-Cross", "Taigo", "T-Roc", "T-Roc Cabriolet", "Tiguan", "Tiguan Allspace", "Touran",
      "Sharan", "Touareg", "Passat", "Passat Variant", "Arteon", "Arteon Shooting Brake",
      "ID.3", "ID.4", "ID.5", "ID.7", "ID.7 Tourer", "ID. Buzz", "Caddy", "Multivan", "California",
      "Amarok", "Transporter", "Crafter",
    ],
  },
  {
    name: "Skoda",
    models: [
      "Citigo", "Fabia", "Fabia Combi", "Scala", "Rapid", "Octavia", "Octavia Combi",
      "Superb", "Superb Combi", "Kamiq", "Karoq", "Kodiaq", "Yeti", "Enyaq", "Enyaq Coupé",
      "Elroq", "Roomster",
    ],
  },
  {
    name: "Audi",
    models: [
      "A1", "A1 Sportback", "A3", "A3 Sportback", "A3 Limousine", "A3 Cabriolet",
      "A4", "A4 Avant", "A4 allroad", "A5", "A5 Sportback", "A5 Cabriolet",
      "A6", "A6 Avant", "A6 allroad", "A7 Sportback", "A8",
      "Q2", "Q3", "Q3 Sportback", "Q4 e-tron", "Q4 Sportback e-tron", "Q5", "Q5 Sportback",
      "Q7", "Q8", "Q8 e-tron", "Q8 Sportback e-tron", "e-tron GT",
      "TT", "TT Roadster", "R8",
      "S3", "S4", "S5", "S6", "S7", "S8", "SQ5", "SQ7", "SQ8",
      "RS 3", "RS 4 Avant", "RS 5", "RS 6 Avant", "RS 7", "RS Q3", "RS Q8", "RS e-tron GT",
    ],
  },
  {
    name: "BMW",
    models: [
      "1er", "2er Coupé", "2er Cabrio", "2er Active Tourer", "2er Gran Tourer", "2er Gran Coupé",
      "3er", "3er Touring", "3er Gran Turismo", "4er Coupé", "4er Cabrio", "4er Gran Coupé",
      "5er", "5er Touring", "6er Gran Turismo", "6er Gran Coupé", "7er", "8er", "8er Gran Coupé",
      "X1", "X2", "X3", "X4", "X5", "X6", "X7", "XM", "Z4",
      "i3", "i4", "i5", "i7", "iX", "iX1", "iX2", "iX3",
      "M2", "M3", "M3 Touring", "M4", "M5", "M8", "X3 M", "X4 M", "X5 M", "X6 M",
    ],
  },
  {
    name: "Mercedes-Benz",
    models: [
      "A-Klasse", "A-Klasse Limousine", "B-Klasse", "C-Klasse", "C-Klasse T-Modell",
      "CLA", "CLA Shooting Brake", "CLS", "E-Klasse", "E-Klasse T-Modell", "E-Klasse Coupé",
      "S-Klasse", "SL", "SLC", "AMG GT", "AMG GT 4-Türer",
      "GLA", "GLB", "GLC", "GLC Coupé", "GLE", "GLE Coupé", "GLS", "G-Klasse",
      "EQA", "EQB", "EQC", "EQE", "EQE SUV", "EQS", "EQS SUV", "EQV",
      "V-Klasse", "Vito", "Sprinter", "Citan", "X-Klasse",
    ],
  },
  {
    name: "Seat",
    models: ["Mii", "Ibiza", "Ibiza ST", "Leon", "Leon ST", "Arona", "Ateca", "Tarraco", "Alhambra", "Toledo"],
  },
  {
    name: "Cupra",
    models: ["Ibiza", "Leon", "Leon Sportstourer", "Ateca", "Formentor", "Born", "Terramar", "Tavascan"],
  },
  {
    name: "Opel",
    models: [
      "Karl", "Adam", "Corsa", "Corsa-e", "Astra", "Astra Sports Tourer", "Insignia",
      "Insignia Sports Tourer", "Crossland", "Grandland", "Mokka", "Mokka-e", "Zafira",
      "Combo", "Vivaro", "Astra Electric", "Frontera",
    ],
  },
  {
    name: "Ford",
    models: [
      "Ka+", "Fiesta", "Focus", "Focus Turnier", "Mondeo", "Mondeo Turnier", "Puma",
      "EcoSport", "Kuga", "Edge", "Explorer", "Mustang", "Mustang Mach-E", "Bronco",
      "S-Max", "Galaxy", "Tourneo Connect", "Tourneo Custom", "Ranger", "Transit", "Capri",
    ],
  },
  {
    name: "Renault",
    models: [
      "Twingo", "Clio", "Captur", "Zoe", "Mégane", "Mégane Grandtour", "Mégane E-Tech",
      "Scénic", "Grand Scénic", "Scénic E-Tech", "Kadjar", "Arkana", "Austral", "Espace",
      "Koleos", "Talisman", "Kangoo", "Trafic", "Rafale", "5 E-Tech",
    ],
  },
  {
    name: "Dacia",
    models: ["Sandero", "Sandero Stepway", "Logan", "Duster", "Jogger", "Spring", "Lodgy", "Dokker", "Bigster"],
  },
  {
    name: "Peugeot",
    models: [
      "108", "208", "e-208", "308", "308 SW", "408", "508", "508 SW", "2008", "e-2008",
      "3008", "5008", "Rifter", "Partner", "Traveller", "Expert", "e-3008", "e-5008",
    ],
  },
  {
    name: "Citroën",
    models: [
      "C1", "C3", "C3 Aircross", "C4", "ë-C4", "C4 X", "C4 Picasso", "C4 SpaceTourer",
      "C5", "C5 Aircross", "C5 X", "Berlingo", "SpaceTourer", "Jumpy", "ë-C3",
    ],
  },
  {
    name: "DS",
    models: ["DS 3", "DS 3 Crossback", "DS 4", "DS 5", "DS 7 Crossback", "DS 9"],
  },
  {
    name: "Fiat",
    models: ["500", "500e", "500C", "500X", "500L", "Panda", "Tipo", "124 Spider", "Doblò", "Ducato", "600e", "Grande Panda"],
  },
  {
    name: "Abarth",
    models: ["595", "695", "500e", "124 Spider", "600e"],
  },
  {
    name: "Alfa Romeo",
    models: ["MiTo", "Giulietta", "Giulia", "Stelvio", "Tonale", "Junior", "4C"],
  },
  {
    name: "Lancia",
    models: ["Ypsilon", "Delta"],
  },
  {
    name: "Jeep",
    models: ["Renegade", "Compass", "Cherokee", "Grand Cherokee", "Wrangler", "Gladiator", "Avenger"],
  },
  {
    name: "Volvo",
    models: [
      "V40", "V40 Cross Country", "V60", "V60 Cross Country", "V90", "V90 Cross Country",
      "S60", "S90", "XC40", "EX40", "XC60", "XC90", "C40 Recharge", "EC40", "EX30", "EX90",
    ],
  },
  {
    name: "Polestar",
    models: ["1", "2", "3", "4"],
  },
  {
    name: "Porsche",
    models: [
      "911", "718 Boxster", "718 Cayman", "Boxster", "Cayman", "Panamera",
      "Panamera Sport Turismo", "Macan", "Cayenne", "Cayenne Coupé", "Taycan",
      "Taycan Sport Turismo", "Taycan Cross Turismo",
    ],
  },
  {
    name: "Mini",
    models: [
      "Cooper", "Cooper S", "Cooper SE", "One", "Clubman", "Countryman", "Cabrio",
      "Paceman", "John Cooper Works", "Aceman",
    ],
  },
  {
    name: "Land Rover",
    models: [
      "Defender", "Discovery", "Discovery Sport", "Range Rover", "Range Rover Sport",
      "Range Rover Velar", "Range Rover Evoque", "Freelander",
    ],
  },
  {
    name: "Jaguar",
    models: ["XE", "XF", "XJ", "F-Type", "E-Pace", "F-Pace", "I-Pace"],
  },
  {
    name: "Smart",
    models: ["fortwo", "forfour", "EQ fortwo", "EQ forfour", "#1", "#3", "#5", "Roadster"],
  },

  /* ---------------- Asien ---------------- */
  {
    name: "Toyota",
    models: [
      "Aygo", "Aygo X", "Yaris", "Yaris Cross", "Corolla", "Corolla Touring Sports",
      "Corolla Cross", "Auris", "Auris Touring Sports", "C-HR", "RAV4", "Highlander",
      "Land Cruiser", "Prius", "Prius+", "Camry", "Supra", "GR86", "GR Yaris", "GR Corolla",
      "bZ4X", "Proace", "Proace City", "Hilux", "Urban Cruiser",
    ],
  },
  {
    name: "Lexus",
    models: ["CT", "IS", "ES", "GS", "LS", "UX", "NX", "RX", "RZ", "LX", "LC", "RC", "LBX"],
  },
  {
    name: "Honda",
    models: ["Jazz", "Civic", "Civic Type R", "HR-V", "CR-V", "ZR-V", "e:Ny1", "Honda e", "Accord", "NSX"],
  },
  {
    name: "Mazda",
    models: ["2", "2 Hybrid", "3", "6", "CX-3", "CX-30", "CX-5", "CX-60", "CX-80", "MX-5", "MX-30"],
  },
  {
    name: "Nissan",
    models: ["Micra", "Note", "Leaf", "Juke", "Qashqai", "X-Trail", "Ariya", "Townstar", "370Z", "GT-R", "Navara"],
  },
  {
    name: "Mitsubishi",
    models: ["Space Star", "ASX", "Eclipse Cross", "Outlander", "Outlander PHEV", "L200", "Colt"],
  },
  {
    name: "Subaru",
    models: ["Impreza", "XV", "Crosstrek", "Forester", "Outback", "Levorg", "BRZ", "Solterra", "WRX STI"],
  },
  {
    name: "Suzuki",
    models: ["Swift", "Ignis", "Baleno", "Vitara", "S-Cross", "Jimny", "Across", "Swace"],
  },
  {
    name: "Hyundai",
    models: [
      "i10", "i20", "i20 N", "i30", "i30 Kombi", "i30 N", "i40", "Bayon", "Kona", "Kona Elektro",
      "Tucson", "Santa Fe", "Ioniq", "Ioniq 5", "Ioniq 5 N", "Ioniq 6", "Ioniq 9", "Nexo", "Staria",
    ],
  },
  {
    name: "Kia",
    models: [
      "Picanto", "Rio", "Ceed", "Ceed SW", "ProCeed", "XCeed", "Stonic", "Niro", "e-Niro",
      "Sportage", "Sorento", "EV3", "EV6", "EV9", "Optima", "Stinger", "Soul", "Carens",
    ],
  },
  {
    name: "Genesis",
    models: ["G70", "G80", "G90", "GV60", "GV70", "GV80"],
  },
  {
    name: "SsangYong",
    models: ["Tivoli", "Korando", "Rexton", "Musso", "Torres"],
  },

  /* ---------------- China ---------------- */
  {
    name: "BYD",
    models: ["Atto 3", "Dolphin", "Seal", "Seal U", "Sealion 7", "Han", "Tang", "Seagull"],
  },
  {
    name: "MG",
    models: ["ZS", "ZS EV", "MG3", "MG4", "MG5", "Marvel R", "HS", "EHS", "Cyberster"],
  },
  {
    name: "Zeekr",
    models: ["001", "007", "7X", "X", "009"],
  },
  {
    name: "NIO",
    models: ["EL6", "EL7", "EL8", "ET5", "ET5 Touring", "ET7", "EC6"],
  },
  {
    name: "XPeng",
    models: ["G6", "G9", "P7", "X9"],
  },
  {
    name: "Lynk & Co",
    models: ["01", "02", "08"],
  },
  {
    name: "Leapmotor",
    models: ["T03", "C10", "B10"],
  },
  {
    name: "Aiways",
    models: ["U5", "U6"],
  },
  {
    name: "Maxus",
    models: ["eDeliver 3", "eDeliver 9", "Euniq 5", "T90 EV"],
  },

  /* ---------------- Amerika ---------------- */
  {
    name: "Tesla",
    models: ["Model 3", "Model Y", "Model S", "Model X", "Roadster", "Cybertruck"],
  },
  {
    name: "Chevrolet",
    models: ["Spark", "Camaro", "Corvette", "Bolt", "Suburban", "Tahoe"],
  },
  {
    name: "Dodge",
    models: ["Challenger", "Charger", "Durango", "RAM 1500"],
  },
  {
    name: "Cadillac",
    models: ["ATS", "CTS", "XT4", "XT5", "Escalade", "Lyriq"],
  },
  {
    name: "Rivian",
    models: ["R1T", "R1S"],
  },
  {
    name: "Lucid",
    models: ["Air", "Gravity"],
  },

  /* ---------------- Sport und Luxus ---------------- */
  {
    name: "Ferrari",
    models: ["488", "F8", "296", "SF90", "Roma", "Portofino", "812", "Purosangue", "California"],
  },
  {
    name: "Lamborghini",
    models: ["Huracán", "Aventador", "Revuelto", "Urus"],
  },
  {
    name: "Maserati",
    models: ["Ghibli", "Quattroporte", "Levante", "Grecale", "GranTurismo", "MC20"],
  },
  {
    name: "Aston Martin",
    models: ["Vantage", "DB11", "DB12", "DBS", "DBX"],
  },
  {
    name: "Bentley",
    models: ["Continental GT", "Flying Spur", "Bentayga"],
  },
  {
    name: "Rolls-Royce",
    models: ["Ghost", "Phantom", "Wraith", "Cullinan", "Spectre"],
  },
  {
    name: "McLaren",
    models: ["570S", "720S", "750S", "Artura", "GT"],
  },
  {
    name: "Lotus",
    models: ["Elise", "Exige", "Evora", "Emira", "Eletre", "Emeya"],
  },
  {
    name: "Alpine",
    models: ["A110", "A290"],
  },
  {
    name: "Morgan",
    models: ["Plus Four", "Plus Six", "3 Wheeler"],
  },

  /* ---------------- Kleinfahrzeuge und Nutzfahrzeuge ---------------- */
  {
    name: "Microlino",
    models: ["Microlino", "Lite"],
  },
  {
    name: "Iveco",
    models: ["Daily", "eDaily"],
  },
  {
    name: "Isuzu",
    models: ["D-Max"],
  },
];

const byName = new Map(CATALOG.map((m) => [m.name, m]));

/** Alle Markennamen, alphabetisch. */
export const MAKE_NAMES: string[] = CATALOG.map((m) => m.name).sort((a, b) =>
  a.localeCompare(b, "de-CH"),
);

/** Modelle einer Marke; leer, wenn die Marke nicht im Katalog steht. */
export function modelsFor(make: string): string[] {
  return byName.get(make)?.models ?? [];
}

/** Steht die Marke im Katalog? Freie Eingaben bleiben trotzdem erlaubt. */
export function isKnownMake(make: string): boolean {
  return byName.has(make);
}

